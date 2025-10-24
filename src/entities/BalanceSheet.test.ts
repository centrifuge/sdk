import { expect } from 'chai'
import { firstValueFrom, toArray } from 'rxjs'
import { context } from '../tests/setup.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const chainId = 11155111
const poolManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const assetId = AssetId.from(1, 2)

describe('BalanceSheet', () => {
  let balanceSheet: BalanceSheet

  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId.raw, chainId)
    const poolNetwork = new PoolNetwork(centrifuge, pool, chainId)
    const shareClass = new ShareClass(centrifuge, pool, scId.raw)
    balanceSheet = new BalanceSheet(centrifuge, poolNetwork, shareClass)
  })

  describe('balances', () => {
    it('gets the balances', async () => {
      const balances = await balanceSheet.balances()
      expect(balances).to.have.length.greaterThan(0)
      expect(balances[0]!.amount).to.be.instanceOf(Balance)
    })
  })

  describe('deposit and withdraw', () => {
    it('throws an error during deposit if signing address is not a BalanceSheetManager', async () => {
      try {
        await balanceSheet.deposit(assetId, Balance.fromFloat(1, 6))
      } catch (error: any) {
        expect(error.message).to.include('Signing address is not a BalanceSheetManager')
      }
    })

    it('throws an error during withdraw if signing address is not a BalanceSheetManager', async () => {
      try {
        await balanceSheet.withdraw(assetId, '0x', Balance.fromFloat(1, 6))
      } catch (error: any) {
        expect(error.message).to.include('Signing address is not a BalanceSheetManager')
      }
    })

    it('withdraws and deposits funds', async () => {
      context.tenderlyFork.impersonateAddress = poolManager
      context.centrifuge.setSigner(context.tenderlyFork.signer)

      const amount = Balance.fromFloat(1, 18)

      await balanceSheet.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)
      await balanceSheet.shareClass.notifyAssetPrice(assetId)

      await balanceSheet.pool.updateBalanceSheetManagers([{ chainId, address: poolManager, canManage: true }])

      await balanceSheet.withdraw(assetId, poolManager, amount)

      const result = await firstValueFrom(balanceSheet.deposit(assetId, amount).pipe(toArray()))

      expect(result[2]!.type).to.equal('TransactionConfirmed')
      expect((result[2] as any).title).to.equal('Approve')
      expect(result[5]!.type).to.equal('TransactionConfirmed')
      expect((result[5] as any).title).to.equal('Deposit')
    })

    describe('issue and revoke', () => {
      it('throws an error during issue if signing address is not a BalanceSheetManager', async () => {
        try {
          await balanceSheet.issue()
        } catch (error: any) {
          expect(error.message).to.include('Signing address is not a BalanceSheetManager')
        }
      })

      it('throws an error during revoke if signing address is not a BalanceSheetManager', async () => {
        try {
          await balanceSheet.revoke()
        } catch (error: any) {
          expect(error.message).to.include('Signing address is not a BalanceSheetManager')
        }
      })

      it.skip('issues and revokes shares', async () => {
        context.tenderlyFork.impersonateAddress = poolManager
        context.centrifuge.setSigner(context.tenderlyFork.signer)

        await balanceSheet.pool.updateBalanceSheetManagers([{ chainId, address: poolManager, canManage: true }])

        await balanceSheet.shareClass.setMaxAssetPriceAge(assetId, 9999999999999)
        await balanceSheet.shareClass.notifyAssetPrice(assetId)

        const pending = await firstValueFrom(balanceSheet.shareClass.pendingAmounts())
        expect(pending.length).to.be.greaterThan(0)

        const txIssue = await balanceSheet.issue()
        expect(txIssue.type).to.equal('TransactionConfirmed')

        const txRevoke = await balanceSheet.revoke()
        expect(txRevoke.type).to.equal('TransactionConfirmed')
      })
    })
  })
})
