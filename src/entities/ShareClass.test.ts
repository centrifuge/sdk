import { expect } from 'chai'
import { firstValueFrom, lastValueFrom, skip, skipWhile, toArray } from 'rxjs'
import { parseAbi } from 'viem'
import { ABI } from '../abi/index.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { AccountType } from '../types/holdings.js'
import { Balance, Price } from '../utils/BigInt.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

const chainId = 11155111
const centId = 1
const poolId = PoolId.from(centId, 1)
const poolId2 = PoolId.from(centId, 2)
const scId = ShareClassId.from(poolId, 1)
const scId2 = ShareClassId.from(poolId2, 1)
const assetId = AssetId.from(centId, 1)
const assetId2 = AssetId.from(centId, 2)

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const protocolAdmin = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const investor = '0x5b66af49742157E360A2897e3F480d192305B2b5'

const defaultAssetsAmount = Balance.fromFloat(100, 6)

describe('ShareClass', () => {
  let shareClass: ShareClass
  let shareClass2: ShareClass
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw)
    shareClass = new ShareClass(centrifuge, pool, scId.raw)

    const pool2 = new Pool(centrifuge, poolId2.raw)
    shareClass2 = new ShareClass(centrifuge, pool2, scId2.raw)
  })

  it('gets the details', async () => {
    const details = await shareClass.details()
    expect(details.totalIssuance).to.be.instanceOf(Balance)
    expect(details.pricePerShare).to.be.instanceOf(Price)
    expect(typeof details.name).to.equal('string')
    expect(typeof details.symbol).to.equal('string')
    expect(details.id.raw).to.equal(scId.raw)
  })

  it('gets the nav per network', async () => {
    const nav = await shareClass.navPerNetwork()
    expect(nav[0]!.totalIssuance).to.be.instanceOf(Balance)
    expect(nav[0]!.pricePerShare).to.be.instanceOf(Price)
    expect(nav[0]!.address).to.be.a('string')
    expect(nav[0]!.pricePerShare.toFloat()).to.be.greaterThan(0)
  })

  it('gets the vaults', async () => {
    const vaults = await shareClass.vaults(centId)
    expect(vaults).to.have.length.greaterThan(0)
    expect(vaults[0]!.shareClass.id.raw).to.equal(scId.raw)
  })

  it('gets all balances', async () => {
    const balances = await shareClass.balances()
    expect(balances.length).to.be.greaterThan(0)
    expect(balances[0]!.asset.decimals).to.equal(6)
    expect(balances[0]!.assetId.equals(assetId)).to.be.true
    expect(balances[0]!.amount.decimals).to.equal(6)
    expect(balances[0]!.value.decimals).to.equal(18)
    expect(balances[0]!.value.toFloat()).to.be.greaterThan(0)
  })

  it('creates a holding', async () => {
    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const { identityValuation, accounting } = await context.centrifuge._protocolAddresses(centId)

    const accountExists = await (
      await context.centrifuge.getClient(centId)
    ).readContract({
      address: accounting,
      abi: ABI.Accounting,
      functionName: 'exists',
      args: [poolId2.raw, 123n],
    })
    if (!accountExists) {
      await shareClass2.pool.createAccounts([{ accountId: 123n, isDebitNormal: false }])
    }

    const result = await shareClass2.createHolding(assetId2, identityValuation, false, {
      [AccountType.Equity]: 123,
      [AccountType.Gain]: 123,
      [AccountType.Loss]: 123,
    })
    expect(result.type).to.equal('TransactionConfirmed')

    const holding = await shareClass2._holding(assetId2)
    expect(holding.assetId.equals(assetId2)).to.be.true
    expect(holding.amount.toFloat()).to.equal(0)
    // Should have automatically created a new asset account
    expect(holding.accounts[AccountType.Asset]).to.be.greaterThan(0)
  })

  it('updates a member', async () => {
    const investor = randomAddress()
    const memberBefore = await shareClass.member(investor, centId)

    expect(memberBefore.isMember).to.equal(false)

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const [, memberAfter] = await Promise.all([
      shareClass.updateMember(investor, 1800000000, centId),
      firstValueFrom(shareClass.member(investor, centId).pipe(skipWhile((m) => !m.isMember))),
    ])

    expect(memberAfter.isMember).to.equal(true)
    expect(memberAfter.validUntil.toISOString()).to.equal(new Date(1800000000 * 1000).toISOString())
  })

  it('batch updates members', async () => {
    const investor1 = randomAddress()
    const investor2 = randomAddress()

    const membersBefore = await Promise.all([
      shareClass.member(investor1, centId),
      shareClass.member(investor2, centId),
    ])

    expect(membersBefore[0]!.isMember).to.equal(false)
    expect(membersBefore[1]!.isMember).to.equal(false)

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    const [, membersAfter] = await Promise.all([
      shareClass.updateMembers([
        { address: investor1, validUntil: 1800000000, centrifugeId: centId },
        { address: investor2, validUntil: 1800000000, centrifugeId: centId },
      ]),
      Promise.all([
        firstValueFrom(shareClass.member(investor1, centId).pipe(skipWhile((m) => !m.isMember))),
        firstValueFrom(shareClass.member(investor2, centId).pipe(skipWhile((m) => !m.isMember))),
      ]),
    ])

    expect(membersAfter).to.deep.equal([
      { isMember: true, validUntil: new Date(1800000000 * 1000) },
      { isMember: true, validUntil: new Date(1800000000 * 1000) },
    ])
  })

  it.skip('gets holders', async () => {
    const holders = await shareClass.holders()
    expect(holders.investors).to.have.length.greaterThan(0)
    expect(holders).to.have.property('totalCount')
    expect(holders.pageInfo).to.have.property('hasNextPage')
    expect(holders.pageInfo).to.have.property('hasPreviousPage')
    expect(holders.pageInfo).to.have.property('startCursor')
    expect(holders.pageInfo).to.have.property('endCursor')

    const actual = holders.investors.map((i) => ({
      address: i.address.toLowerCase(),
      amount: i.amount instanceof Balance,
      isFrozen: i.isFrozen,
      holdings: i.holdings instanceof Balance,
      outstandingInvestIsBalance: i.outstandingInvest instanceof Balance,
      outstandingRedeemIsBalance: i.outstandingRedeem instanceof Balance,
      queuedInvestIsBalance: i.queuedInvest instanceof Balance,
      queuedRedeemIsBalance: i.queuedRedeem instanceof Balance,
      isWhitelisted: typeof i.isWhitelisted === 'boolean',
    }))

    const expected = holders.investors.map((i) => ({
      address: i.address.toLowerCase(),
      amount: true,
      isFrozen: false,
      holdings: true,
      outstandingInvestIsBalance: true,
      outstandingRedeemIsBalance: true,
      queuedInvestIsBalance: true,
      queuedRedeemIsBalance: true,
      isWhitelisted: true,
    }))

    expect(actual).to.deep.equal(expected)
  })

  it('gets whitelisted holders', async () => {
    const whitelistedHolders = await shareClass.whitelistedHolders()
    expect(whitelistedHolders.investors).to.have.length.greaterThan(0)
    expect(whitelistedHolders.totalCount).to.be.greaterThan(0)
    expect(whitelistedHolders.pageInfo).to.have.property('hasNextPage')
    expect(whitelistedHolders.pageInfo).to.have.property('hasPreviousPage')
    expect(whitelistedHolders.pageInfo).to.have.property('startCursor')
    expect(whitelistedHolders.pageInfo).to.have.property('endCursor')

    const actual = whitelistedHolders.investors.map((i) => ({
      address: i.address.toLowerCase(),
      amount: i.amount instanceof Balance,
      isFrozen: i.isFrozen,
      holdings: i.holdings instanceof Balance,
      outstandingInvestIsBalance: i.outstandingInvest instanceof Balance,
      outstandingRedeemIsBalance: i.outstandingRedeem instanceof Balance,
      queuedInvestIsBalance: i.queuedInvest instanceof Balance,
      queuedRedeemIsBalance: i.queuedRedeem instanceof Balance,
      isWhitelisted: true,
    }))

    const expected = whitelistedHolders.investors.map((i) => ({
      address: i.address.toLowerCase(),
      amount: true,
      isFrozen: false,
      holdings: true,
      outstandingInvestIsBalance: true,
      outstandingRedeemIsBalance: true,
      queuedInvestIsBalance: true,
      queuedRedeemIsBalance: true,
      isWhitelisted: true,
    }))

    expect(actual).to.deep.equal(expected)
  })

  it('freezes and unfreezes a member', async () => {
    const investor = randomAddress()

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await shareClass.updateMember(investor, 1800000000, chainId)

    const [share, restrictionManager] = await Promise.all([
      firstValueFrom(shareClass._share(chainId)),
      firstValueFrom(shareClass._restrictionManager(chainId)),
    ])

    const client = await context.centrifuge.getClient(chainId)

    const isFrozen = async () => {
      return await client.readContract({
        address: restrictionManager,
        abi: ABI.RestrictionManager,
        functionName: 'isFrozen',
        args: [share, investor],
      })
    }

    expect(await isFrozen()).to.equal(false)

    const freezeTx = await shareClass.freezeMember(investor, chainId)
    expect(freezeTx.type).to.equal('TransactionConfirmed')

    expect(await isFrozen()).to.equal(true)

    const unfreezeTx = await shareClass.unfreezeMember(investor, chainId)
    expect(unfreezeTx.type).to.equal('TransactionConfirmed')

    expect(await isFrozen()).to.equal(false)
  })

  it.skip('gets pending amounts', async () => {
    const pendingAmounts = await shareClass.pendingAmounts()
    expect(pendingAmounts.length).to.be.greaterThan(0)
    expect(pendingAmounts[0]!.assetId.equals(assetId)).to.be.true
    expect(pendingAmounts[0]!.centrifugeId).to.equal(centId)
    expect(pendingAmounts[0]!.pendingDeposit).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.pendingRedeem).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.pendingIssuancesTotal).to.be.instanceOf(Balance)
    expect(pendingAmounts[0]!.pendingRevocationsTotal).to.be.instanceOf(Balance)

    // TODO:
    // expect approvedAt values once they are available, right now we pendingIssuances and pendingRevocations return as empty list
  })

  it.skip('gets queued (outstanding) amounts per asset and chain', async () => {
    const outstandingInvests = await firstValueFrom(shareClass._epochOutstandingInvests())
    const outstandingRedeems = await firstValueFrom(shareClass._epochOutstandingRedeems())

    expect(outstandingInvests.length).to.be.greaterThan(0)
    expect(outstandingRedeems.length).to.be.greaterThan(0)

    expect(outstandingInvests[0]!.assetId).to.be.instanceOf(AssetId)
    expect(outstandingInvests[0]!.amount).to.be.instanceOf(Balance)
    expect(outstandingInvests[0]!.centrifugeId).to.be.a('string')

    expect(outstandingRedeems[0]!.assetId).to.be.instanceOf(AssetId)
    expect(outstandingRedeems[0]!.amount).to.be.instanceOf(Balance)
    expect(outstandingRedeems[0]!.centrifugeId).to.be.a('string')

    const pendingAmounts = await shareClass.pendingAmounts()
    const row = pendingAmounts.find((r) => r.assetId.equals(assetId) && r.centrifugeId === centId)!
    expect(row.queuedInvest).to.be.instanceOf(Balance)
    expect(row.queuedRedeem).to.be.instanceOf(Balance)
  })

  it('gets investor orders', async () => {
    const investorOrders = await shareClass.investorOrders()

    expect(investorOrders.get('0x423420ae467df6e90291fd0252c0a8a637c1e03f')).to.deep.equal([
      {
        assetId,
        investor: '0x423420ae467df6e90291fd0252c0a8a637c1e03f',
        maxDepositClaims: 1,
        maxRedeemClaims: 1,
        pendingDeposit: 30000000000000000000n,
        pendingRedeem: 30000000000000000000n,
      },
      {
        assetId: assetId2,
        investor: '0x423420ae467df6e90291fd0252c0a8a637c1e03f',
        maxDepositClaims: 0,
        maxRedeemClaims: 1,
        pendingDeposit: 0n,
        pendingRedeem: 10000000000000000000n,
      },
    ])
  })

  describe.skip('approveDepositsAndIssueShares', () => {
    let vault: Vault

    before(async () => {
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw)
      const shareClass = new ShareClass(centrifuge, pool, scId.raw)
      vault = await pool.vault(chainId, shareClass.id, assetId)
    })

    it.skip('should throw when issue price is 0', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const pendingAmounts = await vault.shareClass.pendingAmounts()
      const pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      try {
        await shareClass.approveDepositsAndIssueShares([
          {
            assetId,
            approveAssetAmount: pendingAmount.pendingDeposit,
            issuePricePerShare: Price.fromFloat(0),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Issue price per share must be greater than 0 for asset')
      }
    })

    it.skip('approves deposits and issues shares', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const pendingAmounts = await vault.shareClass.pendingAmounts()
      const pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      const tx = await shareClass.approveDepositsAndIssueShares([
        {
          assetId,
          approveAssetAmount: pendingAmount.pendingDeposit,
          issuePricePerShare: Price.fromFloat(1),
        },
      ])

      expect(tx.type).to.equal('TransactionConfirmed')
    })

    it.skip('should throw when assets are not unique', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const pendingAmounts = await vault.shareClass.pendingAmounts()
      const pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      try {
        await shareClass.approveDepositsAndIssueShares([
          {
            assetId,
            approveAssetAmount: pendingAmount.pendingDeposit,
            issuePricePerShare: Price.fromFloat(1),
          },
          {
            assetId,
            approveAssetAmount: pendingAmount.pendingDeposit,
            issuePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Assets array contains multiple entries for the same asset ID')
      }
    })

    it.skip('should throw when approve amount exceeds pending amount', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const pendingAmounts = await vault.shareClass.pendingAmounts()
      const pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      try {
        await shareClass.approveDepositsAndIssueShares([
          {
            assetId,
            approveAssetAmount: pendingAmount.pendingDeposit.add(new Balance(1, 6)),
            issuePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Approve amount exceeds pending amount for asset')
      }
    })

    it.skip('should throw when approve amount is zero', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      try {
        await shareClass.approveDepositsAndIssueShares([
          {
            assetId,
            approveAssetAmount: new Balance(0, 6),
            issuePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Approve amount must be greater than 0 for asset')
      }
    })

    it.skip('should throw when issue epoch is greater than deposit epoch', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      try {
        await shareClass.approveDepositsAndIssueShares([
          {
            assetId,
            issuePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Nothing to issue')
      }
    })
  })

  describe.skip('approveRedeemsAndRevokeShares', () => {
    let vault: Vault
    let pendingAmount: Awaited<ReturnType<typeof shareClass.pendingAmounts>>[number]

    before(async () => {
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw)
      const sc = new ShareClass(centrifuge, pool, scId.raw)
      vault = await pool.vault(chainId, sc.id, assetId)
      const defaultSharesAmount = Balance.fromFloat(100, 18)

      await mint(vault._asset, investor)

      let investment = await vault.investment(investor)

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await vault.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)

      // Make sure price is up-to-date
      await vault.shareClass.notifyAssetPrice(assetId)

      // Add member, to be able to redeem
      ;[, investment] = await Promise.all([
        vault.shareClass.updateMember(investor, 1800000000, chainId),
        firstValueFrom(vault.investment(investor).pipe(skip(1))),
      ])

      context.tenderlyFork.impersonateAddress = investor
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      // Invest
      ;[, investment] = await Promise.all([
        lastValueFrom(vault.asyncDeposit(defaultAssetsAmount).pipe(toArray())),
        firstValueFrom(
          vault.investment(investor).pipe(skipWhile((i) => !i.pendingDepositAssets.eq(defaultAssetsAmount.toBigInt())))
        ),
      ])

      expect(investment.pendingDepositAssets.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      let pendingAmounts = await vault.shareClass.pendingAmounts()
      pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      // Approve deposits
      await vault.shareClass.approveDepositsAndIssueShares([
        {
          assetId,
          approveAssetAmount: pendingAmount.pendingDeposit,
          issuePricePerShare: Price.fromFloat(1),
        },
      ])
      ;[, investment] = await Promise.all([
        vault.shareClass.claimDeposit(assetId, investor),
        firstValueFrom(
          vault
            .investment(investor)
            .pipe(skipWhile((i) => !i.claimableDepositShares.eq(defaultSharesAmount.toBigInt())))
        ),
      ])

      context.tenderlyFork.impersonateAddress = investor
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      // Claim shares
      ;[, investment] = await Promise.all([
        vault.claim(),
        firstValueFrom(vault.investment(investor).pipe(skipWhile((i) => !i.claimableDepositShares.eq(0n)))),
      ])

      const redeemShares = Balance.fromFloat(40, 18)
      ;[, investment, pendingAmounts] = await Promise.all([
        vault.asyncRedeem(redeemShares),
        firstValueFrom(
          vault.investment(investor).pipe(skipWhile((i) => !i.pendingRedeemShares.eq(redeemShares.toBigInt())))
        ),
        firstValueFrom(
          vault.shareClass
            .pendingAmounts()
            .pipe(skipWhile((p) => p.find((a) => a.assetId.equals(assetId))!.pendingRedeem.eq(0n)))
        ),
      ])

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!
    })

    it('should throw when revoke price per share is 0 or less', async () => {
      try {
        await vault.shareClass.approveRedeemsAndRevokeShares([
          {
            assetId,
            approveShareAmount: pendingAmount.pendingRedeem,
            revokePricePerShare: Price.fromFloat(0),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Revoke price per share must be greater than 0 for asset')
      }
    })

    it('approves redeems and revokes shares', async () => {
      const tx = await shareClass.approveRedeemsAndRevokeShares([
        {
          assetId,
          approveShareAmount: pendingAmount.pendingRedeem,
          revokePricePerShare: Price.fromFloat(1),
        },
      ])

      expect(tx.type).to.equal('TransactionConfirmed')
    })

    it('should throw when assets are not unique', async () => {
      try {
        await shareClass.approveRedeemsAndRevokeShares([
          {
            assetId,
            approveShareAmount: pendingAmount.pendingRedeem,
            revokePricePerShare: Price.fromFloat(1),
          },
          {
            assetId,
            approveShareAmount: pendingAmount.pendingRedeem,
            revokePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Assets array contains multiple entries for the same asset ID')
      }
    })

    it('should throw when share amounts exceeds pending redeem', async () => {
      try {
        await shareClass.approveRedeemsAndRevokeShares([
          {
            assetId,
            approveShareAmount: pendingAmount.pendingRedeem.add(new Balance(1, 6)),
            revokePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Share amount exceeds pending redeem for asset')
      }
    })

    it('should throw when share amount is zero or less', async () => {
      try {
        await shareClass.approveRedeemsAndRevokeShares([
          {
            assetId,
            approveShareAmount: new Balance(0, 6),
            revokePricePerShare: Price.fromFloat(1),
          },
        ])
      } catch (error: any) {
        expect(error.message).to.include('Share amount must be greater than 0 for asset')
      }
    })
  })

  describe('claimDeposit', () => {
    it('should be able to claim a deposit', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const result = await shareClass.claimDeposit(assetId, investor)

      expect(result.type).to.equal('TransactionConfirmed')
    })
  })

  describe('claimRedeem', () => {
    it.skip('should be able to claim a redemption', async () => {
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw)
      const sc = new ShareClass(centrifuge, pool, scId.raw)
      const vault = await pool.vault(chainId, sc.id, assetId)
      const defaultSharesAmount = Balance.fromFloat(100, 18)
      const investor = randomAddress()

      await context.tenderlyFork.fundAccountEth(investor, 10n ** 18n)

      await mint(vault._asset, investor)

      let investment = await vault.investment(investor)

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await vault.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)

      // Make sure price is up-to-date
      await vault.shareClass.notifyAssetPrice(assetId)

      // Add member, to be able to redeem
      ;[, investment] = await Promise.all([
        vault.shareClass.updateMember(investor, 1800000000, chainId),
        firstValueFrom(vault.investment(investor).pipe(skip(1))),
      ])

      context.tenderlyFork.impersonateAddress = investor
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      // Invest
      ;[, investment] = await Promise.all([
        lastValueFrom(vault.asyncDeposit(defaultAssetsAmount).pipe(toArray())),
        firstValueFrom(
          vault.investment(investor).pipe(skipWhile((i) => !i.pendingDepositAssets.eq(defaultAssetsAmount.toBigInt())))
        ),
      ])

      expect(investment.pendingDepositAssets.toBigInt()).to.equal(defaultAssetsAmount.toBigInt())

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      let pendingAmounts = await vault.shareClass.pendingAmounts()
      let pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      await vault.shareClass.approveDepositsAndIssueShares([
        {
          assetId,
          approveAssetAmount: pendingAmount.pendingDeposit,
          issuePricePerShare: Price.fromFloat(1),
        },
      ])

      // Approve deposits
      ;[, investment] = await Promise.all([
        shareClass.claimDeposit(assetId, investor),
        firstValueFrom(
          vault
            .investment(investor)
            .pipe(skipWhile((i) => !i.claimableDepositShares.eq(defaultSharesAmount.toBigInt())))
        ),
      ])

      context.tenderlyFork.impersonateAddress = investor
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      // Claim shares
      ;[, investment] = await Promise.all([
        vault.claim(),
        firstValueFrom(vault.investment(investor).pipe(skipWhile((i) => !i.claimableDepositShares.eq(0n)))),
      ])

      const redeemShares = Balance.fromFloat(40, 18)
      ;[, investment, pendingAmounts] = await Promise.all([
        vault.asyncRedeem(redeemShares),
        firstValueFrom(
          vault.investment(investor).pipe(skipWhile((i) => !i.pendingRedeemShares.eq(redeemShares.toBigInt())))
        ),
        firstValueFrom(
          vault.shareClass
            .pendingAmounts()
            .pipe(skipWhile((p) => p.find((a) => a.assetId.equals(assetId))!.pendingRedeem.eq(0n)))
        ),
      ])

      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      pendingAmount = pendingAmounts.find((p) => p.assetId.equals(assetId))!

      await vault.shareClass.approveRedeemsAndRevokeShares([
        {
          assetId,
          approveShareAmount: pendingAmount.pendingRedeem,
          revokePricePerShare: Price.fromFloat(1),
        },
      ])

      // Approve redeems
      const [result] = await Promise.all([
        shareClass.claimRedeem(assetId, investor),
        firstValueFrom(vault.investment(investor).pipe(skipWhile((i) => i.claimableRedeemAssets.eq(0n)))),
      ])

      expect(result.type).to.equal('TransactionConfirmed')
    })
  })

  describe('updateSharePrice', () => {
    let shareClass: ShareClass
    let pool: Pool

    before(() => {
      const { centrifuge } = context
      pool = new Pool(centrifuge, poolId.raw)
      shareClass = new ShareClass(centrifuge, pool, scId.raw)
    })

    it('should update share price', async () => {
      context.tenderlyFork.impersonateAddress = fundManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const newPrice = Price.fromFloat(1.5)

      const tx = await shareClass.updateSharePrice(newPrice)

      expect(tx.type).to.equal('TransactionConfirmed')

      const protocolAddress = await context.centrifuge._protocolAddresses(centId)

      const result = await (
        await context.centrifuge.getClient(centId)
      ).readContract({
        address: protocolAddress.spoke,
        abi: ABI.Spoke,
        functionName: 'pricePoolPerShare',
        args: [pool.id.raw, shareClass.id.raw, false],
      })

      expect(result).equal(newPrice.toBigInt())
    })
  })

  // TODO - waiting for indexer.
  it.skip('gets all investors by vault with pending and claimable balances', async () => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw)
    const shareClass = new ShareClass(centrifuge, pool, scId.raw)

    const result = await firstValueFrom(shareClass.investmentsByVault(centId))

    expect(result).to.be.an('array')
    expect(result.length).to.be.greaterThan(0)

    const item = result[0]!
    expect(item).to.have.property('investor')
    expect(item).to.have.property('assetId')
    expect(item).to.have.property('chainId')
    expect(item).to.have.property('epoch')
    expect(item).to.have.property('epochType')
    expect(item).to.have.property('investorAmount')
    expect(item).to.have.property('totalEpochAmount')

    expect(item.assetId).to.be.instanceOf(AssetId)
    expect(item.investorAmount).to.be.instanceOf(Balance)
    expect(item.totalEpochAmount).to.be.instanceOf(Balance)
    expect(['deposit', 'issue', 'redeem', 'revoke']).to.include(item.epochType)
  })

  describe('closedInvestments', () => {
    it('gets closed investment orders', async () => {
      const closedInvestments = await shareClass.closedInvestments()

      expect(closedInvestments).to.be.an('array')

      if (closedInvestments.length > 0) {
        const investment = closedInvestments[0]!

        expect(investment).to.have.keys([
          'investor',
          'index',
          'assetId',
          'approvedAmount',
          'approvedAt',
          'issuedAmount',
          'issuedAt',
          'priceAsset',
          'pricePerShare',
          'claimedAt',
          'isClaimed',
          'asset',
        ])

        expect(investment.investor).to.be.a('string')
        expect(investment.investor.toLowerCase()).to.equal(investment.investor)
        expect(investment.index).to.be.a('number')
        expect(investment.assetId).to.be.instanceOf(AssetId)
        expect(investment.approvedAmount).to.be.instanceOf(Balance)
        expect(investment.issuedAmount).to.be.instanceOf(Balance)
        expect(investment.priceAsset).to.be.instanceOf(Price)
        expect(investment.pricePerShare).to.be.instanceOf(Price)
        expect(typeof investment.isClaimed).to.equal('boolean')

        expect(investment.asset).to.have.keys(['symbol', 'name', 'decimals'])
        expect(investment.asset.symbol).to.be.a('string')
        expect(investment.asset.name).to.be.a('string')
        expect(investment.asset.decimals).to.be.a('number')
      }
    })

    it('returns only issued orders', async () => {
      const closedInvestments = await shareClass.closedInvestments()

      closedInvestments.forEach((investment) => {
        expect(investment.issuedAt).to.not.be.null
      })
    })
  })

  describe('closedRedemptions', () => {
    it('gets closed redemption orders', async () => {
      const closedRedemptions = await shareClass.closedRedemptions()

      expect(closedRedemptions).to.be.an('array')

      if (closedRedemptions.length > 0) {
        const redemption = closedRedemptions[0]!

        expect(redemption).to.have.keys([
          'investor',
          'index',
          'assetId',
          'approvedAmount',
          'approvedAt',
          'payoutAmount',
          'revokedAt',
          'priceAsset',
          'pricePerShare',
          'claimedAt',
          'isClaimed',
          'asset',
        ])

        expect(redemption.investor).to.be.a('string')
        expect(redemption.investor.toLowerCase()).to.equal(redemption.investor)
        expect(redemption.index).to.be.a('number')
        expect(redemption.assetId).to.be.instanceOf(AssetId)
        expect(redemption.approvedAmount).to.be.instanceOf(Balance)
        expect(redemption.payoutAmount).to.be.instanceOf(Balance)
        expect(redemption.priceAsset).to.be.instanceOf(Price)
        expect(redemption.pricePerShare).to.be.instanceOf(Price)
        expect(typeof redemption.isClaimed).to.equal('boolean')
        expect(redemption.asset).to.have.keys(['symbol', 'name', 'decimals'])
        expect(redemption.asset.symbol).to.be.a('string')
        expect(redemption.asset.name).to.be.a('string')
        expect(redemption.asset.decimals).to.be.a('number')
      }
    })

    it('returns only revoked orders', async () => {
      const closedRedemptions = await shareClass.closedRedemptions()

      closedRedemptions.forEach((redemption) => {
        expect(redemption.revokedAt).to.not.be.null
        expect(redemption.revokedAt).to.be.string
      })
    })
  })
})

async function mint(asset: string, address: string) {
  context.tenderlyFork.impersonateAddress = protocolAdmin
  context.centrifuge.setSigner(context.tenderlyFork.signer)

  await context.centrifuge._transact(async function* (ctx) {
    yield* doTransaction('Mint', ctx, async () => {
      return ctx.walletClient.writeContract({
        address: asset as any,
        abi: parseAbi(['function mint(address, uint256)']),
        functionName: 'mint',
        args: [address as any, defaultAssetsAmount.toBigInt()],
      })
    })
  }, chainId)
}
