import { encodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

/**
 * Query and interact with the balanceSheet, which is the main entry point for withdrawing and depositing funds.
 * A BalanceSheet exists for every ShareClass on any network that Vaults are deployed on.
 */
export class BalanceSheet extends Entity {
  pool: Pool
  chainId: number
  /** @internal */
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    public shareClass: ShareClass
  ) {
    super(_root, ['balancesheet', shareClass.id.toString(), network.chainId])
    this.chainId = network.chainId
    this.pool = network.pool
  }

  balances() {
    return this.shareClass.balances(this.chainId)
  }

  deposit(assetId: AssetId, amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const client = self._root.getClient(self.chainId)
      const [{ balanceSheet, spoke }, isBalanceSheetManager] = await Promise.all([
        self._root._protocolAddresses(self.chainId),
        self.pool.isBalanceSheetManager(self.chainId, ctx.signingAddress),
      ])

      if (!isBalanceSheetManager) {
        throw new Error('Signing address is not a BalanceSheetManager')
      }

      const [assetAddress, tokenId] = await client.readContract({
        address: spoke,
        abi: ABI.Spoke,
        functionName: 'idToAsset',
        args: [assetId.raw],
      })

      const allowance = await self._root._allowance(
        ctx.signingAddress,
        balanceSheet,
        self.chainId,
        assetAddress as HexString,
        tokenId
      )

      if (allowance < amount.toBigInt()) {
        yield* doTransaction('Approve', ctx, () => {
          if (tokenId) {
            return ctx.walletClient.writeContract({
              address: assetAddress,
              abi: ABI.ERC6909,
              functionName: 'approve',
              args: [balanceSheet, tokenId, amount.toBigInt()],
            })
          }
          return ctx.walletClient.writeContract({
            address: assetAddress,
            abi: ABI.Currency,
            functionName: 'approve',
            args: [balanceSheet, amount.toBigInt()],
          })
        })
      }

      yield* doTransaction('Deposit', ctx, () => {
        return ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: ABI.BalanceSheet,
          functionName: 'deposit',
          args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, amount.toBigInt()],
        })
      })
    }, this.chainId)
  }

  withdraw(assetId: AssetId, to: HexString, amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ balanceSheet }, isBalanceSheetManager] = await Promise.all([
        self._root._protocolAddresses(self.chainId),
        self.pool.isBalanceSheetManager(self.chainId, ctx.signingAddress),
      ])

      if (!isBalanceSheetManager) {
        throw new Error('Signing address is not a BalanceSheetManager')
      }

      const { address: assetAddress, tokenId } = await self._root.assetCurrency(assetId)

      const tx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'withdraw',
        args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, to, amount.toBigInt()],
      })

      yield* wrapTransaction('Withdraw', ctx, {
        contract: balanceSheet,
        data: tx,
      })
    }, this.chainId)
  }

  /**
   * Issue directly into the balance sheet.
   * @param to - The address that should receive the shares.
   * @param amount - The amount to receive.
   * @param pricePerShare - The price of the shares to issue.
   */
  issue(to: HexString, amount: Balance, pricePerShare: Price) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ balanceSheet }, isManager] = await Promise.all([
        self._root._protocolAddresses(self.chainId),
        self.pool.isBalanceSheetManager(self.chainId, ctx.signingAddress),
      ])
      if (!isManager) throw new Error('Signing address is not a BalanceSheetManager')

      const shares = amount.div(pricePerShare.toDecimal())
      if (shares.eq(0n)) throw new Error('Cannot issue 0 shares')

      const overrideTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'overridePricePoolPerShare',
        args: [self.pool.id.raw, self.shareClass.id.raw, pricePerShare.toBigInt()],
      })

      const issueTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'issue',
        args: [self.pool.id.raw, self.shareClass.id.raw, to, shares.toBigInt()],
      })

      yield* doTransaction('Issue shares', ctx, () =>
        ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: ABI.BalanceSheet,
          functionName: 'multicall',
          args: [[overrideTx, issueTx]],
        })
      )
    }, this.chainId)
  }

  revoke(user: HexString, amount: Balance, pricePerShare: Price) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ balanceSheet }, isManager] = await Promise.all([
        self._root._protocolAddresses(self.chainId),
        self.pool.isBalanceSheetManager(self.chainId, ctx.signingAddress),
      ])
      if (!isManager) throw new Error('Signing address is not a BalanceSheetManager')

      const shares = amount.div(pricePerShare.toDecimal())
      if (shares.eq(0n)) throw new Error('Cannot revoke 0 shares')

      const transferTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'transferSharesFrom',
        args: [
          self.pool.id.raw,
          self.shareClass.id.raw,
          ctx.signingAddress,
          user,
          ctx.signingAddress,
          shares.toBigInt(),
        ],
      })

      const overrideTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'overridePricePoolPerShare',
        args: [self.pool.id.raw, self.shareClass.id.raw, pricePerShare.toBigInt()],
      })

      const revokeTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'revoke',
        args: [self.pool.id.raw, self.shareClass.id.raw, shares.toBigInt()],
      })

      yield* doTransaction('Revoke shares', ctx, () =>
        ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: ABI.BalanceSheet,
          functionName: 'multicall',
          args: [[transferTx, overrideTx, revokeTx]],
        })
      )
    }, this.chainId)
  }
}
