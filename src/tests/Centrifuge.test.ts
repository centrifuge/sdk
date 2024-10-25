import { expect } from 'chai'
import { combineLatest, filter, firstValueFrom, last, Observable } from 'rxjs'
import { parseEther } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import type { OperationConfirmedStatus } from '../types/transaction.js'
import { TenderlyFork } from './tenderly.js'

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
    centrifuge.setSigner(tenderlyFork.account)
  })
  // TODO: don't remove if any test fails
  after(async () => {
    return await tenderlyFork.deleteTenderlyRpcEndpoint()
  })
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
    const fromAddress = tenderlyFork.account.address
    const destAddress = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
    const transferAmount = 10_000_000n

    await Promise.all([
      tenderlyFork.fundAccountEth(fromAddress, parseEther('100')),
      tenderlyFork.fundAccountERC20(fromAddress, 100_000_000n),
    ])
    const fromAccount = await centrifuge.account(fromAddress)
    const destAccount = await centrifuge.account(destAddress)
    const fromBalanceInitial = await fromAccount.balances()
    const destBalanceInitial = await destAccount.balances()

    const [transfer, fromBalanceFinal, destBalanceFinal] = await firstValueFrom(
      combineLatest([
        fromAccount.transfer(destAddress, transferAmount).pipe(last()) as Observable<OperationConfirmedStatus>,
        fromAccount.balances().pipe(filter((balance) => balance !== fromBalanceInitial)),
        destAccount.balances().pipe(filter((balance) => balance !== destBalanceInitial)),
      ])
    )

    expect(transfer.type).to.equal('TransactionConfirmed')
    expect(transfer.title).to.equal('Transfer')
    expect(transfer.receipt.status).to.equal('success')
    expect(fromBalanceFinal).to.equal(fromBalanceInitial - transferAmount)
    expect(destBalanceFinal).to.equal(destBalanceInitial + transferAmount)
  })

  it('should fetch a pool by id', async () => {
    const pool = await centrifuge.pool('4139607887')
    expect(pool).to.exist
  })
})
