import { expect } from 'chai'
import { firstValueFrom, skipWhile } from 'rxjs'
import { context } from '../tests/setup.js'
import { AccountType } from '../types/holdings.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const chainId = 11155111
const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(1, 1)

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('ShareClass', () => {
  let shareClass: ShareClass
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, chainId)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)
  })

  it('gets the details', async () => {
    const details = await shareClass.details()
    expect(details.totalIssuance).to.be.instanceOf(Balance)
    expect(details.navPerShare).to.be.instanceOf(Balance)
    expect(details.name).to.equal('Tokenized MMF')
    expect(details.symbol).to.equal('MMF')
    expect(details.id.raw).to.equal(scId.raw)
  })

  it('gets the vaults', async () => {
    const vaults = await shareClass.vaults(chainId)
    expect(vaults.length).to.equal(1)
    expect(vaults[0]!.shareClass.id.raw).to.equal(scId.raw)
  })

  it('gets a holding', async () => {
    const holding = await shareClass.holding(assetId)
    expect(typeof holding.valuation).to.equal('string')
    expect(holding.assetDecimals).to.equal(6)
    expect(holding.assetId.equals(assetId)).to.be.true
    expect(holding.amount.decimals).to.equal(6)
    expect(holding.value.decimals).to.equal(18)
    expect(holding.accounts[AccountType.Asset]).not.to.be.undefined
    expect(holding.accounts[AccountType.Equity]).not.to.be.undefined
  })

  it('updates a member', async () => {
    const investor = randomAddress()
    const memberBefore = await shareClass.member(investor, chainId)

    expect(memberBefore.isMember).to.equal(false)

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const [, memberAfter] = await Promise.all([
      shareClass.updateMember(investor, 1800000000, chainId),
      firstValueFrom(shareClass.member(investor, chainId).pipe(skipWhile((m) => !m.isMember))),
    ])

    expect(memberAfter.isMember).to.equal(true)
    expect(memberAfter.validUntil.toISOString()).to.equal(new Date(1800000000 * 1000).toISOString())
  })

  // Done in Vault.test.ts
  // it('approves deposits and claims shares', async () => {
  //   context.tenderlyFork.impersonateAddress = fundManager
  //   context.centrifuge.setSigner(context.tenderlyFork.signer)
  //   const result = await shareClass.approveDeposits(assetId, Balance.fromFloat(100, 6), Price.fromFloat(1))
  //   expect(result.type).to.equal('TransactionConfirmed')

  //   const order = await shareClass.investorOrder(assetId, investorB)

  //   expect(order.maxDepositClaims).to.equal(1)

  //   const result2 = await shareClass.claimDeposit(assetId, investorB)
  //   expect(result2.type).to.equal('TransactionConfirmed')
  // })
})

// const { poolManager } = await context.centrifuge._protocolAddresses(chainId)
// const client = context.centrifuge.getClient(chainId)!
// const poolLoc = mapLocation(6n, poolId.raw, 'uint128')
// const scLoc = mapLocation(poolLoc + 1n, scId.raw, 'bytes16')
// const assetLoc = mapLocation(scLoc + 3n, '0xd54864475D5b1a0F235A751b6fddc8bb28FD3b9b', 'address')
// const priceLoc = mapLocation(assetLoc, 0n, 'uint256')
// const data = await client.getStorageAt({
//   address: poolManager,
//   slot: '0xb4aaa343c87a4bd58f639be7336d06126be71acdd096ecaad93182fd909f8e59',
// })

// function mapLocation(slot: bigint, key: bigint | string, keyType: string) {
//   return hexToBigInt(keccak256(encodePacked([keyType, 'uint256'], [key, slot])))
// }

// function arrLocation(slot: bigint, index: bigint, elementSize: bigint) {
//   return hexToBigInt(keccak256(toHex(slot))) + index * elementSize
// }

function randomAddress() {
  return `0x${Math.random().toString(16).slice(2).padStart(40, '0')}`
}
