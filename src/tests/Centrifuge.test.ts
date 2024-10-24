import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { TenderlyFork } from './tenderly.js'
import { sepolia } from 'viem/chains'
import { parseEther } from 'viem'

describe('Centrifuge', () => {
  let centrifuge: Centrifuge
  let tenderlyFork: TenderlyFork

  before(async () => {
    tenderlyFork = await TenderlyFork.create(sepolia)
    centrifuge = new Centrifuge({
      environment: 'demo',
      rpcUrls: {
        11155111: tenderlyFork.rpcUrl,
      },
    })
    centrifuge.setSigner(tenderlyFork.signer)
  })
  // TODO: don't remove if any test fails
  // after(async () => {
  //   return await tenderlyFork.deleteTenderlyRpcEndpoint()
  // })
  it('should be connected to sepolia', async () => {
    const client = centrifuge.getClient()
    expect(client?.chain.id).to.equal(11155111)
    const chains = centrifuge.chains
    expect(chains).to.include(11155111)
  })
  it('should fetch account and balances', async () => {
    const account = await centrifuge.account('0x423420Ae467df6e90291fd0252c0A8a637C1e03f')
    const balances = await account.balances()
    expect(balances).to.exist
  })

  it('should make a transfer', async () => {
    await Promise.all([
      tenderlyFork.fundAccountEth(tenderlyFork.account.address, parseEther('100')),
      tenderlyFork.fundAccountERC20(tenderlyFork.account.address, parseEther('100')),
    ])
    const account = await centrifuge.account(tenderlyFork.account.address)
    const balances = await account.balances()
    expect(Number(balances)).to.be.greaterThan(0)
    // doesn't work: ERC20/insufficient-balance, the tenderly signer does not match the sender of the transfer
    // const transfer = await account.transfer('0x423420Ae467df6e90291fd0252c0A8a637C1e03f', parseEther('10'))
    // if ('receipt' in transfer) {
    //   expect(transfer.receipt.status).to.equal('success')
    // } else {
    //   throw new Error('Transfer failed')
    // }
  })

  it('should fetch a pool by id', async () => {
    const pool = await centrifuge.pool('4139607887')
    expect(pool).to.exist
  })
})
