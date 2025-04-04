import { expect } from 'chai'
import { combineLatest, filter, firstValueFrom, last, Observable } from 'rxjs'
import { parseEther } from 'viem/utils'
import { context } from './tests/setup.js'
import { type OperationConfirmedStatus } from './types/transaction.js'

describe('Account', () => {
  it('should fetch account and balances', async () => {
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

  it('should make a transfer impersonating the from address', async () => {
    const impersonatedAddress = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
    context.tenderlyFork.impersonateAddress = impersonatedAddress
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const transferAmount = 1_000_000n
    await Promise.all([
      context.tenderlyFork.fundAccountEth(impersonatedAddress, parseEther('100')),
      context.tenderlyFork.fundAccountERC20(impersonatedAddress, transferAmount),
    ])

    const impersonatedAccount = await context.centrifuge.account(impersonatedAddress)
    const destAddress = '0x26876eAceb62d31214C31F1a58b74A1445018b75'
    const destAccount = await context.centrifuge.account(destAddress)
    const destBalanceInitial = await destAccount.balances()

    const [transfer, impersonatedBalanceFinal, destBalanceFinal] = await firstValueFrom(
      combineLatest([
        impersonatedAccount.transfer(destAddress, transferAmount).pipe(last()) as Observable<OperationConfirmedStatus>,
        impersonatedAccount.balances().pipe(filter((balance) => balance !== transferAmount)),
        destAccount.balances().pipe(filter((balance) => balance !== destBalanceInitial)),
      ])
    )

    expect(transfer.receipt.from.toLowerCase()).to.equal(impersonatedAddress.toLowerCase())
    expect(transfer.type).to.equal('TransactionConfirmed')
    expect(transfer.title).to.equal('Transfer')
    expect(transfer.receipt.status).to.equal('success')
    expect(impersonatedBalanceFinal).to.equal(0n)
    expect(destBalanceFinal).to.equal(destBalanceInitial + transferAmount)
  })
})
