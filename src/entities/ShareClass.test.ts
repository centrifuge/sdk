import { expect } from 'chai'
import { firstValueFrom, skipWhile } from 'rxjs'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { AccountType } from '../types/holdings.js'
import { Balance, Price } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const chainId = 11155111
const poolId = PoolId.from(1, 1)
const poolId2 = PoolId.from(1, 2)
const scId = ShareClassId.from(poolId, 1)
const scId2 = ShareClassId.from(poolId2, 1)
const assetId = AssetId.from(1, 1)
const assetId2 = AssetId.from(1, 2)

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('ShareClass', () => {
  let shareClass: ShareClass
  let shareClass2: ShareClass
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, chainId)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)

    const pool2 = new Pool(centrifuge, poolId2.raw, chainId)
    shareClass2 = new ShareClass(centrifuge, pool2, scId2.raw)
  })

  it('gets the details', async () => {
    const details = await shareClass.details()
    expect(details.totalIssuance).to.be.instanceOf(Balance)
    expect(details.pricePerShare).to.be.instanceOf(Price)
    expect(details.name).to.equal('Tokenized MMF')
    expect(details.symbol).to.equal('MMF')
    expect(details.id.raw).to.equal(scId.raw)
  })

  it('gets the nav per network', async () => {
    const nav = await shareClass.navPerNetwork()
    expect(nav[0]!.totalIssuance).to.be.instanceOf(Balance)
    expect(nav[0]!.pricePerShare).to.be.instanceOf(Price)
    expect(nav[0]!.pricePerShare.toFloat()).to.be.greaterThan(0)
  })

  it('gets the vaults', async () => {
    const vaults = await shareClass.vaults(chainId)
    expect(vaults.length).to.equal(1)
    expect(vaults[0]!.shareClass.id.raw).to.equal(scId.raw)
  })

  it('gets all holdings', async () => {
    const holdings = await shareClass.holdings()
    expect(holdings.length).to.be.greaterThan(0)
    expect(typeof holdings[0]!.valuation).to.equal('string')
    expect(holdings[0]!.asset.decimals).to.equal(6)
    expect(holdings[0]!.assetId.equals(assetId)).to.be.true
    expect(holdings[0]!.amount.decimals).to.equal(6)
    expect(holdings[0]!.value.decimals).to.equal(18)
    expect(holdings[0]!.accounts[AccountType.Asset]).not.to.be.undefined
    expect(holdings[0]!.accounts[AccountType.Equity]).not.to.be.undefined
  })

  it('gets a holding', async () => {
    const holding = await shareClass._holding(assetId)
    expect(typeof holding.valuation).to.equal('string')
    expect(holding.assetDecimals).to.equal(6)
    expect(holding.assetId.equals(assetId)).to.be.true
    expect(holding.amount.decimals).to.equal(6)
    expect(holding.value.decimals).to.equal(18)
    expect(holding.accounts[AccountType.Asset]).not.to.be.undefined
    expect(holding.accounts[AccountType.Equity]).not.to.be.undefined
  })

  it('creates a holding', async () => {
    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const { identityValuation } = await context.centrifuge._protocolAddresses(chainId)

    const result = await shareClass2.createHolding(assetId2, identityValuation, false, {
      [AccountType.Equity]: 2,
      [AccountType.Gain]: 3,
      [AccountType.Loss]: 4,
    })
    expect(result.type).to.equal('TransactionConfirmed')

    const holding = await shareClass2._holding(assetId2)
    expect(holding).not.to.be.undefined
    expect(holding.assetId.equals(assetId2)).to.be.true
    expect(holding.amount.toFloat()).to.equal(0)
    // Should have automatically created a new asset account
    expect(holding.accounts[AccountType.Asset]).to.be.greaterThan(0)
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

  it('gets pending amounts', async () => {
    const pendingAmounts = await shareClass.pendingAmounts()
    expect(pendingAmounts.length).to.be.greaterThan(0)
    expect(pendingAmounts[0]!.assetId.equals(assetId)).to.be.true
    expect(pendingAmounts[0]!.chainId).to.equal(chainId)
    expect(pendingAmounts[0]!.pendingDeposit).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.pendingRedeem).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.approvedDeposit).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.approvedRedeem).to.be.instanceOf(Balance)
  })
})
