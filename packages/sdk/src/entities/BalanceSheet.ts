import { combineLatest, defer, firstValueFrom, switchMap, throwError } from 'rxjs'
import { encodeFunctionData, toHex, type PublicClient } from 'viem'
import { ABIS_V3_3, builders, SHARE_REVOKE_EXTRA_GAS, STANDARD_ABIS } from '@centrifuge/protocol'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { isEIP1193ProviderLike } from '../utils/isEIP1193ProviderLike.js'
import { MessageType, MessageTypeV3_3, messageV3_3, type MessageTypeWithSubType } from '../types/transaction.js'
import {
  balanceSheetAbi,
  balanceSheetAddress,
  builderContext,
  isV3_3,
  poolEscrowAt,
  queueAbi,
  queueAddress,
} from '../utils/protocolVersion.js'
import { repeatOnEvents } from '../utils/rx.js'
import { spokeAssets } from '../utils/spokeAssets.js'
import { doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

/**
 * The share COUNT a direct issue or revoke moves, from a pool-currency amount
 * and a price.
 *
 * One function rather than a copy in each method, because the two methods have
 * a second caller: the backend's `issueSharesDirect` /
 * `revokeSharesDirect` actions take the share count as data, and the local
 * multicall encodes it into `BalanceSheet.issue` / `.revoke`. If the two
 * derivations drifted, the same call would move a different number of shares
 * depending on which strategy served it, and the parity test that compares
 * them would still pass — it builds both from this one function.
 *
 * A zero price means "no conversion": the amount IS the share count. Kept
 * exactly as it was, and note that the backend refuses that case rather than
 * reproducing it (see {@link BalanceSheet.issue}).
 */
function sharesFor(amount: Balance, pricePerShare: Price, verb: 'issue' | 'revoke'): Balance {
  const shares = pricePerShare.isZero()
    ? amount
    : new Balance(
        (amount.toBigInt() * 10n ** BigInt(pricePerShare.decimals)) / pricePerShare.toBigInt(),
        amount.decimals
      )
  if (shares.isZero()) throw new Error(`Cannot ${verb} 0 shares`)
  return shares
}

/**
 * Query and interact with the balanceSheet, which is the main entry point for withdrawing and depositing funds.
 * A BalanceSheet exists for every ShareClass on any network that Vaults are deployed on.
 *
 * ## Zero amounts, and where the two modes differ
 *
 * `issue()` and `revoke()` have always refused a zero SHARE COUNT — that is
 * {@link sharesFor}'s throw, and it fires in both modes. `deposit()` and
 * `withdraw()` never had an equivalent guard, and still do not on the local
 * path: a zero-amount transfer builds and is handed to the wallet exactly like
 * any other.
 *
 * On the backend route it is refused. `depositHolding` / `withdrawHolding`
 * declare `amount` as the backend's `OnChainAmountSchema`, which rejects `"0"`
 * at the HTTP boundary (422 `VALIDATION_FAILED`) on the reasoning that a
 * zero-amount transfer moves nothing while costing a signature, a policy
 * evaluation, gas and — on the Fordefi path — an approval quorum, so it is
 * always a client bug.
 *
 * The asymmetry is left in place rather than closed from this side, and the
 * choice is deliberate in both directions. Adding a client-side guard would
 * change public-mode behaviour, which routing a write is not allowed to do;
 * removing the server-side one would give up a real check. The asymmetry
 * errs safe — on the backend route a no-op call is refused loudly, before
 * anything is prepared — and `holdings.backend.test.ts` pins both halves so it
 * cannot drift into being an accident.
 */
export class BalanceSheet extends Entity {
  pool: Pool
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    public shareClass: ShareClass
  ) {
    super(_root, ['balancesheet', shareClass.id.toString(), network.centrifugeId])
    this.pool = network.pool
  }

  get centrifugeId() {
    return this.network.centrifugeId
  }

  balances() {
    return this.shareClass.balances(this.network.centrifugeId)
  }

  /**
   * The escrow this balance sheet holds assets in and {@link withdraw} draws from: the pool's
   * escrow on this network at the pool's resolved protocol version, lowercased.
   *
   * A pool migrated to v3.3 can still have assets in its legacy escrow; `balances()` lists those
   * entries with the legacy `escrowAddress`. Only the entries whose `escrowAddress` equals this
   * one can be withdrawn through this balance sheet.
   */
  escrowAddress() {
    return this.pool._escrow(this.centrifugeId)
  }

  /**
   * The amount of an asset {@link withdraw} can move: `availableBalanceOf` on this balance sheet,
   * which is the escrow's balance less what is reserved for redemptions.
   *
   * Not the same quantity as `balances()[].amount`, which is the indexed escrow balance and
   * includes reserved amounts. Re-read when the balance sheet moves the asset (`NoteDeposit`,
   * `Deposit`, `Withdraw`) and when the escrow reserves or releases it (`IncreaseReserve`,
   * `DecreaseReserve`, on a redemption's approval and claim).
   *
   * @param assetId - An asset on this balance sheet's network; another network's asset throws.
   */
  availableBalance(assetId: AssetId) {
    return this._query(['availableBalance', assetId.toString()], () => {
      if (assetId.centrifugeId !== this.centrifugeId) {
        return throwError(
          () =>
            new Error(
              `Asset ${assetId.toString()} is on centrifugeId ${assetId.centrifugeId}, not on this balance ` +
                `sheet's centrifugeId ${this.centrifugeId}`
            )
        )
      }
      return combineLatest([this.network._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) =>
          // Resolve the asset in the pool's own version, as `deposit` does: a chain running both
          // versions may register it differently in each.
          defer(async () => {
            const { address, tokenId } = await spokeAssets(client, ctx).requireAsset(assetId)
            const currency = await firstValueFrom(this._root.currency(address, this.centrifugeId, tokenId))
            return { address, tokenId, decimals: currency.decimals }
          }).pipe(switchMap((asset) => this.#availableBalanceOf(ctx, client, asset)))
        )
      )
    })
  }

  /**
   * {@link availableBalance} for a caller that already holds the asset's address, token id and
   * decimals, such as a vault: no `idToAsset` or currency read.
   * @internal
   */
  _availableBalanceOf(asset: { address: HexString; tokenId: bigint; decimals: number }) {
    const address = asset.address.toLowerCase() as HexString
    return this._query(['availableBalanceOf', address, asset.tokenId.toString()], () =>
      combineLatest([this.network._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) => this.#availableBalanceOf(ctx, client, { ...asset, address }))
      )
    )
  }

  /**
   * One context's `availableBalanceOf` read, re-read on the balance sheet's and the escrow's
   * events. The escrow comes from the same context as the balance sheet, so a version change
   * never pairs a new balance sheet with an old escrow, and it is only read when there are events
   * to listen to.
   */
  #availableBalanceOf(
    ctx: SdkProtocolContext,
    client: PublicClient,
    asset: { address: HexString; tokenId: bigint; decimals: number }
  ) {
    const balanceSheet = balanceSheetAddress(ctx)
    const assetAddress = asset.address.toLowerCase()
    const read$ = defer(async () => {
      const amount = await client.readContract({
        address: balanceSheet,
        abi: balanceSheetAbi(ctx),
        functionName: 'availableBalanceOf',
        args: [this.pool.id.raw, this.shareClass.id.raw, asset.address, asset.tokenId],
      })
      return new Balance(amount, asset.decimals)
    })
    if (this._root.config.disableRepeatOnEvents) return read$
    return defer(() => poolEscrowAt(client, ctx, this.pool.id)).pipe(
      switchMap((escrow) =>
        read$.pipe(
          repeatOnEvents(
            this._root,
            {
              // The balance events come from BalanceSheet (v3.2) or Spoke (v3.3), which
              // `balanceSheetAddress` names; the reserve events come from the escrow. The escrow
              // emits its own `Deposit` and `Withdraw` too, with the same args, so a balance
              // movement matches on both addresses. Harmless: both land in the same block and
              // trigger one extra re-read of the same value.
              address: [balanceSheet, escrow],
              eventName: ['NoteDeposit', 'Deposit', 'Withdraw', 'IncreaseReserve', 'DecreaseReserve'],
              filter: (events) =>
                events.some(
                  (event) =>
                    event.args.poolId === this.pool.id.raw &&
                    event.args.scId === this.shareClass.id.raw &&
                    event.args.asset?.toLowerCase() === assetAddress &&
                    event.args.tokenId === asset.tokenId
                ),
            },
            this.centrifugeId,
            ctx.protocolVersion
          )
        )
      )
    )
  }

  /**
   * What this balance sheet has queued for the hub and not yet submitted: the gross deposits and
   * withdrawals per asset, and the net share delta: an issuance when `isPositive`, a revocation
   * otherwise, in the pool's decimals.
   *
   * Until it is submitted, none of it is in the hub's holdings or share count, so the NAV does not
   * see it. Every deposit, withdrawal, issuance and revocation queues, on v3.2 and v3.3 alike, and
   * nothing is sent until {@link submitQueued} runs. The queue is `SnapshotQueue` on v3.3 and the
   * `BalanceSheet`'s own on v3.2.
   *
   * @param assetIds - The assets on this network to read, such as the share class's holdings
   *   here. The queue cannot be listed, only read per asset.
   */
  queued(assetIds: AssetId[]) {
    return this._query(['queued', ...assetIds.map((id) => id.toString())], () =>
      combineLatest([this.network._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) =>
          defer(async () => {
            const [queue, poolDecimals, assetDecimals] = await Promise.all([
              this.#readQueue(ctx, client, assetIds),
              firstValueFrom(this.pool.decimals()),
              Promise.all(assetIds.map((assetId) => this.#assetDecimals(client, ctx, assetId))),
            ])
            return {
              assets: queue.assets.map(({ assetId, deposits, withdrawals }, i) => ({
                assetId,
                deposits: new Balance(deposits, assetDecimals[i]!),
                withdrawals: new Balance(withdrawals, assetDecimals[i]!),
              })),
              shares: { delta: new Balance(queue.shares.delta, poolDecimals), isPositive: queue.shares.isPositive },
            }
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: queueAddress(ctx),
                eventName: isV3_3(ctx)
                  ? ['QueueAssets', 'QueueShares', 'SubmitQueuedAssets', 'SubmitQueuedShares']
                  : [
                      'Deposit',
                      'NoteDeposit',
                      'Withdraw',
                      'NoteWithdraw',
                      'Issue',
                      'Revoke',
                      'SubmitQueuedAssets',
                      'SubmitQueuedShares',
                    ],
                filter: (events) =>
                  events.some(
                    (event) => event.args.poolId === this.pool.id.raw && event.args.scId === this.shareClass.id.raw
                  ),
              },
              this.centrifugeId,
              ctx.protocolVersion
            )
          )
        )
      )
    )
  }

  /** The raw queue: the write path needs no decimals, only which deltas are non-zero. */
  async #readQueue(ctx: SdkProtocolContext, client: PublicClient, assetIds: AssetId[]) {
    for (const assetId of assetIds) {
      if (assetId.centrifugeId !== this.centrifugeId) {
        throw new Error(
          `Asset ${assetId.toString()} is on centrifugeId ${assetId.centrifugeId}, not on this balance ` +
            `sheet's centrifugeId ${this.centrifugeId}`
        )
      }
    }
    const address = queueAddress(ctx)
    const abi = queueAbi(ctx)
    const poolId = this.pool.id.raw
    const scId = this.shareClass.id.raw
    const [assets, [delta, isPositive]] = await Promise.all([
      Promise.all(
        assetIds.map(async (assetId) => {
          const [deposits, withdrawals] = await client.readContract({
            address,
            abi,
            functionName: 'queuedAssets',
            args: [poolId, scId, assetId.raw],
          })
          return { assetId, deposits, withdrawals }
        })
      ),
      client.readContract({ address, abi, functionName: 'queuedShares', args: [poolId, scId] }),
    ])
    return { assets, shares: { delta, isPositive } }
  }

  async #assetDecimals(client: PublicClient, ctx: SdkProtocolContext, assetId: AssetId) {
    const { address, tokenId } = await spokeAssets(client, ctx).requireAsset(assetId)
    const currency = await firstValueFrom(this._root.currency(address, this.centrifugeId, tokenId))
    return currency.decimals
  }

  /**
   * The fields every balance-sheet action shares.
   *
   * `centrifugeId` is explicit and required on all four: `BalanceSheet` is a
   * SPOKE contract and nothing in a pool id says which spoke an operation
   * targets.
   */
  #actionScope() {
    return {
      poolId: this.pool.id.toString(),
      scId: this.shareClass.id.raw,
      centrifugeId: String(this.centrifugeId),
    }
  }

  /**
   * Move assets into the pool's balance sheet.
   *
   * Routed to the backend's `depositHolding` action in backend mode.
   * Two differences from the local path, both deliberate and both the
   * backend's design rather than an omission here:
   *
   * - The asset's contract address and ERC-6909 token id are NOT sent. The
   *   backend resolves them from the `chain_v1` projection, so a caller cannot
   *   name asset 42 in the audit row while moving a different token.
   * - No ERC-20 approval is prepended. The backend's builder emits the deposit
   *   alone, because an approval is the signer's own allowance rather than a
   *   pool action; and this class cannot add one on the side, because on the
   *   custodial route the signer is a Fordefi vault and a browser-wallet
   *   approval would raise the wrong account's allowance. The allowance is the
   *   operator's to arrange and a short one reverts on chain — see
   *   `ACTION_ROUTES` in `data/routing.ts`.
   * - A ZERO amount is refused. See {@link BalanceSheet} for the whole
   *   asymmetry; it applies to `withdraw` as well.
   */
  deposit(assetId: AssetId, amount: Balance) {
    return this._root._routeDeferredTransaction(
      'depositHolding',
      this.pool.id.toString(),
      async () => ({
        ...this.#actionScope(),
        assetId: assetId.toString(),
        amount: amount.toBigInt().toString(),
        source: 'wallet',
      }),
      {
        title: 'Deposit',
        centrifugeId: this.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () => this.#depositLocal(assetId, amount),
      }
    )
  }

  #depositLocal(assetId: AssetId, amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [client, spokeCtx, isBalanceSheetManager] = await Promise.all([
        firstValueFrom(self._root.getClient(self.network.centrifugeId)),
        self.network._protocolContext(),
        self.pool.isBalanceSheetManager(self.network.centrifugeId, ctx.signingAddress),
      ])
      const balanceSheet = balanceSheetAddress(spokeCtx)
      const balanceSheetAbi_ = balanceSheetAbi(spokeCtx)

      if (!isBalanceSheetManager) {
        throw new Error('Signing address is not a BalanceSheetManager')
      }

      const { address: assetAddress, tokenId } = await spokeAssets(client, spokeCtx).requireAsset(assetId)

      const allowance = await self._root._allowance(
        ctx.signingAddress,
        balanceSheet,
        self.network.centrifugeId,
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
              abi: STANDARD_ABIS.ERC6909,
              functionName: 'approve',
              args: [balanceSheet, tokenId, amount.toBigInt()],
            })
          }
          return encodeFunctionData({
            abi: STANDARD_ABIS.Currency,
            functionName: 'approve',
            args: [balanceSheet, amount.toBigInt()],
          })
        }

        const depositTxData = encodeFunctionData({
          abi: balanceSheetAbi_,
          functionName: 'deposit',
          args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, amount.toBigInt()],
        })

        const calls = [
          { to: assetAddress, data: approveTxData() },
          { to: balanceSheet, data: depositTxData },
        ]

        // Try EIP-5792 wallet_sendCalls for batching approve + deposit
        try {
          const batchCallId = await provider.request({
            method: 'wallet_sendCalls',
            params: [
              {
                version: '1.0',
                chainId: toHex(self.network.centrifugeId),
                from: ctx.signingAddress,
                calls,
              },
            ],
          })
          yield* doTransaction('Approve and Deposit', ctx, async () => batchCallId as HexString)
          return
        } catch (error) {
          console.warn('Batching not supported, using sequential transactions:', error)
        }

        // Fallback to sequential transactions if batching fails
        const callLabels = ['Approve', 'Deposit']
        for (const [index, call] of calls.entries()) {
          yield* doTransaction(`${callLabels[index]} (${index + 1}/${calls.length})`, ctx, () =>
            ctx.walletClient.sendTransaction({
              to: call.to,
              data: call.data,
            })
          )
        }
        return
      }

      if (needsApproval) {
        yield* doTransaction('Approve', ctx, () => {
          if (tokenId) {
            return ctx.walletClient.writeContract({
              address: assetAddress,
              abi: STANDARD_ABIS.ERC6909,
              functionName: 'approve',
              args: [balanceSheet, tokenId, amount.toBigInt()],
            })
          }
          return ctx.walletClient.writeContract({
            address: assetAddress,
            abi: STANDARD_ABIS.Currency,
            functionName: 'approve',
            args: [balanceSheet, amount.toBigInt()],
          })
        })
      }

      yield* doTransaction('Deposit', ctx, () => {
        return ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: balanceSheetAbi_,
          functionName: 'deposit',
          args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, amount.toBigInt()],
        })
      })
    }, this.centrifugeId)
  }

  /**
   * Move assets out of the pool's balance sheet.
   *
   * Routed to the backend's `withdrawHolding` action in backend mode.
   * `to` travels as `receiverAddress`; the asset address and token id are
   * resolved server-side, for the same reason as on {@link deposit}.
   */
  withdraw(assetId: AssetId, to: HexString, amount: Balance) {
    return this._root._routeDeferredTransaction(
      'withdrawHolding',
      this.pool.id.toString(),
      async () => ({
        ...this.#actionScope(),
        assetId: assetId.toString(),
        amount: amount.toBigInt().toString(),
        source: 'wallet',
        receiverAddress: to,
      }),
      {
        title: 'Withdraw',
        centrifugeId: this.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () => this.#withdrawLocal(assetId, to, amount),
      }
    )
  }

  #withdrawLocal(assetId: AssetId, to: HexString, amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [client, spokeCtx, isBalanceSheetManager] = await Promise.all([
        firstValueFrom(self._root.getClient(self.centrifugeId)),
        self.network._protocolContext(),
        self.pool.isBalanceSheetManager(self.centrifugeId, ctx.signingAddress),
      ])
      const balanceSheet = balanceSheetAddress(spokeCtx)

      if (!isBalanceSheetManager) {
        throw new Error('Signing address is not a BalanceSheetManager')
      }

      // The pool's version, as `deposit` resolves it, not the chain's newest.
      const { address: assetAddress, tokenId } = await spokeAssets(client, spokeCtx).requireAsset(assetId)

      const tx = encodeFunctionData({
        abi: balanceSheetAbi(spokeCtx),
        functionName: 'withdraw',
        args: [self.pool.id.raw, self.shareClass.id.raw, assetAddress, tokenId, to, amount.toBigInt()],
      })

      yield* wrapTransaction('Withdraw', ctx, {
        contract: balanceSheet,
        data: tx,
      })
    }, this.centrifugeId)
  }

  /**
   * Submit what this balance sheet has queued to the hub: each asset with a queued deposit or
   * withdrawal, then the net share issuance or revocation, in one multicall that pays for every
   * message.
   *
   * {@link deposit}, {@link withdraw}, on/off-ramp transfers and direct issue and revoke only
   * queue; this is the step that sends the result to the hub, netted per asset, for one fee per
   * message. Submitting every queued asset of the share class lets the hub record a snapshot.
   * Repeated assets and assets with nothing queued are skipped, so no message is paid for a zero
   * delta, and a balance sheet with nothing queued throws rather
   * than sending an empty transaction.
   *
   * @param assetIds - The assets to submit, as for {@link queued}.
   */
  submitQueued(assetIds: AssetId[]) {
    const self = this
    const gate = {
      poolId: this.pool.id.toString(),
      action: 'submitQueued',
      targets: [{ centrifugeId: this.centrifugeId }],
    }
    return this._gatedTransact(gate, this.centrifugeId, async function* (ctx) {
      const [client, spokeCtx, isBalanceSheetManager] = await Promise.all([
        firstValueFrom(self._root.getClient(self.centrifugeId)),
        self.network._protocolContext(),
        self.pool.isBalanceSheetManager(self.centrifugeId, ctx.signingAddress),
      ])
      if (!isBalanceSheetManager) {
        throw new Error('Signing address is not a BalanceSheetManager')
      }

      const unique = [...new Map(assetIds.map((assetId) => [assetId.toString(), assetId])).values()]
      const queue = await self.#readQueue(spokeCtx, client, unique)
      const abi = balanceSheetAbi(spokeCtx)
      const poolId = self.pool.id.raw
      const scId = self.shareClass.id.raw
      const assets = queue.assets.filter(({ deposits, withdrawals }) => deposits > 0n || withdrawals > 0n)

      const data = assets.map(({ assetId }) =>
        encodeFunctionData({
          abi,
          functionName: 'submitQueuedAssets',
          args: [poolId, scId, assetId.raw, 0n, ctx.signingAddress],
        })
      )
      const messages: MessageTypeWithSubType[] = assets.map(() => ({
        type: MessageType.UpdateHoldingAmount,
        poolId: self.pool.id,
      }))
      if (queue.shares.delta > 0n) {
        data.push(
          encodeFunctionData({ abi, functionName: 'submitQueuedShares', args: [poolId, scId, 0n, ctx.signingAddress] })
        )
        messages.push({ type: MessageType.UpdateShares, poolId: self.pool.id })
      }
      if (data.length === 0) {
        throw new Error(`Nothing is queued on centrifugeId ${self.centrifugeId} for the given assets`)
      }

      yield* wrapTransaction('Submit to hub', ctx, {
        contract: balanceSheetAddress(spokeCtx),
        data,
        messages: { [self.pool.centrifugeId]: messages },
      })
    })
  }

  /**
   * Issue directly into the balance sheet.
   * @param to - The address that should receive the shares.
   * @param amount - The amount to receive.
   * @param pricePerShare - The price of the shares to issue.
   *
   * Routed to the backend's `issueSharesDirect` action in backend mode.
   * The action takes a share COUNT where this method takes a
   * pool-currency amount, so the division below happens here in both modes and
   * never server-side — the calldata then carries no rounding choice the
   * caller cannot see. Note the backend refuses a zero `pricePoolPerShare`
   * (422): the local path's zero-price branch skips the division and issues
   * the raw amount as shares, which is a different operation wearing the same
   * arguments, and it is refused rather than silently re-interpreted.
   */
  issue(to: HexString, amount: Balance, pricePerShare: Price) {
    return this._root._routeDeferredTransaction(
      'issueSharesDirect',
      this.pool.id.toString(),
      async () => ({
        ...this.#actionScope(),
        address: to,
        shares: sharesFor(amount, pricePerShare, 'issue').toBigInt().toString(),
        pricePoolPerShare: pricePerShare.toBigInt().toString(),
      }),
      {
        title: 'Issue shares',
        centrifugeId: this.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () => this.#issueLocal(to, amount, pricePerShare),
      }
    )
  }

  #issueLocal(to: HexString, amount: Balance, pricePerShare: Price) {
    const self = this
    return this._root._transactForContext(
      () => self.network._protocolContext(),
      (spokeCtx) =>
        isV3_3(spokeCtx)
          ? self.#shareManagerLocal('issue', to, sharesFor(amount, pricePerShare, 'issue'))
          : self.#issueLocalV3_2(to, amount, pricePerShare),
      this.centrifugeId
    )
  }

  #issueLocalV3_2(to: HexString, amount: Balance, pricePerShare: Price) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ balanceSheet, contractAbis: ABI }, isManager] = await Promise.all([
        self.network._protocolContext(),
        self.pool.isBalanceSheetManager(self.centrifugeId, ctx.signingAddress),
      ])
      if (!isManager) throw new Error('Signing address is not a BalanceSheetManager')
      if (!balanceSheet) throw new Error('No BalanceSheet is deployed for this pool')

      const shares = sharesFor(amount, pricePerShare, 'issue')

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

      const resetTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'resetPricePoolPerShare',
        args: [self.pool.id.raw, self.shareClass.id.raw],
      })

      yield* doTransaction('Issue shares', ctx, () =>
        ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: ABI.BalanceSheet,
          functionName: 'multicall',
          args: [[overrideTx, issueTx, resetTx]],
        })
      )
    }, this.centrifugeId)
  }

  /**
   * Revokes shares from a specific user in the balance sheet.
   * * Calculates the number of shares to revoke.
   * @param user - The address of the user from whom shares will be revoked.
   * @param amount - The monetary value (currency amount) to revoke.
   * @param pricePerShare - The price per share used to calculate the number of shares to revoke.
   * @param options.custodianAddress - Where the shares are moved before being
   * burned, and therefore the address that must SIGN. Optional and defaulted to
   * the signing address on the local path, which is exactly what this method
   * has always done. REQUIRED in backend mode, where there is no signing
   * address at build time.
   *
   * Routed to the backend's `revokeSharesDirect` action in backend mode.
   * `BalanceSheet.revoke` burns from `msgSender()` and takes no holder
   * argument, so revoking somebody else's position is a two-step multicall:
   * move the shares to the custodian, then burn. The local path fills the
   * custodian in from `ctx.signingAddress`; the backend cannot, because the
   * signing route is resolved AFTER the calldata is built and the bytes must be
   * identical at preview, at prepare and again during Fordefi's re-derivation.
   *
   * So backend mode refuses rather than guesses. Defaulting to the connected
   * wallet would be the plausible-wrong-value trap: on the custodial route the
   * signer is the pool's Fordefi vault, the shares would land at an address the
   * signer does not control, and the burn would revert after the ceremony.
   */
  revoke(user: HexString, amount: Balance, pricePerShare: Price, options: { custodianAddress?: HexString } = {}) {
    return this._root._routeDeferredTransaction(
      'revokeSharesDirect',
      this.pool.id.toString(),
      async () => {
        if (!options.custodianAddress) {
          throw new Error(
            'balanceSheet.revoke() needs an explicit { custodianAddress } in backend mode: ' +
              'BalanceSheet.revoke burns from the signer, so the shares are transferred there first, ' +
              'and the backend builds the calldata before any signer is resolved. Pass the address ' +
              'that will sign — the pool vault address on the Fordefi route.'
          )
        }
        return {
          ...this.#actionScope(),
          address: user,
          custodianAddress: options.custodianAddress,
          shares: sharesFor(amount, pricePerShare, 'revoke').toBigInt().toString(),
          pricePoolPerShare: pricePerShare.toBigInt().toString(),
        }
      },
      {
        title: 'Revoke shares',
        centrifugeId: this.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () => this.#revokeLocal(user, amount, pricePerShare, options.custodianAddress),
      }
    )
  }

  #revokeLocal(user: HexString, amount: Balance, pricePerShare: Price, custodianAddress?: HexString) {
    const self = this
    return this._root._transactForContext(
      () => self.network._protocolContext(),
      (spokeCtx) =>
        isV3_3(spokeCtx)
          ? self.#shareManagerLocal('revoke', user, sharesFor(amount, pricePerShare, 'revoke'))
          : self.#revokeLocalV3_2(user, amount, pricePerShare, custodianAddress),
      this.centrifugeId
    )
  }

  #revokeLocalV3_2(user: HexString, amount: Balance, pricePerShare: Price, custodianAddress?: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [{ balanceSheet, contractAbis: ABI }, isManager] = await Promise.all([
        self.network._protocolContext(),
        self.pool.isBalanceSheetManager(self.centrifugeId, ctx.signingAddress),
      ])
      if (!isManager) throw new Error('Signing address is not a BalanceSheetManager')
      if (!balanceSheet) throw new Error('No BalanceSheet is deployed for this pool')

      const shares = sharesFor(amount, pricePerShare, 'revoke')
      // Unchanged default: this method has always moved the shares to whoever
      // signs, and `BalanceSheet.revoke` burns from exactly that address.
      const custodian = custodianAddress ?? ctx.signingAddress

      const transferTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'transferSharesFrom',
        args: [self.pool.id.raw, self.shareClass.id.raw, user, user, custodian, shares.toBigInt()],
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

      const resetTx = encodeFunctionData({
        abi: ABI.BalanceSheet,
        functionName: 'resetPricePoolPerShare',
        args: [self.pool.id.raw, self.shareClass.id.raw],
      })

      yield* doTransaction('Revoke shares', ctx, () =>
        ctx.walletClient.writeContract({
          address: balanceSheet,
          abi: ABI.BalanceSheet,
          functionName: 'multicall',
          args: [[transferTx, overrideTx, revokeTx, resetTx]],
        })
      )
    }, this.centrifugeId)
  }

  /**
   * v3.3 direct issue and revoke: a `Hub.managerCall` to the spoke's
   * `ShareManager`, signed by a hub manager on the pool's hub chain.
   *
   * v3.3 has no price override, so there is no spoke-signed multicall to
   * pin a price with; `ShareManager` is the protocol's hub-driven path, and
   * no spoke wallet needs issue or revoke rights. The price only converts the
   * amount into a share count here. The shares move when the message lands
   * on the spoke; revoke pulls them from `account` itself, so there is no
   * custodian. `ShareManager` must already be a spoke manager of the pool on
   * that chain, otherwise the spoke reverts after the message was paid for,
   * so that is checked before anything is signed.
   */
  #shareManagerLocal(kind: 'issue' | 'revoke', account: HexString, shares: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [hubCtx, spokeCtx, isHubManager, spokeClient] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.network._protocolContext(),
        self.pool.isPoolManager(ctx.signingAddress),
        firstValueFrom(self._root.getClient(self.centrifugeId)),
      ])
      if (!isHubManager) throw new Error('Signing address is not a hub manager of the pool')
      const { shareManager, spokeRegistry } = spokeCtx
      if (!shareManager || !spokeRegistry) {
        throw new Error(`No ShareManager is deployed on centrifugeId ${self.centrifugeId}`)
      }
      const isRegistered = await spokeClient.readContract({
        address: spokeRegistry,
        abi: ABIS_V3_3.SpokeRegistry,
        functionName: 'manager',
        args: [self.pool.id.raw, shareManager],
      })
      if (!isRegistered) {
        throw new Error(
          `ShareManager ${shareManager} is not a balance sheet manager of the pool on centrifugeId ` +
            `${self.centrifugeId}. Grant it with pool.updateBalanceSheetManagers before issuing or revoking.`
        )
      }

      const remote = self.centrifugeId !== self.pool.centrifugeId
      const extraGasLimit = kind === 'revoke' && remote ? SHARE_REVOKE_EXTRA_GAS : 0n
      const built = builders.shareManagerCall(builderContext(hubCtx), builderContext(spokeCtx), {
        poolId: self.pool.id.toString(),
        scId: self.shareClass.id.raw,
        kind,
        account,
        shares: shares.toBigInt().toString(),
        refundAddress: ctx.signingAddress,
        extraGasLimit: extraGasLimit.toString(),
      })

      yield* wrapTransaction(kind === 'issue' ? 'Issue shares' : 'Revoke shares', ctx, {
        contract: built.to,
        policy: { poolId: self.pool.id },
        data: built.data,
        messages: {
          [self.centrifugeId]: [
            {
              ...messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id),
              ...(extraGasLimit > 0n ? { extraGasLimit } : {}),
            },
          ],
        },
      })
    }, this.pool.centrifugeId)
  }
}
