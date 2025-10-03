import { expect } from 'chai'
import { parseAbi } from 'viem'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { Balance } from '../utils/BigInt.js'
import { doTransaction } from '../utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

const investor = '0x423420ae467df6e90291fd0252c0a8a637c1e03f'
const protocolAdmin = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)

const defaultAssetsAmount = Balance.fromFloat(100, 6)

describe.skip('Investor', () => {
  describe('portfolio', () => {
    it('should fetch its portfolio', async () => {
      const account = await context.centrifuge.investor(investor)
      const portfolio = await account.portfolio()
      expect(portfolio).to.exist
    })
  })

  describe('investment', () => {
    let vault: Vault
    let sc: ShareClass

    before(async () => {
      const { centrifuge } = context
      const pool = new Pool(centrifuge, poolId.raw, chainId)
      sc = new ShareClass(centrifuge, pool, scId.raw)
      vault = await pool.vault(chainId, sc.id, assetId)
    })

    it('should fetch an investment', async () => {
      await mint(vault._asset, investor)
      const account = await context.centrifuge.investor(investor)
      const investment = await account.investment(poolId, sc.id, assetId, chainId)

      expect(investment).to.not.be.undefined
      expect(investment.investmentCurrency.address).to.equal(vault._asset)
    })
  })

  describe('isMember', () => {
    it('should return true for a member', async () => {
      const account = await context.centrifuge.investor(investor)
      const isMember = await account.isMember(scId, chainId)
      expect(isMember).to.be.true
    })

    it('should return false for a non-member', async () => {
      const account = await context.centrifuge.investor(randomAddress())
      const isMember = await account.isMember(scId, chainId)
      expect(isMember).to.be.false
    })
  })

  // TODO: add more robust testing
  describe('Transactions', () => {
    it('should return transactions for an investor', async () => {
      const account = await context.centrifuge.investor(randomAddress())
      const transactions = await account.transactions(investor, poolId)
      expect(transactions).to.exist
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
