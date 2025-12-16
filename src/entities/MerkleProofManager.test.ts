import { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodePacked } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { HexString, parseEventLogs } from '../index.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { MerkleProofPolicy, MerkleProofPolicyInput } from '../types/poolMetadata.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { generateCombinations, getMerkleTree, MerkleProofManager } from './MerkleProofManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { SimulationStatus } from '../types/transaction.js'

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

const someErc20 = '0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const mpmAddress = '0x9E14250c4C53bdcA1437F7EDa25B0D9ca46CfFE2'
const vaultDecoder = '0x8E5bE47D081F53033eb7C9DB3ad31BaF67F15585'

describe('MerkleProofManager', () => {
  let pool: Pool
  let merkleProofManager: MerkleProofManager
  let mockPolicies: MerkleProofPolicy[]
  const strategist = randomAddress()
  before(async () => {
    const { centrifuge } = context
    const { balanceSheet, vaultRouter } = await centrifuge._protocolAddresses(chainId)
    pool = new Pool(centrifuge, poolId.raw, chainId)
    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    merkleProofManager = new MerkleProofManager(centrifuge, poolNetwork, mpmAddress)
    const decoder = vaultDecoder
    const target = balanceSheet
    const randomUser = randomAddress()

    mockPolicies = [
      {
        decoder,
        target: someErc20,
        targetName: 'Some ERC20 Token',
        name: 'Approve spending',
        selector: 'function approve(address,uint256)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'address',
            label: 'Vault Router',
            input: [vaultRouter],
          },
          {
            parameter: 'uint256',
            label: 'Amount',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [vaultRouter, null],
            inputsEncoded: encodePacked(['address'], [vaultRouter]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function cancelDepositRequest(uint256, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function cancelRedeemRequest(uint256, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function claimCancelDepositRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function claimCancelRedeemRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function deposit(uint64 poolId, bytes16 scId, address asset, uint256, uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'poolId',
            input: [poolId.toString() as HexString],
          },
          {
            parameter: 'shareClassId',
            input: [scId.raw],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'uint128',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId.raw, someErc20, null, null],
            inputsEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId.raw, scId.raw, someErc20]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function deposit(uint256, address receiver)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function mint(uint256, address receiver)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function redeem(uint256, address receiver, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function requestDeposit(uint256, address controller, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function requestRedeem(uint256, address controller, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function withdraw(uint256, address receiver, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'poolId',
            input: [poolId.toString() as HexString],
          },
          {
            parameter: 'shareClassId',
            input: [scId.raw],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
          {
            parameter: 'uint128',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId.raw, someErc20, null, randomUser, null],
            inputsEncoded: encodePacked(
              ['uint64', 'bytes16', 'address', 'address'],
              [poolId.raw, scId.raw, someErc20, randomUser]
            ),
          },
        ],
      },
    ]

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await pool.updateBalanceSheetManagers([{ chainId, address: mpmAddress, canManage: true }])
  })

  it('correctly constructs the merkle tree', async () => {
    const expectedRootHash = '0x282444929cdaf1a1b1b4f69f682f30978c826397dd82c8e876db37c3a69fe4e5'
    const poolId = 281474976710657n
    const scId = '0x31000000000000000000000000000000'
    const erc20 = '0xa0Cb889707d426A7A386870A03bc70d1b0697598'
    const manager = '0xA4AD4f68d0b91CFD19687c881e50f3A00242828c'
    const decoder = '0x03A6a84cD762D9707A21605b548aaaB891562aAb'
    const target = '0x1B237b1866D34C8619D52F9A5047a4Ab976e0426'

    const policies: MerkleProofPolicy[] = [
      {
        decoder,
        target,
        selector: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'poolId',
            input: [poolId.toString() as HexString],
          },
          {
            parameter: 'shareClassId',
            input: [scId],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [manager],
          },
          {
            parameter: 'uint128',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId, erc20, null, manager, null],
            inputsEncoded: encodePacked(['uint64', 'bytes16', 'address', 'address'], [poolId, scId, erc20, manager]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function deposit(uint64,bytes16,address,uint256,uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'shareClassId',
            input: [scId],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId, erc20],
            inputsEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId, scId, erc20]),
          },
        ],
      },
    ]

    const tree = getMerkleTree(SimpleMerkleTree, policies)
    expect(tree.root).to.equal(expectedRootHash)
  })

  // TODO: Finish once pool tests are working and we can setup pool metadata and read it
  it.skip('sets templates', async () => {
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async () => {
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const template = {
      id: 'template-1',
      name: 'Default Template',
      actions: [
        { policyIndex: 0, defaultValues: ['0x', 987654321000] },
        { policyIndex: 1, defaultValues: [987654321000, '0x'] },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: undefined,
    }

    await mpm.setTemplates(strategist, [template])
  })

  it('sets policies', async () => {
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        expect(data.merkleProofManager[chainId][strategist].policies).to.deep.equal(mockPolicies)
        // Simulate pinning JSON and returning a CID
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    await mpm.setPolicies(strategist, mockPolicies)

    const tree = getMerkleTree(SimpleMerkleTree, mockPolicies)

    const rootHash = await centrifugeWithPin.getClient(chainId).readContract({
      address: mpmAddress,
      abi: ABI.MerkleProofManager,
      functionName: 'policy',
      args: [strategist],
    })

    expect(rootHash).to.equal(tree.root)
  })

  it('can execute calls', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    const mock = sinon.stub(merkleProofManager.pool, 'metadata')
    mock.returns(
      makeThenable(
        of({
          merkleProofManager: {
            [chainId]: {
              [strategist.toLowerCase()]: { policies: mockPolicies },
            },
          },
        } as any)
      )
    )

    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async () => {
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)
    await mpm.setPolicies(strategist, mockPolicies)

    await context.tenderlyFork.fundAccountEth(strategist, 10n ** 18n)
    context.tenderlyFork.impersonateAddress = strategist
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await merkleProofManager.execute([{ policy: mockPolicies[0]!, inputs: [vaultRouter, 123_000_000n] }])

    const balance = await context.centrifuge.getClient(chainId).readContract({
      address: someErc20,
      abi: ABI.Currency,
      functionName: 'allowance',
      args: [mpmAddress, vaultRouter],
    })

    expect(balance).to.equal(123_000_000n)

    mock.restore()
  })

  it('cannot execute calls with invalid proof', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

    const mock = sinon.stub(merkleProofManager.pool, 'metadata')
    mock.returns(
      makeThenable(
        of({
          merkleProofManager: {
            [chainId]: {
              [strategist.toLowerCase()]: { policies: mockPolicies },
            },
          },
        } as any)
      )
    )

    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async () => {
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    await context.tenderlyFork.fundAccountEth(strategist, 10n ** 18n)
    context.tenderlyFork.impersonateAddress = strategist
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    try {
      await merkleProofManager.execute([{ policy: mockPolicies[0]!, inputs: [vaultRouter, 123_000_000n] }])
    } catch (e) {
      expect((e as Error).message).to.include('Transaction reverted')
    }

    mock.restore()
  })

  describe('generateCombinations', () => {
    it('generates all combinations of inputs', async () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: '0xDecoder',
        target: '0xTarget',
        name: 'someAction',
        selector: 'function doSomething(uint256 a, address b, uint256 c)',
        inputs: [
          {
            parameter: 'a',
            input: ['0x1', '0x2'],
          },
          {
            parameter: 'b',
            input: ['0xAddress1', '0xAddress2'],
          },
          {
            parameter: 'c',
            input: ['0x3'],
          },
        ],
      }

      const expectedCombinations: (HexString | null)[][] = [
        ['0x1', '0xAddress1', '0x3'],
        ['0x1', '0xAddress2', '0x3'],
        ['0x2', '0xAddress1', '0x3'],
        ['0x2', '0xAddress2', '0x3'],
      ]

      const combinations = generateCombinations(policyInput.inputs)
      expect(combinations).to.deep.equal(expectedCombinations)
    })

    it('handles inputs that are null', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: '0xDecoder',
        target: '0xTarget',
        name: 'someAction',
        selector: 'function doSomething()',
        inputs: [
          {
            parameter: 'a',
            input: [],
          },
          {
            parameter: 'b',
            input: ['0xAddress1', '0xAddress2'],
          },
          {
            parameter: 'c',
            input: ['0x3'],
          },
        ],
      }

      const expectedCombinations: (HexString | null)[][] = [
        [null, '0xAddress1', '0x3'],
        [null, '0xAddress2', '0x3'],
      ]

      const combinations = generateCombinations(policyInput.inputs)
      expect(combinations).to.deep.equal(expectedCombinations)
    })

    it('handles many inputs with mix of nulls and values', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: '0xDecoder',
        target: '0xTarget',
        name: 'someAction',
        selector: 'function doSomething()',
        inputs: [
          {
            parameter: 'a',
            input: ['0x1', '0x2', '0x3'],
          },
          {
            parameter: 'b',
            input: [],
          },
          {
            parameter: 'c',
            input: ['0x4', '0x5'],
          },
          {
            parameter: 'd',
            input: ['0x6'],
          },
          {
            parameter: 'e',
            input: [],
          },
        ],
      }

      const expectedCombinations: (HexString | null)[][] = [
        ['0x1', null, '0x4', '0x6', null],
        ['0x1', null, '0x5', '0x6', null],
        ['0x2', null, '0x4', '0x6', null],
        ['0x2', null, '0x5', '0x6', null],
        ['0x3', null, '0x4', '0x6', null],
        ['0x3', null, '0x5', '0x6', null],
      ]

      const combinations = generateCombinations(policyInput.inputs)
      expect(combinations).to.deep.equal(expectedCombinations)
    })

    it('handles empty inputs', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: '0xDecoder',
        target: '0xTarget',
        name: 'someAction',
        selector: 'function doSomething()',
        inputs: [],
      }

      try {
        generateCombinations(policyInput.inputs)
      } catch (error) {
        expect((error as Error).message).to.include('No inputs provided for generating combinations')
      }
    })
  })

  // Enable once Tenderly supports eth_simulateV1 calls
  describe.skip('simulate', () => {
    it('simulates execution of calls', async () => {
      const { vaultRouter } = await context.centrifuge._protocolAddresses(chainId)

      const mock = sinon.stub(merkleProofManager.pool, 'metadata')
      mock.returns(
        makeThenable(
          of({
            merkleProofManager: {
              [chainId]: {
                [strategist.toLowerCase()]: { policies: mockPolicies },
              },
            },
          } as any)
        )
      )

      const centrifugeWithPin = new Centrifuge({
        environment: 'testnet',
        pinJson: async () => {
          return 'abc'
        },
        rpcUrls: {
          11155111: context.tenderlyFork.rpcUrl,
        },
      })
      context.tenderlyFork.impersonateAddress = fundManager
      centrifugeWithPin.setSigner(context.tenderlyFork.signer)
      const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)
      await mpm.setPolicies(strategist, mockPolicies)

      await context.tenderlyFork.fundAccountEth(strategist, 10n ** 18n)
      context.tenderlyFork.impersonateAddress = strategist
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const result = (await merkleProofManager.execute(
        [{ policy: mockPolicies[0]!, inputs: [vaultRouter, 123_000_000n] }],
        { simulate: true }
      )) as SimulationStatus

      expect(result.type).to.equal('TransactionSimulation')
      expect(result.title).to.equal('Execute calls')
      expect(result.result).to.have.length(1)
      expect(result.result[0]!.status).to.equal('success')
      expect(result.result[0]!.logs).to.have.length(2)
      expect(result.assetChanges).to.deep.equal([
        {
          token: {
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            decimals: 18,
            symbol: 'ETH',
          },
          value: { pre: 1000000000000000000n, post: 1000000000000000000n, diff: 0n },
        },
        {
          token: {
            address: '0x3aaaa86458d576bafcb1b7ed290434f0696da65c',
            decimals: 6,
            symbol: 'USDC',
          },
          value: { pre: 0n, post: 0n, diff: 0n },
        },
      ])

      mock.restore()
    })

    it('simulates multi calls to set policies', async () => {
      const centrifugeWithPin = new Centrifuge({
        environment: 'testnet',
        pinJson: async (data) => {
          expect(data.merkleProofManager[chainId][strategist].policies).to.deep.equal(mockPolicies)
          // Simulate pinning JSON and returning a CID
          return 'abc'
        },
        rpcUrls: {
          11155111: context.tenderlyFork.rpcUrl,
        },
      })
      const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

      context.tenderlyFork.impersonateAddress = fundManager
      centrifugeWithPin.setSigner(context.tenderlyFork.signer)

      const result = (await mpm.setPolicies(strategist, mockPolicies, { simulate: true })) as SimulationStatus

      expect(result.type).to.equal('TransactionSimulation')
      expect(result.title).to.equal('Set policies')
      expect(result.result).to.have.length(1)
      expect(result.result[0]!.status).to.equal('success')
      expect(result.result[0]!.logs).to.have.length(4)
      expect(result.assetChanges![0]?.token).to.deep.equal({
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        decimals: 18,
        symbol: 'ETH',
      })
      expect(result.assetChanges![0]?.value.pre).to.equal(result.assetChanges![0]?.value.post)
      expect(result.assetChanges![0]?.value.diff).to.equal(0n)
    })
  })
})
