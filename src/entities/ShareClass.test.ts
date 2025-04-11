import { expect } from 'chai'
import { context } from '../tests/setup.js'
import { Balance } from '../utils/BigInt.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const poolId = new PoolId('562949953421313')
const scId = new ShareClassId('0x00000000000000000002000000000002')

describe('ShareClass', () => {
  let shareClass: ShareClass
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, 11155111)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)
  })

  it('gets the details', async () => {
    const details = await shareClass.details()
    expect(details.totalIssuance).to.be.instanceOf(Balance)
    expect(details.navPerShare).to.be.instanceOf(Balance)
    expect(details.name).to.equal('Tokenized MMF')
    expect(details.symbol).to.equal('MMF')
    expect(details.id.equals(scId)).to.be.true
  })

  it('gets the vaults', async () => {
    const vaults = await shareClass.vaults(11155111)
    expect(vaults.length).to.equal(1)
    expect(vaults[0]!.shareClass.id.equals(scId)).to.be.true
  })
})
