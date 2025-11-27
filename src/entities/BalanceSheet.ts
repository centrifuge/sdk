import { encodeFunctionData, toHex } from 'viem'
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
import { isEIP1193ProviderLike } from '../utils/isEIP1193ProviderLike.js'

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
        assetAddress,
        tokenId
      )

      const needsApproval = allowance < amount.toBigInt()

      // Try batching using EIP-5792 for any EIP1193Provider (i.e. Safe or Coinbase wallets) when approval is needed.
      // Using multicall only works on a single contract, and we need to call both the token contract and the balance sheet contract.
      if (needsApproval && isEIP1193ProviderLike(ctx.signer)) {
        const provider = ctx.signer

        const approveTxData = () => {
          if (tokenId) {
            return encodeFunctionData({
              abi: ABI.ERC6909,
              functionName: 'approve',
              args: [balanceSheet, tokenId, amount.toBigInt()],
            })
          }
          return encodeFunctionData({
            abi: ABI.Currency,
            functionName: 'approve',
            args: [balanceSheet, amount.toBigInt()],
          })
        }

        const depositTxData = encodeFunctionData({
          abi: ABI.BalanceSheet,
          functionName: 'deposit',
          args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, amount.toBigInt()],
        })

        const calls = [
          { to: assetAddress, data: approveTxData() },
          { to: balanceSheet, data: depositTxData },
        ]

        try {
          // Try EIP-5792 wallet_sendCalls for batching approve + deposit.
          yield* doTransaction('Approve and Deposit', ctx, async () => {
            const batchCallId = await provider.request({
              method: 'wallet_sendCalls',
              params: [
                {
                  version: '1.0',
                  chainId: toHex(self.chainId),
                  from: ctx.signingAddress,
                  calls,
                },
              ],
            })
            return batchCallId as HexString
          })
          return
        } catch (error) {
          console.warn('Batching not supported, using sequential transactions:', error)

          // Fallback to sequential transactions if batching fails.
          for (const [index, call] of calls.entries()) {
            yield* doTransaction(`Approve and Deposit (${index + 1}/${calls.length})`, ctx, () =>
              ctx.walletClient.sendTransaction({
                to: call.to,
                data: call.data,
              })
            )
          }
          return
        }
      }

      if (needsApproval) {
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

  /**
   * Revokes shares from a specific user in the balance sheet.
   * * Calculates the number of shares to revoke.
   * @param user - The address of the user from whom shares will be revoked.
   * @param amount - The monetary value (currency amount) to revoke.
   * @param pricePerShare - The price per share used to calculate the number of shares to revoke.
   */
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
        args: [self.pool.id.raw, self.shareClass.id.raw, user, user, ctx.signingAddress, shares.toBigInt()],
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
