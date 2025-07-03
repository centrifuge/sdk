import { expect } from 'chai'
import { firstValueFrom, lastValueFrom, skip, skipWhile, tap, toArray } from 'rxjs'
import { parseAbi } from 'viem'
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

// Pool with async vault, permissioned redeem
const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(1, 1)

// Async deposit/redeem vault with permissioned redeem
const asyncVaultAddress = '0x0d05d9d4a4c68aea2fabb70b2cc629757ea0285c'

// Pool with sync deposit vault, and permissioned async redeem
const poolId2 = PoolId.from(1, 2)
const scId2 = ShareClassId.from(poolId2, 1)
const syncVaultAddress = '0x7372b99c9df983d14d016807b9da387c90159251'

// Active investor with a pending redeem order
// Investor with a pending invest order on async vault
// Investor with a claimable cancel deposit on async vault
// Investor with a claimable invest order

// Investors with no orders on async vault
const investorA = '0x5b66af49742157E360A2897e3F480d192305B2b5'
const investorB = '0x54b1d961678C145a444765bB2d7aD6B029770D35'
const investorC = '0x95d340e6d34418D9eBFD2e826b8f61967654C33e'
// const investorD = '0x41fe7c3D0b4d8107929c08615adF5038Cb3EAf5C'
// const investorE = '0x897100032Fb126228dB14D7bD24d770770569AC9'

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const protocolAdmin = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const defaultAssetsAmount = Balance.fromFloat(100, 6)
const defaultSharesAmount = Balance.fromFloat(100, 18)

async function mint(address: string) {
  context.tenderlyFork.impersonateAddress = protocolAdmin
  context.centrifuge.setSigner(context.tenderlyFork.signer)

  await context.centrifuge._transact(
    'mint',
    async ({ walletClient }) => {
      return await walletClient.writeContract({
        address: currencies[chainId]![0]!,
        abi: parseAbi(['function mint(address, uint256)']),
        functionName: 'mint',
        args: [address as any, defaultAssetsAmount.toBigInt()],
      })
    },
    chainId
  )
}

