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
import { MerkleProofPolicy, MerkleProofPolicyInput, MerkleProofWorkflow } from '../types/poolMetadata.js'
import { SimulationStatus } from '../types/transaction.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { generateCombinations, getMerkleTree, isVerifiedWorkflow, MerkleProofManager } from './MerkleProofManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

type FromArgs = { from: HexString; to: HexString; value: bigint }

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

const someErc20 = '0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const mpmAddress = '0x9E5FD1A9D960d8CfA76Ad1dd2F5D8FEeB5bdD382'
const vaultDecoder = '0x8E5bE47D081F53033eb7C9DB3ad31BaF67F15585'

describe('MerkleProofManager', () => {
  let pool: Pool
  let merkleProofManager: MerkleProofManager
  let mockPolicies: MerkleProofPolicy[]
  let randomUser: HexString
  const strategist = randomAddress()
  before(async () => {
    const { centrifuge } = context
    const { balanceSheet, vaultRouter } = await centrifuge._protocolAddresses(centId)
    pool = new Pool(centrifuge, poolId.raw)
    const poolNetwork = new PoolNetwork(centrifuge, pool, centId)
    merkleProofManager = new MerkleProofManager(centrifuge, poolNetwork, mpmAddress)
    const decoder = vaultDecoder
    const target = balanceSheet
    randomUser = randomAddress()

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

    await pool.updateBalanceSheetManagers([{ centrifugeId: centId, address: mpmAddress, canManage: true }])
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

  it('sets workflows', async () => {
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        expect(data.merkleProofManager[chainId][strategist].workflows).to.have.length(1)
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const workflow: MerkleProofWorkflow = {
      id: 'workflow-1',
      name: 'Default Workflow',
      template: 'erc7540_requestDeposit',
      category: 'Allocation',
      iconUrl: 'ipfs://icon',
      isVerified: false,
      actions: [
        { policyIndex: 0, defaultValues: ['0x', 987654321000] },
        { policyIndex: 1, defaultValues: [987654321000, '0x'] },
      ],
      createdAt: new Date().toISOString(),
    }

    await mpm.setWorkflows(strategist, [workflow])
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

    const rootHash = await (
      await centrifugeWithPin.getClient(centId)
    ).readContract({
      address: mpmAddress,
      abi: ABI.MerkleProofManager,
      functionName: 'policy',
      args: [strategist],
    })

    expect(rootHash).to.equal(tree.root)
  })

  it('addPolicy appends policies and keeps existing indices stable', async () => {
    let pinnedMetadata: any
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        pinnedMetadata = data
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const details = await mpm.pool.details()
    const existingWorkflow: MerkleProofWorkflow = {
      id: 'existing-workflow',
      name: 'Existing workflow',
      createdAt: new Date().toISOString(),
      actions: [
        {
          policyIndex: 0,
          defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
        },
      ],
      isVerified: false,
    }

    const detailsStub = sinon.stub(mpm.pool, 'details')
    detailsStub.resolves({
      ...details,
      metadata: {
        ...details.metadata,
        merkleProofManager: {
          ...details.metadata?.merkleProofManager,
          [chainId]: {
            ...details.metadata?.merkleProofManager?.[chainId],
            [strategist.toLowerCase()]: {
              policies: mockPolicies,
              workflows: [existingWorkflow],
            },
          },
        },
      },
    } as any)

    const newPolicy: MerkleProofPolicyInput = {
      decoder: mockPolicies[0]!.decoder,
      target: mockPolicies[0]!.target,
      targetName: mockPolicies[0]!.targetName,
      name: mockPolicies[0]!.name,
      selector: mockPolicies[0]!.selector,
      valueNonZero: mockPolicies[0]!.valueNonZero,
      inputs: mockPolicies[0]!.inputs,
    }

    const verificationActions = [
      {
        policy: newPolicy,
        defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
      },
    ]

    await mpm.addPolicy(strategist, [newPolicy], {
      id: 'added-workflow',
      name: 'Added workflow',
      template: 'erc7540_requestDeposit',
      category: 'Allocation',
      iconUrl: 'ipfs://icon',
      verificationActions,
    })

    const stored = pinnedMetadata.merkleProofManager[chainId][strategist.toLowerCase()]
    expect(stored.policies).to.have.length(mockPolicies.length + 1)
    expect(stored.policies.slice(0, mockPolicies.length)).to.deep.equal(mockPolicies)
    expect(stored.workflows).to.have.length(2)

    const addedWorkflow = stored.workflows.find((workflow: MerkleProofWorkflow) => workflow.id === 'added-workflow')
    expect(addedWorkflow).to.exist
    expect(addedWorkflow.actions[0]!.policyIndex).to.equal(mockPolicies.length)
    expect(addedWorkflow.isVerified).to.equal(true)

    const expectedTree = getMerkleTree(SimpleMerkleTree, stored.policies)
    const rootHash = await (
      await centrifugeWithPin.getClient(centId)
    ).readContract({
      address: mpmAddress,
      abi: ABI.MerkleProofManager,
      functionName: 'policy',
      args: [strategist],
    })
    expect(rootHash).to.equal(expectedTree.root)

    detailsStub.restore()
  })

  describe('isVerifiedWorkflow', () => {
    it('returns true for exact policy and default-values match', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-1',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [
            {
              policy: policyInput,
              defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
            },
          ]
        )
      ).to.equal(true)
    })

    it('returns false when action order differs', () => {
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-2',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
          {
            policyIndex: 1,
            defaultValues: [null, randomUser],
          },
        ],
      }

      const canonicalActions: MerkleProofPolicyInput[] = [
        {
          decoder: mockPolicies[1]!.decoder,
          target: mockPolicies[1]!.target,
          targetName: mockPolicies[1]!.targetName,
          name: mockPolicies[1]!.name,
          selector: mockPolicies[1]!.selector,
          valueNonZero: mockPolicies[1]!.valueNonZero,
          inputs: mockPolicies[1]!.inputs,
        },
        {
          decoder: mockPolicies[0]!.decoder,
          target: mockPolicies[0]!.target,
          targetName: mockPolicies[0]!.targetName,
          name: mockPolicies[0]!.name,
          selector: mockPolicies[0]!.selector,
          valueNonZero: mockPolicies[0]!.valueNonZero,
          inputs: mockPolicies[0]!.inputs,
        },
      ]

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!, mockPolicies[1]!],
          [
            { policy: canonicalActions[0]!, defaultValues: [null, randomUser] },
            { policy: canonicalActions[1]!, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] },
          ]
        )
      ).to.equal(false)
    })

    it('returns false when policy structure differs', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: randomAddress(),
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-3',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] }]
        )
      ).to.equal(false)
    })

    it('returns false when default-values differ', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-4',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, 123] }]
        )
      ).to.equal(false)
    })

    it('returns false when default-values are not positional', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-5',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] }]
        )
      ).to.equal(false)
    })
  })

  it('can execute calls', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(centId)

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

    const balance = await (
      await context.centrifuge.getClient(chainId)
    ).readContract({
      address: someErc20,
      abi: ABI.Currency,
      functionName: 'allowance',
      args: [mpmAddress, vaultRouter],
    })

    expect(balance).to.equal(123_000_000n)

    mock.restore()
  })

  it('cannot execute calls with invalid proof', async () => {
    const { vaultRouter } = await context.centrifuge._protocolAddresses(centId)

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
      const { vaultRouter } = await context.centrifuge._protocolAddresses(centId)

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

      mock.restore()
    })

    it('simulates execution of calls - with asset changes', async () => {
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
        [
          {
            policy: mockPolicies[12]!,
            inputs: [poolId.toString() as HexString, scId.raw, someErc20, 0, randomUser, 123_456_000n],
          },
        ],
        { simulate: true }
      )) as SimulationStatus

      const logs = parseEventLogs({
        logs: result.result[0]?.logs ?? [],
      })

      expect(result.type).to.equal('TransactionSimulation')
      expect(result.title).to.equal('Execute calls')
      expect(result.result).to.have.length(1)
      expect(result.result[0]!.status).to.equal('success')
      expect(result.result[0]!.logs).to.have.length(5)
      expect(logs[2]?.eventName).to.equal('Transfer')
      expect((logs[2]?.args as FromArgs).from).to.equal('0x08BdC2Cb9C50Accc5B395B5EB22d275adC941072')
      expect((logs[2]?.args as FromArgs).to.toLowerCase()).to.equal(randomUser)
      expect((logs[2]?.args as FromArgs).value).to.equal(123_456_000n)

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
    })
  })
})
