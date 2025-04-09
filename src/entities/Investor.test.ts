import { expect } from 'chai'
import { getAddress } from 'viem'
import { context } from '../tests/setup.js'

const INVESTOR = '0x423420ae467df6e90291fd0252c0a8a637c1e03f'

describe('Investor', () => {
  it('should fetch its portfolio', async () => {
    const account = await context.centrifuge.investor(INVESTOR)
    const portfolio = await account.portfolio()
    expect(portfolio).to.exist
  })

  it('should return its checksum address', async () => {
    const account = await context.centrifuge.investor(INVESTOR)
    expect(account.address).to.equal(getAddress(INVESTOR))
  })
})