describe('Vault - Async', () => {
  let vault: Vault
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, chainId)
    const sc = new ShareClass(centrifuge, pool, scId.raw)
    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    vault = new Vault(centrifuge, poolNetwork, sc, asset, asyncVaultAddress)
  })

  it('completes the invest/redeem flow', async () => {
    await mint(investorA)

    let investment = await vault.investment(investorA)
    expect(investment.isAllowedToRedeem).to.equal(false)
    expect(investment.isSyncInvest).to.equal(false)

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await vault.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)

    // Make sure price is up-to-date
    await vault.shareClass.notifyAssetPrice(assetId)

    // Add member, to be able to redeem
    ;[, investment] = await Promise.all([
      vault.shareClass.updateMember(investorA, 1800000000, chainId),
      firstValueFrom(vault.investment(investorA).pipe(skip(1))),
    ])

    expect(investment.isAllowedToInvest).to.equal(true)
    expect(investment.isAllowedToRedeem).to.equal(true)
    expect(investment.shareBalance.toBigInt()).to.equal(0n)
    expect(investment.pendingInvestCurrency.toBigInt()).to.equal(0n)
    expect(investment.pendingRedeemShares.toBigInt()).to.equal(0n)
    expect(investment.claimableInvestShares.toBigInt()).to.equal(0n)
    expect(investment.claimableInvestCurrencyEquivalent.toBigInt()).to.equal(0n)

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    // Invest
    let result
    ;[result, investment] = await Promise.all([
      lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(toArray())),
      firstValueFrom(
        vault.investment(investorA).pipe(skipWhile((i) => !i.pendingInvestCurrency.eq(defaultAssetsAmount.toBigInt())))
      ),
    ])

    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Approve')
    expect(result[5]?.type).to.equal('TransactionConfirmed')
    expect((result[5] as any).title).to.equal('Invest')
    expect(investment.pendingInvestCurrency.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    let pendingAmounts = await vault.shareClass.pendingAmounts()
    let pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

    // Approve deposits
    await vault.shareClass.approveDepositsAndIssueShares([
      {
        assetId,
        approveAssetAmount: pendingAmount.pendingDeposit,
        issuePricePerShare: Price.fromFloat(1),
      },
    ])
    ;[, investment] = await Promise.all([
      vault.shareClass.claimDeposit(assetId, investorA),
      firstValueFrom(
        vault.investment(investorA).pipe(skipWhile((i) => !i.claimableInvestShares.eq(defaultSharesAmount.toBigInt())))
      ),
    ])

    expect(investment.claimableInvestCurrencyEquivalent.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    // Claim shares
    ;[, investment] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => !i.claimableInvestShares.eq(0n)))),
    ])

    expect(investment.shareBalance.toBigInt()).to.equal(defaultSharesAmount.toBigInt())

    const redeemShares = Balance.fromFloat(40, 18)
    ;[, investment, pendingAmounts] = await Promise.all([
      vault.increaseRedeemOrder(redeemShares),
      firstValueFrom(
        vault.investment(investorA).pipe(skipWhile((i) => !i.pendingRedeemShares.eq(redeemShares.toBigInt())))
      ),
      firstValueFrom(
        vault.shareClass
          .pendingAmounts()
          .pipe(skipWhile((p) => p.find((a) => a.assetId.equals(assetId))!.pendingRedeem.eq(0n)))
      ),
    ])

    expect(investment.pendingRedeemShares.toBigInt()).to.equal(redeemShares.toBigInt())
    expect(investment.shareBalance.toBigInt()).to.equal(defaultSharesAmount.toBigInt() - redeemShares.toBigInt())

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

    // Approve redeems
    await Promise.all([
      vault.shareClass.approveRedeemsAndRevokeShares([
        {
          assetId,
          approveShareAmount: pendingAmount.pendingRedeem,
          revokePricePerShare: Price.fromFloat(1),
        },
      ]),
      // claimRedeem() relies on the investOrder being up-to-date, so waiting here for it to be updated
      // TODO: Fix this somehow
      firstValueFrom(
        vault.shareClass.investorOrder(assetId, investorA).pipe(skipWhile((o) => o.maxRedeemClaims === 0))
      ),
    ])
    ;[, investment] = await Promise.all([
      vault.shareClass.claimRedeem(assetId, investorA),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => i.claimableRedeemCurrency.eq(0n)))),
    ])

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    // Claim assets
    ;[result, investment] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => i.claimableRedeemCurrency.gt(0n)))),
    ])

    expect(result.type).to.equal('TransactionConfirmed')
    expect(investment.shareBalance.toBigInt()).to.equal(Balance.fromFloat(60, 18).toBigInt())
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

  // TODO: Set up an account with an claimed invest order, but not whitelisted
  // it('throws when not allowed to redeem', async () => {
  //   context.tenderlyFork.impersonateAddress = investorD
  //   context.centrifuge.setSigner(context.tenderlyFork.signer)
  //   let error: Error | null = null
  //   let emittedSigningStatus = false
  //   try {
  //     await lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(tap(() => (emittedSigningStatus = true))))
  //   } catch (e: any) {
  //     error = e
  //   }
  //   expect(error?.message).to.equal('Not allowed to invest')
  //   expect(emittedSigningStatus).to.equal(false)
  // })

  it('cancels an invest order and claims the tokens back', async () => {
    await mint(investorC)

    context.tenderlyFork.impersonateAddress = investorC
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    let investment = await vault.investment(investorC)

    ;[, investment] = await Promise.all([
      lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(toArray())),
      firstValueFrom(
        vault.investment(investorC).pipe(skipWhile((i) => !i.pendingInvestCurrency.eq(defaultAssetsAmount.toBigInt())))
      ),
    ])

    expect(investment.hasPendingCancelInvestRequest).to.equal(false)
    ;[, investment] = await Promise.all([
      vault.cancelInvestOrder(),
      firstValueFrom(vault.investment(investorC).pipe(skip(1))),
    ])

    // Same chain so cancellation is immediate
    expect(investment.hasPendingCancelInvestRequest).to.equal(false)
    expect(investment.claimableCancelInvestCurrency.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())
    ;[, investment] = await Promise.all([
      vault.claim(),
      firstValueFrom(vault.investment(investorC).pipe(skipWhile((i) => !i.claimableCancelInvestCurrency.isZero()))),
    ])

    expect(investment.claimableCancelInvestCurrency.toBigInt()).to.equal(0n)
  })

  it('should throw when trying to cancel a non-existing order', async () => {
    await mint(investorA)

    context.tenderlyFork.impersonateAddress = investorA
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

  // TODO: Set up an account with a redeem order
  // it('should cancel a redeem order', async () => {
  //   const investmentBefore = await vault.investment(investorA)
  //   expect(investmentBefore.hasPendingCancelRedeemRequest).to.equal(false)
  //   context.tenderlyFork.impersonateAddress = investorA
  //   context.centrifuge.setSigner(context.tenderlyFork.signer)
  //   const [result, investmentAfter] = await Promise.all([
  //     vault.cancelRedeemOrder(),
  //     firstValueFrom(vault.investment(investorA).pipe(skip(1))),
  //   ])
  //   expect(result.type).to.equal('TransactionConfirmed')
  //   expect(investmentAfter.hasPendingCancelRedeemRequest).to.equal(true)
  // })
})

describe('Vault - Sync invest', () => {
  let vault: Vault
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId2.raw, chainId)
    const sc = new ShareClass(centrifuge, pool, scId2.raw)
    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    vault = new Vault(centrifuge, poolNetwork, sc, asset, syncVaultAddress)
  })

  it('invests', async () => {
    await mint(investorA)

    const investmentBefore = await vault.investment(investorA)

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await vault.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)
    await vault.shareClass.setMaxSharePriceAge(11155111, 9999999999999)

    // Make sure price is up-to-date
    await vault.shareClass.notifyAssetPrice(assetId)
    await vault.shareClass.notifySharePrice(11155111)

    expect(investmentBefore.isSyncInvest).to.equal(true)
    expect(investmentBefore.isAllowedToInvest).to.equal(true)
    expect(investmentBefore.shareBalance.toBigInt()).to.equal(0n)
    expect(investmentBefore.pendingInvestCurrency.toBigInt()).to.equal(0n)
    expect(investmentBefore.pendingRedeemShares.toBigInt()).to.equal(0n)
    expect(investmentBefore.claimableInvestShares.toBigInt()).to.equal(0n)
    expect(investmentBefore.claimableInvestCurrencyEquivalent.toBigInt()).to.equal(0n)
    expect(investmentBefore.maxInvest.toFloat()).to.be.gt(0)

    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    // Invest
    const [result, investmentAfter] = await Promise.all([
      lastValueFrom(vault.increaseInvestOrder(defaultAssetsAmount).pipe(toArray())),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => i.shareBalance.eq(0n)))),
    ])

    expect(result[2]?.type).to.equal('TransactionConfirmed')
    expect((result[2] as any).title).to.equal('Approve')
    expect(result[5]?.type).to.equal('TransactionConfirmed')
    expect((result[5] as any).title).to.equal('Invest')
    expect(investmentAfter.shareBalance.toBigInt()).to.equal(defaultSharesAmount.toBigInt())
  })
})
