import { expect } from 'chai'
import { firstValueFrom, lastValueFrom, skip, skipWhile, tap, toArray } from 'rxjs'
import { ABI } from '../abi/index.js'
import { currencies } from '../config/protocol.js'
import { context } from '../tests/setup.js'
import { Balance, Price } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

const chainId = 11155111
const asset = currencies[chainId]![0]!

// Pool with async vault, freely transferable token
const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(1, 1)

// Async deposit/redeem vault with freely transferable token
const asyncVaultA = '0x914fd615c6dae76085579edec2fdda1b039184ca'

// Pool with sync deposit vault, freely transferable token
const poolId2 = PoolId.from(1, 2)
const scId2 = ShareClassId.from(poolId2, 1)
const syncVaultAddress = '0x914fd615c6dae76085579edec2fdda1b039184ca'

// Active investor with a pending redeem order
// Investor with a pending invest order on asyncVaultA
// Investor with a claimable cancel deposit on asyncVaultA
// Investor with a claimable invest order

// Investor with no orders on asyncVaultA
const investorA = '0x5b66af49742157E360A2897e3F480d192305B2b5'
const investorB = '0x54b1d961678C145a444765bB2d7aD6B029770D35'
const investorC = '0x95d340e6d34418D9eBFD2e826b8f61967654C33e'
const investorD = '0x41fe7c3D0b4d8107929c08615adF5038Cb3EAf5C'
const investorE = '0x897100032Fb126228dB14D7bD24d770770569AC9'

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const defaultAssetsAmount = Balance.fromFloat(100, 6)
const defaultSharesAmount = Balance.fromFloat(100, 18)

