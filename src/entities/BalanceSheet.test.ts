import { expect } from 'chai'
import { firstValueFrom, skipWhile, toArray } from 'rxjs'
import { context } from '../tests/setup.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { HexString } from '../index.js'
import { Centrifuge } from '../Centrifuge.js'
import { randomAddress } from '../tests/utils.js'
import { doTransaction } from '../utils/transaction.js'
import { maxUint256, parseAbi } from 'viem'

const centId = 1
const randomNumber = Math.floor(Math.random() * 1_000_000)
const poolId = PoolId.from(centId, randomNumber)
const scId = ShareClassId.from(poolId, 1)
const chainId = 11155111
const fundedAccount = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const assetAddress = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93' // tUSD

describe.only('BalanceSheet', () => {
  let balanceSheet: BalanceSheet
  let poolManager: HexString
  let pool: Pool
  let assetId: AssetId
  let centrifugeWithPin: Centrifuge

  before(async () => {
    const addresses = await context.centrifuge._protocolAddresses(chainId)
    const { centrifuge } = context

    centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async () => {
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })

    await context.tenderlyFork.fundAccountEth(addresses.guardian, 10n ** 18n)

    context.tenderlyFork.impersonateAddress = addresses.guardian
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    await centrifugeWithPin.createPool(
      {
        assetClass: 'Public credit',
        subAssetClass: 'Test Subclass',
        poolName: 'Test Pool',
        poolIcon: { uri: '', mime: '' },
        investorType: 'Retail',
        poolStructure: 'revolving',
        poolType: 'open',
        issuerName: 'Test Issuer',
        issuerRepName: 'Test Rep',
        issuerLogo: { uri: '', mime: '' },
        issuerShortDescription: 'Test Description',
        issuerDescription: 'Test Description',
        website: '',
        forum: '',
        email: '',
        report: null,
        executiveSummary: null,
        details: [],
        issuerCategories: [],
        poolRatings: [],
        listed: false,
        onboardingExperience: 'default',
        shareClasses: [
          {
            tokenName: 'Test Token',
            symbolName: 'TST',
            minInvestment: 1000,
            apyPercentage: 5,
            apy: 'target',
            defaultAccounts: {
              asset: 1000,
              equity: 1001,
              gain: 1001,
              loss: 1001,
              expense: 1002,
              liability: 1001,
            },
          },
        ],
      },
      840,
      chainId,
      randomNumber
    )

    await firstValueFrom(
      centrifuge
        .pools()
        .pipe(skipWhile((pools) => (console.log('pools', pools), !pools.find((p) => p.id.equals(poolId)))))
    )

    poolManager = randomAddress()
    await context.tenderlyFork.fundAccountEth(poolManager, 10n ** 18n)
    pool = new Pool(centrifuge, poolId.raw, chainId)
    await pool.updatePoolManagers([{ address: poolManager, canManage: true }])

    const assets = await centrifuge.assets(chainId)

    try {
      assetId = new AssetId(
        await centrifuge.getClient(chainId).readContract({
          address: addresses.spoke,
          abi: ABI.Spoke,
          functionName: 'assetToId',
          args: [assetAddress, 0n],
        })
      )
    } catch {}

    context.tenderlyFork.impersonateAddress = poolManager
    centrifuge.setSigner(context.tenderlyFork.signer)


    if (!assetId) {
      console.log('registering')
      await centrifuge.registerAsset(chainId, chainId, assetAddress)
    }

    assetId = new AssetId(
      await centrifuge.getClient(chainId).readContract({
        address: addresses.spoke,
        abi: ABI.Spoke,
        functionName: 'assetToId',
        args: [assetAddress, 0n],
      })
    )

    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    const shareClass = new ShareClass(centrifuge, pool, scId.raw)
    balanceSheet = new BalanceSheet(centrifuge, poolNetwork, shareClass)

    await poolNetwork.deploy(
      [{ id: scId, hook: addresses.freezeOnlyHook }],
      [{ shareClassId: scId, assetId, kind: 'syncDeposit' }]
    )

    await shareClass.setMaxAssetPriceAge(assetId, 9999999999999)
    await shareClass.notifyAssetPrice(assetId)

    // setTimeout to make sure everything is indexed
    await new Promise((resolve) => setTimeout(resolve, 2000))
  })

  describe('balances', () => {
    it.only('gets the balances', async () => {
      const amount = Balance.fromFloat(1, 18)

      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await balanceSheet.pool.updateBalanceSheetManagers([{ chainId, address: fundedAccount, canManage: true }])

      context.tenderlyFork.impersonateAddress = fundedAccount
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      await firstValueFrom(pool.isBalanceSheetManager(chainId, fundedAccount).pipe(skipWhile((manager) => !manager)))

      await approve(assetAddress, fundedAccount)

      console.log({ assetId: assetId.toString() })

      await firstValueFrom(balanceSheet.deposit(assetId, amount).pipe(toArray()))

      const balances = await balanceSheet.balances()
      expect(balances).to.have.length.greaterThan(0)
      expect(balances[0]!.amount).to.be.instanceOf(Balance)
    })
  })

  // describe('deposit and withdraw', () => {
  //   it('throws an error during deposit if signing address is not a BalanceSheetManager', async () => {
  //     try {
  //       await balanceSheet.deposit(assetId, Balance.fromFloat(1, 6))
  //     } catch (error: any) {
  //       expect(error.message).to.include('Signing address is not a BalanceSheetManager')
  //     }
  //   })

  //   it('throws an error during withdraw if signing address is not a BalanceSheetManager', async () => {
  //     try {
  //       await balanceSheet.withdraw(assetId, '0x', Balance.fromFloat(1, 6))
  //     } catch (error: any) {
  //       expect(error.message).to.include('Signing address is not a BalanceSheetManager')
  //     }
  //   })

  // it('withdraws and deposits funds', async () => {
  //   context.tenderlyFork.impersonateAddress = poolManager
  //   context.centrifuge.setSigner(context.tenderlyFork.signer)

  //   const amount = Balance.fromFloat(1, 18)

  //   await balanceSheet.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)
  //   await balanceSheet.shareClass.notifyAssetPrice(assetId)

  //   await balanceSheet.pool.updateBalanceSheetManagers([{ chainId, address: poolManager, canManage: true }])

  //   await balanceSheet.withdraw(assetId, poolManager, amount)

  //   const result = await firstValueFrom(balanceSheet.deposit(assetId, amount).pipe(toArray()))

  //   expect(result[2]!.type).to.equal('TransactionConfirmed')
  //   expect((result[2] as any).title).to.equal('Approve')
  //   expect(result[5]!.type).to.equal('TransactionConfirmed')
  //   expect((result[5] as any).title).to.equal('Deposit')
  // })
  // })
})

async function approve(address: string, approvingAccount: HexString) {
  context.tenderlyFork.impersonateAddress = approvingAccount
  context.centrifuge.setSigner(context.tenderlyFork.signer)

  await context.centrifuge._transact(async function* (ctx) {
    yield* doTransaction('Approve', ctx, async () => {
      return ctx.walletClient.writeContract({
        address: address as any,
        abi: parseAbi(['function approve(address, uint) external returns (bool)']),
        functionName: 'approve',
        args: [address as any, maxUint256],
      })
    })
  }, chainId)
}
