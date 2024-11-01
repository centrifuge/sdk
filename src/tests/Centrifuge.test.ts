import { expect } from 'chai'
import { combineLatest, filter, firstValueFrom, last, Observable } from 'rxjs'
import { parseEther } from 'viem'
import type { OperationConfirmedStatus } from '../types/transaction.js'
import { context } from './setup.js'

describe('Centrifuge', () => {
  it('should be connected to sepolia', async function () {
    const client = context.centrifuge.getClient()
    expect(client?.chain.id).to.equal(11155111)
    const chains = context.centrifuge.chains
    expect(chains).to.include(11155111)
  })

  it('should fetch account and balances', async function () {
    const account = await context.centrifuge.account('0x423420Ae467df6e90291fd0252c0A8a637C1e03f')
    const balances = await account.balances()
    expect(balances).to.exist
  })

  it('should make a transfer', async function () {
    const fromAddress = this.context.tenderlyFork.account.address
    const destAddress = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
    const transferAmount = 10_000_000n

    await Promise.all([
      context.tenderlyFork.fundAccountEth(fromAddress, parseEther('100')),
      context.tenderlyFork.fundAccountERC20(fromAddress, 100_000_000n),
    ])
    const fromAccount = await context.centrifuge.account(fromAddress)
    const destAccount = await context.centrifuge.account(destAddress)
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

  it('should fetch a pool by id', async function () {
    const pool = await context.centrifuge.pool('4139607887')
    expect(pool).to.exist
  })
})
