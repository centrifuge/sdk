import { expect } from 'chai'
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
})
