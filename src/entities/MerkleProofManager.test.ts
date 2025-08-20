import { SimpleMerkleTree } from '@openzeppelin/merkle-tree'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodePacked } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { MerkleProofPolicy } from '../types/poolMetadata.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { getMerkleTree, MerkleProofManager } from './MerkleProofManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)

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
        assetId: undefined,
        decoder,
        target: someErc20,
        abi: 'function approve(address,uint256)',
        valueNonZero: false,
        args: [vaultRouter, null],
        argsEncoded: encodePacked(['address'], [vaultRouter]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function cancelDepositRequest(uint256, address controller)',
        valueNonZero: false,
        args: [null, randomUser],
        argsEncoded: encodePacked(['address'], [randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function cancelRedeemRequest(uint256, address controller)',
        valueNonZero: false,
        args: [null, randomUser],
        argsEncoded: encodePacked(['address'], [randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function claimCancelDepositRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function claimCancelRedeemRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function deposit(uint64 poolId, bytes16 scId, address asset, uint256, uint128)',
        valueNonZero: false,
        args: [poolId.toString(), scId.raw, someErc20, null, null],
        argsEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId.raw, scId.raw, someErc20]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function deposit(uint256, address receiver)',
        valueNonZero: false,
        args: [null, randomUser],
        argsEncoded: encodePacked(['address'], [randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function mint(uint256, address receiver)',
        valueNonZero: false,
        args: [null, randomUser],
        argsEncoded: encodePacked(['address'], [randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function redeem(uint256, address receiver, address owner)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function requestDeposit(uint256, address controller, address owner)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function requestRedeem(uint256, address controller, address owner)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function withdraw(uint256, address receiver, address owner)',
        valueNonZero: false,
        args: [null, randomUser, randomUser],
        argsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        args: [poolId.toString(), scId.toString(), someErc20, null, randomUser, null],
        argsEncoded: encodePacked(
          ['uint64', 'bytes16', 'address', 'address'],
          [poolId.raw, scId.raw, someErc20, randomUser]
        ),
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
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        args: [poolId.toString(), scId, erc20, null, manager, null],
        argsEncoded: encodePacked(['uint64', 'bytes16', 'address', 'address'], [poolId, scId, erc20, manager]),
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function deposit(uint64,bytes16,address,uint256,uint128)',
        valueNonZero: false,
        args: [poolId.toString(), scId, erc20, null],
        argsEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId, scId, erc20]),
      },
    ]

    const tree = getMerkleTree(SimpleMerkleTree, policies)
    expect(tree.root).to.equal(expectedRootHash)
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

    await mpm.setPolicies(
      strategist,
      mockPolicies.map((p) => ({ ...p, argsEncoded: undefined }))
    )

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

    await context.tenderlyFork.fundAccountEth(strategist, 10n ** 18n)
    context.tenderlyFork.impersonateAddress = strategist
    context.centrifuge.setSigner(context.tenderlyFork.signer)

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

    await merkleProofManager.execute([{ policy: mockPolicies[0]!, inputs: [123_000_000n] }])

    const balance = await context.centrifuge.getClient(chainId).readContract({
      address: someErc20,
      abi: ABI.Currency,
      functionName: 'allowance',
      args: [mpmAddress, vaultRouter],
    })

    expect(balance).to.equal(123_000_000n)

    mock.restore()
  })
})
