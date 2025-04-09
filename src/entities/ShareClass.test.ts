import { expect } from 'chai'
import { context } from '../tests/setup.js'
import { Balance } from '../utils/BigInt.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const poolId = '562949953421313'
const scId = '0x00000000000000000002000000000002'

describe('ShareClass', () => {
  let shareClass: ShareClass
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId, 11155111)
    shareClass = new ShareClass(centrifuge, pool, scId)
  })

  it('gets the details', async () => {
    const details = await shareClass.details()
    expect(details.totalIssuance).to.be.instanceOf(Balance)
    expect(details.navPerShare).to.be.instanceOf(Balance)
    expect(details.name).to.equal('Tokenized MMF')
    expect(details.symbol).to.equal('MMF')
    expect(details.id).to.equal(scId)
  })

  // it('should deploy a tranche', async () => {
  //   const poolId = '1287682503'
  //   const trancheId = '0x02bbf52e452ddb47103913051212382c'
  //   const pool = new Pool(context.centrifuge, poolId, 11155111)
  //   const ShareClass = new ShareClass(context.centrifuge, pool, 11155111)

  //   const canTrancheBeDeployed = await ShareClass.canTrancheBeDeployed(trancheId)
  //   expect(canTrancheBeDeployed).to.equal(true)

  //   const result = await ShareClass.deployTranche(trancheId)
  //   expect(result.type).to.equal('TransactionConfirmed')
  // })

  // it('should deploy a vault', async () => {
  //   const poolId = '1287682503'
  //   const trancheId = '0x02bbf52e452ddb47103913051212382c'
  //   const pool = new Pool(context.centrifuge, poolId, 11155111)
  //   const ShareClass = new ShareClass(context.centrifuge, pool, 11155111)
  //   const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

  //   const result = await ShareClass.deployVault(trancheId, tUSD)
  //   expect(result.type).to.equal('TransactionConfirmed')
  // })
})

// // Set the storage to a value that will make the tranche undeployable
// const poolLoc = mapLocation(6n, BigInt(poolId))
// const createdAtLoc = poolLoc + BigInt(0)
// const poolManager = await ShareClass._poolManager()
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
