import { expect } from 'chai'
import { firstValueFrom, lastValueFrom, skip, skipWhile, tap, toArray } from 'rxjs'
import sinon from 'sinon'
import { ABI } from '../abi/index.js'
import { Pool } from '../Pool.js'
import { PoolNetwork } from '../PoolNetwork.js'
import { Vault } from '../Vault.js'
import { context } from './setup.js'

const poolId = '2779829532'
const trancheId = '0xac6bffc5fd68f7772ceddec7b0a316ca'
const asset = '0x8503b4452bf6238cc76cdbee223b46d7196b1c93'
const vaultAddress = '0x05eb35c2e4fa21fb06d3fab92916191b254b3504'

// Active investor with a pending redeem order
const investorA = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
// Permissioned investor with no orders
const investorB = '0xa076b817Fade13Ee72C495910eDCe1ed953F9930' // E2E Admin
// Investor with a claimable invest order
const investorC = '0x7fAbAa12da2E30650c841AC647e3567f942fcdf5' // E2E Borrower
// Non-permissioned investor
const investorD = '0x63892115da2e40f8135Abe99Dc5155dd552464F4' // E2E Nav Manager
// Investor with a claimable cancel deposit
const investorE = '0x655631E9F3d31a70DD6c9B4cFB5CfDe7445Fd0d2' // E2E Fee receiver

describe('Vault', () => {
  let vault: Vault
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId)
    const poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
    vault = new Vault(centrifuge, poolNetwork, trancheId, asset, vaultAddress)
  })

  it('get investment details for an investor', async () => {
    const fetchSpy = sinon.spy(globalThis, 'fetch')
    const investment = await vault.investment(investorA)
    expect(investment.isAllowedToInvest).to.equal(true)
    // Calls should get batched
    expect(fetchSpy.getCalls().length).to.equal(4)
  })

  it("should throw when placing an invest order larger than the users's balance", async () => {
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let error: Error | null = null
    let wasAskedToSign = false
    try {
      await lastValueFrom(vault.placeInvestOrder(1000000000000000n).pipe(tap(() => (wasAskedToSign = true))))
    } catch (e: any) {
      error = e
    }
    expect(error?.message).to.equal('Insufficient balance')
    expect(wasAskedToSign).to.equal(false)
  })

  it('should throw when not allowed to invest', async () => {
    context.tenderlyFork.impersonateAddress = investorD
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let error: Error | null = null
    let wasAskedToSign = false
    try {
      await lastValueFrom(vault.placeInvestOrder(100000000n).pipe(tap(() => (wasAskedToSign = true))))
    } catch (e: any) {
      error = e
    }
    expect(error?.message).to.equal('Not allowed to invest')
    expect(wasAskedToSign).to.equal(false)
  })

  it('should place an invest order', async () => {
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      lastValueFrom(vault.placeInvestOrder(100000000n).pipe(toArray())),
      firstValueFrom(vault.investment(investorB).pipe(skipWhile((i) => i.pendingInvestCurrency !== 100000000n))),
    ])
    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Approve')
    expect(result[5]?.type).to.equal('TransactionConfirmed')
    expect((result[5] as any).title).to.equal('Invest')
    expect(investmentAfter.pendingInvestCurrency).to.equal(100000000n)
  })

  it('should cancel an invest order', async () => {
    const investmentBefore = await vault.investment(investorB)
    expect(investmentBefore.hasPendingCancelInvestRequest).to.equal(false)
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.cancelInvestOrder(),
      firstValueFrom(vault.investment(investorB).pipe(skip(1))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.hasPendingCancelInvestRequest).to.equal(true)
  })

  it('should claim a processed cancellation', async () => {
    const investmentBefore = await vault.investment(investorE)
    expect(investmentBefore.claimableCancelInvestCurrency).to.equal(1234000000n)
    context.tenderlyFork.impersonateAddress = investorE
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorE).pipe(skipWhile((i) => i.claimableCancelInvestCurrency !== 0n))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.claimableCancelInvestCurrency).to.equal(0n)
  })

  it('should throw when trying to cancel a non-existing order', async () => {
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let thrown = false
    let wasAskedToSign = false
    try {
      await lastValueFrom(vault.cancelRedeemOrder().pipe(tap(() => (wasAskedToSign = true))))
    } catch {
      thrown = true
    }
    expect(thrown).to.equal(true)
    expect(wasAskedToSign).to.equal(false)
  })

  it('should claim an executed order', async () => {
    const investmentBefore = await vault.investment(investorC)
    expect(investmentBefore.claimableInvestShares).to.equal(939254224n)
    expect(investmentBefore.claimableInvestCurrencyEquivalent).to.equal(999999999n)
    context.tenderlyFork.impersonateAddress = investorC
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorC).pipe(skipWhile((i) => i.claimableInvestShares !== 0n))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.claimableInvestShares).to.equal(0n)
    expect(investmentAfter.claimableInvestCurrencyEquivalent).to.equal(0n)
    expect(investmentAfter.shareBalance).to.equal(939254224n)
  })

  it('should place a redeem order', async () => {
    context.tenderlyFork.impersonateAddress = investorC
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      lastValueFrom(vault.placeRedeemOrder(939254224n).pipe(toArray())),
      firstValueFrom(vault.investment(investorC).pipe(skipWhile((i) => i.pendingRedeemShares !== 939254224n))),
    ])
    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Redeem')
    expect(investmentAfter.pendingRedeemShares).to.equal(939254224n)
  })

  it('should cancel a redeem order', async () => {
    const investmentBefore = await vault.investment(investorA)
    expect(investmentBefore.hasPendingCancelRedeemRequest).to.equal(false)
    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.cancelRedeemOrder(),
      firstValueFrom(vault.investment(investorA).pipe(skip(1))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.hasPendingCancelRedeemRequest).to.equal(true)
  })

  it('should refetch investment details after a user is added', async () => {
    const [poolManager, restrictionManager, investmentBefore] = await Promise.all([
      vault.network._poolManager(),
      vault._restrictionManager(),
      vault.investment(investorD),
    ])
    expect(investmentBefore.isAllowedToInvest).to.equal(false)
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [, investmentAfter] = await Promise.all([
      context.centrifuge._transact('Add Investor', ({ walletClient }) =>
        walletClient.writeContract({
          address: restrictionManager,
          abi: ABI.RestrictionManager,
          functionName: 'updateMember',
          args: [investmentBefore.shareCurrency.address, investorD, Math.floor(Date.now() / 1000) + 100000],
        })
      ),
      firstValueFrom(vault.investment(investorD).pipe(skip(1))),
    ])
    expect(investmentAfter.isAllowedToInvest).to.equal(true)
  })
})
