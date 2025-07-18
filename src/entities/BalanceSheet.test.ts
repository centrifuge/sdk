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

  it('gets the balances', async () => {
    const balances = await balanceSheet.balances()
    expect(balances).to.have.length.greaterThan(0)
    expect(balances[0]!.amount).to.be.instanceOf(Balance)
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
})
