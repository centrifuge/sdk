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

    mockPolicies = [
      {
        assetId: assetId.toString(),
        decoder: vaultDecoder,
        target: balanceSheet,
        abi: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        addresses: [
          poolId.toString(),
          scId.toString(),
          '0xa0Cb889707d426A7A386870A03bc70d1b0697598',

          '0xA4AD4f68d0b91CFD19687c881e50f3A00242828c',
        ],
        addressesEncoded:
          '0x0000000000000000000000000000000000000000310000000000000000000000000000000000000000000000000000a0cb889707d426a7a386870a03bc70d1b0697598a4ad4f68d0b91cfd19687c881e50f3a00242828c',
        strategistInputs: [0],
      },
      {
        assetId: assetId.toString(),
        decoder: vaultDecoder,
        target: someErc20,
        abi: 'function approve(address,uint256)',
        valueNonZero: false,
        addresses: [vaultRouter, null],
        addressesEncoded: encodePacked(['address'], [vaultRouter]),
        strategistInputs: [1],
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
        addresses: [poolId.toString(), scId, erc20, null, manager, null],
        addressesEncoded: encodePacked(['uint64', 'bytes16', 'address', 'address'], [poolId, scId, erc20, manager]),
        strategistInputs: [0],
      },
      {
        assetId: assetId.toString(),
        decoder,
        target,
        abi: 'function deposit(uint64,bytes16,address,uint256,uint128)',
        valueNonZero: false,
        addresses: [poolId.toString(), scId, erc20, null],
        addressesEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId, scId, erc20]),
        strategistInputs: [0],
      },
    ]

    const tree = getMerkleTree(SimpleMerkleTree, policies)
    expect(tree.root).to.equal(expectedRootHash)
  })

  it('sets policies', async () => {
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        // TODO: Check if merkle proof manager metadata is correct
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

    await context.tenderlyFork.fundAccountEth(strategist, 10n ** 18n)
    context.tenderlyFork.impersonateAddress = strategist
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const mock = sinon.stub(merkleProofManager.pool, 'metadata')
    mock.returns(
      makeThenable(
        of({
          merkleProofManager: {
            [chainId]: {
              [strategist.toLowerCase()]: mockPolicies,
            },
          },
        } as any)
      )
    )

    await merkleProofManager.execute([{ policy: mockPolicies[1]!, inputs: [123_000_000n] }])

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
