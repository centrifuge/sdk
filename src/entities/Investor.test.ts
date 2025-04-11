import { expect } from 'chai'
import { getAddress } from 'viem'
import { context } from '../tests/setup.js'

const investor = '0x423420ae467df6e90291fd0252c0a8a637c1e03f'

describe('Investor', () => {
  it('should fetch its portfolio', async () => {
    const account = await context.centrifuge.investor(investor)
    const portfolio = await account.portfolio()
    expect(portfolio).to.exist
  })

  it('should return its checksum address', async () => {
    const account = await context.centrifuge.investor(investor)
    expect(account.address).to.equal(getAddress(investor))
  })
})
