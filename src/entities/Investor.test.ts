import { expect } from 'chai'
import { getAddress, parseAbi } from 'viem'
import { context } from '../tests/setup.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Vault } from './Vault.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'
import { doTransaction } from '../utils/transaction.js'
import { Balance } from '../utils/BigInt.js'
import { randomAddress } from '../tests/utils.js'

const investor = '0x423420ae467df6e90291fd0252c0a8a637c1e03f'
const protocolAdmin = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)

const defaultAssetsAmount = Balance.fromFloat(100, 6)

describe.only('Investor', () => {
  describe('portfolio', () => {
    it('should fetch its portfolio', async () => {
      const account = await context.centrifuge.investor(investor)
      const portfolio = await account.portfolio()
      expect(portfolio).to.exist
    })

    it('should return its checksum address', async () => {
      const account = await context.centrifuge.investor(investor)
      expect(account.address).to.equal(getAddress(investor))
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

      expect(investment).to.deep.equal({
        isAllowedToInvest: true,
        isAllowedToRedeem: true,
        isSyncInvest: false,
        maxInvest: { value: 0n, decimals: 6 },
        claimableInvestShares: { value: 0n, decimals: 18 },
        claimableInvestCurrencyEquivalent: { value: 0n, decimals: 6 },
        claimableRedeemCurrency: { value: 0n, decimals: 6 },
        claimableRedeemSharesEquivalent: { value: 0n, decimals: 18 },
        pendingInvestCurrency: { value: 1000000000n, decimals: 6 },
        pendingRedeemShares: { value: 1467000000000000000000n, decimals: 18 },
        claimableCancelInvestCurrency: { value: 0n, decimals: 6 },
        claimableCancelRedeemShares: { value: 0n, decimals: 18 },
        hasPendingCancelInvestRequest: false,
        hasPendingCancelRedeemRequest: false,
        investmentCurrency: {
          address: '0x3aaaa86458d576bafcb1b7ed290434f0696da65c',
          tokenId: 0n,
          decimals: 6,
          name: 'USD Coin',
          symbol: 'USDC',
          chainId: 11155111,
          supportsPermit: true,
        },
        shareCurrency: {
          address: '0xd8f4f5b0f8a4ffa04b79d3cad11e1b43ad16424b',
          tokenId: 0n,
          decimals: 18,
          name: 'Sepolia Pool One Token',
          symbol: 'sep.poo.one',
          chainId: 11155111,
          supportsPermit: true,
        },
        shareBalance: {
          value: 6470967741935483446189324116743471577n,
          decimals: 18,
        },
        investmentCurrencyBalance: { value: 997987003640000n, decimals: 6 },
        investmentCurrencyAllowance: { value: 0n, decimals: 6 },
      })
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
})

async function mint(asset: string, address: string) {
  context.tenderlyFork.impersonateAddress = protocolAdmin
  context.centrifuge.setSigner(context.tenderlyFork.signer)

  await context.centrifuge._transact(async function* (ctx) {
    yield* doTransaction('Mint', ctx.publicClient, async () => {
      return ctx.walletClient.writeContract({
        address: asset as any,
        abi: parseAbi(['function mint(address, uint256)']),
        functionName: 'mint',
        args: [address as any, defaultAssetsAmount.toBigInt()],
      })
    })
  }, chainId)
}
