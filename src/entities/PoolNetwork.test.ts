import { expect } from 'chai'
import { context } from '../tests/setup.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const poolId = '562949953421313'
const scId = '0x00000000000000000002000000000002'
const vaultAddress = '0x4249284a934013973a342bcfdba8d3dab4987fd3'

describe('PoolNetwork', () => {
  let poolNetwork: PoolNetwork
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId, 11155111)
    poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
  })

  it('should get whether a pool is deployed to a network', async () => {
    const isActive = await poolNetwork.isActive()
    expect(isActive).to.equal(true)

    // non-active pool/network
    const poolNetwork2 = new PoolNetwork(context.centrifuge, new Pool(context.centrifuge, '123', 11155111), 11155111)
    const isActive2 = await poolNetwork2.isActive()
    expect(isActive2).to.equal(false)
  })

  it('get vaults for a tranche', async () => {
    const vaults = await poolNetwork.vaults(scId)
    expect(vaults).to.have.length(1)
    expect(vaults[0]!.address.toLowerCase()).to.equal(vaultAddress)
  })

  // it('should deploy a tranche', async () => {
  //   const poolId = '1287682503'
  //   const trancheId = '0x02bbf52e452ddb47103913051212382c'
  //   const pool = new Pool(context.centrifuge, poolId, 11155111)
  //   const poolNetwork = new PoolNetwork(context.centrifuge, pool, 11155111)

  //   const canTrancheBeDeployed = await poolNetwork.canTrancheBeDeployed(trancheId)
  //   expect(canTrancheBeDeployed).to.equal(true)

  //   const result = await poolNetwork.deployTranche(trancheId)
  //   expect(result.type).to.equal('TransactionConfirmed')
  // })

  // it('should deploy a vault', async () => {
  //   const poolId = '1287682503'
  //   const trancheId = '0x02bbf52e452ddb47103913051212382c'
  //   const pool = new Pool(context.centrifuge, poolId, 11155111)
  //   const poolNetwork = new PoolNetwork(context.centrifuge, pool, 11155111)
  //   const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

  //   const result = await poolNetwork.deployVault(trancheId, tUSD)
  //   expect(result.type).to.equal('TransactionConfirmed')
  // })
})

// // Set the storage to a value that will make the tranche undeployable
// const poolLoc = mapLocation(6n, BigInt(poolId))
// const createdAtLoc = poolLoc + BigInt(0)
// const poolManager = await poolNetwork._poolManager()
// const client = context.centrifuge.getClient()!
// const data = await client.setStorageAt({
//   address: poolManager,
//   slot: toHex(createdAtLoc),
// })

// function mapLocation(slot: bigint, key: bigint) {
//   return hexToBigInt(keccak256(encodePacked(['uint256', 'uint256'], [key, slot])))
// }

// function arrLocation(slot: bigint, index: bigint, elementSize: bigint) {
//   return hexToBigInt(keccak256(toHex(slot))) + index * elementSize
// }