describe('Vault - Async', () => {
  let vault: Vault
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, chainId)
    const sc = new ShareClass(centrifuge, pool, scId.raw)
    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    vault = new Vault(centrifuge, poolNetwork, sc, asset, asyncVaultA)
  })

  it.only('completes the invest/redeem flow', async () => {
    const investment = await vault.investment(investorA)

    expect(investment.isAllowedToInvest).to.equal(true)
    expect(investment.isAllowedToRedeem).to.equal(true)

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const [result, investment2] = await Promise.all([
      lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(toArray())),
      firstValueFrom(
        vault.investment(investorA).pipe(skipWhile((i) => !i.pendingInvestCurrency.eq(defaultAssetsAmount.toBigInt())))
      ),
    ])

    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Approve')
    expect(result[5]?.type).to.equal('TransactionConfirmed')
    expect((result[5] as any).title).to.equal('Invest')
    expect(investment2.pendingInvestCurrency.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await vault.shareClass.approveDeposits(assetId, defaultAssetsAmount.add(defaultAssetsAmount), Price.fromFloat(1))

    const [, investment3] = await Promise.all([
      vault.shareClass.claimDeposit(assetId, investorA),
      firstValueFrom(
        vault.investment(investorA).pipe(skipWhile((i) => !i.claimableInvestShares.eq(defaultSharesAmount.toBigInt())))
      ),
    ])

    expect(investment3.claimableInvestCurrencyEquivalent.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const [, investment4] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => !i.claimableInvestShares.eq(0n)))),
    ])

    expect(investment4.shareBalance.toBigInt()).to.equal(defaultSharesAmount.toBigInt())
  })

  it("should throw when placing an invest order larger than the users's balance", async () => {
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let error: Error | null = null
    let emittedSigningStatus = false
    try {
      await lastValueFrom(
        vault.increaseInvestOrder(Balance.fromFloat(100000000000, 6)).pipe(tap(() => (emittedSigningStatus = true)))
      )
    } catch (e: any) {
      error = e
    }
    expect(error?.message).to.equal('Insufficient balance')
    expect(emittedSigningStatus).to.equal(false)
  })

  it('throws when not allowed to invest', async () => {
    context.tenderlyFork.impersonateAddress = investorD
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let error: Error | null = null
    let emittedSigningStatus = false
    try {
      await lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(tap(() => (emittedSigningStatus = true))))
    } catch (e: any) {
      error = e
    }
    expect(error?.message).to.equal('Not allowed to invest')
    expect(emittedSigningStatus).to.equal(false)
  })

  it('should cancel an invest order', async () => {
    const investmentBefore = await vault.investment(investorA)
    expect(investmentBefore.hasPendingCancelInvestRequest).to.equal(false)
    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.cancelInvestOrder(),
      firstValueFrom(vault.investment(investorA).pipe(skip(1))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')

    // Same chain so cancellation is immediate
    expect(investmentAfter.hasPendingCancelInvestRequest).to.equal(false)
    expect(investmentAfter.claimableCancelInvestCurrency.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())
  })

  it('should claim a processed cancellation', async () => {
    const investmentBefore = await vault.investment(investorC)
    expect(investmentBefore.claimableCancelInvestCurrency.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())
    context.tenderlyFork.impersonateAddress = investorC
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorC).pipe(skipWhile((i) => !i.claimableCancelInvestCurrency.isZero()))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.claimableCancelInvestCurrency.isZero()).to.equal(true)
  })

  it('should throw when trying to cancel a non-existing order', async () => {
    context.tenderlyFork.impersonateAddress = investorB
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    let thrown = false
    let emittedSigningStatus = false
    try {
      await lastValueFrom(vault.cancelRedeemOrder().pipe(tap(() => (emittedSigningStatus = true))))
    } catch {
      thrown = true
    }
    expect(thrown).to.equal(true)
    expect(emittedSigningStatus).to.equal(false)
  })

  it('should claim an executed order', async () => {
    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    // Approve and claim existing deposit requests on Hub side
    await vault.shareClass.approveDeposits(assetId, Balance.fromFloat(1000, 6), Price.fromFloat(1))
    await vault.shareClass.claimDeposit(assetId, investorB)

    const investmentBefore = await vault.investment(investorA)
    expect(investmentBefore.claimableInvestShares.toBigInt()).to.equal(999999999999000000000000n)
    expect(investmentBefore.claimableInvestCurrencyEquivalent.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())
    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      lastValueFrom(vault.claim()),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => !i.claimableInvestShares.isZero()))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.claimableInvestShares.isZero()).to.equal(true)
    expect(investmentAfter.claimableInvestCurrencyEquivalent.isZero()).to.equal(true)
    expect(investmentAfter.shareBalance.toBigInt()).to.equal(1000000000000n + 999999999999000000000000n)
  })

  it('should place a redeem order', async () => {
    context.tenderlyFork.impersonateAddress = investorC
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      lastValueFrom(vault.increaseRedeemOrder(new Balance(939254224n, 6)).pipe(toArray())),
      firstValueFrom(vault.investment(investorC).pipe(skipWhile((i) => !i.pendingRedeemShares.eq(939254224n)))),
    ])
    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Redeem')
    expect(investmentAfter.pendingRedeemShares.toBigInt()).to.equal(939254224n)
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
    const [{ poolManager }, restrictionManager, investmentBefore] = await Promise.all([
      vault._root._protocolAddresses(vault.chainId),
      vault._restrictionManager(),
      vault.investment(investorD),
    ])
    expect(investmentBefore.isAllowedToInvest).to.equal(false)
    context.tenderlyFork.impersonateAddress = poolManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [, investmentAfter] = await Promise.all([
      context.centrifuge._transact(
        'Add Investor',
        ({ walletClient }) =>
          walletClient.writeContract({
            address: restrictionManager,
            abi: ABI.RestrictionManager,
            functionName: 'updateMember',
            args: [investmentBefore.shareCurrency.address, investorD, Math.floor(Date.now() / 1000) + 100000],
          }),
        chainId
      ),
      firstValueFrom(vault.investment(investorD).pipe(skip(1))),
    ])
    expect(investmentAfter.isAllowedToInvest).to.equal(true)
  })
})
