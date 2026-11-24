import type { OffRampAddressRow, OffRampRelayerRow, OnRampAssetRow } from '@centrifuge/queries/core'
import { combineLatest, concat, defer, from, map, of, switchMap, type Observable } from 'rxjs'
import { encodeFunctionData, getContract, isAddressEqual, type TransactionReceipt } from 'viem'
import { encodeOnOffRampPayload, type OnOffRampPayload } from '@centrifuge/protocol'
import { Centrifuge, type SdkProtocolContext } from '../Centrifuge.js'
import { Client, HexString } from '../types/index.js'
import {
  MessageType,
  MessageTypeV3_3,
  messageV3_3,
  type MessageTypeWithSubType,
  type OperationStatus,
  type TransactionContext,
} from '../types/transaction.js'
import { toAccountingTokenId } from '../utils/accountingToken.js'
import { Balance } from '../utils/BigInt.js'
import { assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { encodeHubManagerCall, isV3_3, requireContract } from '../utils/protocolVersion.js'
import { isContractRevert, spokeAssets, type SpokeAssets } from '../utils/spokeAssets.js'
import { doTransaction, parseEventLogs, wrapTransaction, type BatchTransactionData } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { notifyAssetPriceCall, PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

enum OnOffRampManagerTrustedCall {
  Onramp,
  Relayer,
  Offramp,
}

type AccountingTokenRef = {
  spoke: HexString
  accountingToken: HexString
  tokenId: bigint
  spokeCtx: SdkProtocolContext
}

type AccountingTokenAsset = AccountingTokenRef & { assetId: AssetId | null; lookups: SpokeAssets }

/** One update to the ramp from the hub, as the v3.2 trusted call and the v3.3 `fromHub` payload. */
type RampUpdate = { title: string; v3_2Payload: () => HexString; v3_3Payload: OnOffRampPayload }

export class OnOffRampManager extends Entity {
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    public shareClass: ShareClass,
    public onrampAddress: HexString
  ) {
    super(_root, ['onofframpmanager', shareClass.id.toString(), network.centrifugeId, onrampAddress.toLowerCase()])

    this.onrampAddress = onrampAddress
  }

  /**
   * Get the receivers of an OnOffRampManager
   */
  receivers() {
    return this._query(['receivers'], () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryData(
            'offRampAddresses',
            {
              tokenId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (items: OffRampAddressRow[]) =>
              // `asset` is null when the join misses (the resolver emits it
              // explicitly). Such a row has no AssetId, so it is dropped rather
              // than asserted away — the assertion threw a TypeError that took
              // the whole list down with it.
              items
                .filter((item): item is OffRampAddressRow & { asset: { id: string } } => item.asset !== null)
                .map((item) => ({
                  assetAddress: item.assetAddress,
                  receiverAddress: item.receiverAddress,
                  assetId: new AssetId(item.asset.id),
                }))
          )
        )
      )
    )
  }

  relayers() {
    return this._query(['relayers'], () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryData(
            'onOffRampRelayers',
            {
              tokenId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (items: OffRampRelayerRow[]) => items.map((item) => item)
          )
        )
      )
    )
  }

  assets() {
    return this._query(['assets'], () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryData(
            'onRampAssets',
            {
              tokenId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (items: OnRampAssetRow[]) =>
              // See `addresses()` — a null `asset` is a join miss, not an error.
              items
                .filter((item): item is OnRampAssetRow & { asset: { id: string } } => item.asset !== null)
                .map((item) => ({
                  assetAddress: item.assetAddress,
                  assetId: new AssetId(item.asset.id),
                }))
          )
        )
      )
    )
  }

  balances() {
    return this._query(['balances'], () =>
      this.assets().pipe(
        switchMap((onRampAssets) => {
          if (onRampAssets.length === 0) return of([])

          return combineLatest(
            onRampAssets.map((item) =>
              this._root.balance(item.assetAddress, this.onrampAddress, this.network.centrifugeId)
            )
          )
        }),
        map((balances) => balances.filter((b) => b.balance.gt(0n)))
      )
    )
  }

  /**
   * Set a receiver address for a given asset. Enabling one also notifies the price of the accounting token
   * `withdraw` deposits; a signed call registers that token on the spoke first if needed.
   * Building or batching requires the accounting token to be registered beforehand.
   * @param assetId - The asset ID to set the receiver for
   * @param receiver - The receiver address to set
   */
  setReceiver(assetId: AssetId, receiver: HexString, enabled: boolean = true) {
    return this._updateRamp(
      {
        title: enabled ? 'Enable Receiver' : 'Disable Receiver',
        v3_2Payload: () => encode([OnOffRampManagerTrustedCall.Offramp, assetId.raw, receiver, enabled]),
        v3_3Payload: { kind: 'offramp', assetId: assetId.toString(), receiver, enabled },
      },
      enabled ? { assetId, liability: false } : undefined
    )
  }

  /**
   * Set a relayer.
   * @param relayer - The relayer address to set
   * @param enabled - Whether the relayer is enabled
   */
  setRelayer(relayer: HexString, enabled: boolean = true) {
    return this._updateRamp({
      title: enabled ? 'Enable Relayer' : 'Disable Relayer',
      v3_2Payload: () => encode([OnOffRampManagerTrustedCall.Relayer, relayer, enabled]),
      v3_3Payload: { kind: 'relayer', relayer, enabled },
    })
  }

  /**
   * Enable an onramp asset. Also notifies the price of the accounting token `deposit` deposits; a signed call
   * registers that token on the spoke first if needed. Building or batching requires prior registration.
   */
  setAsset(assetId: AssetId) {
    return this._updateRamp(
      {
        title: 'Set Asset',
        v3_2Payload: () => encode([OnOffRampManagerTrustedCall.Onramp, assetId.raw, true]),
        v3_3Payload: { kind: 'onramp', assetId: assetId.toString(), enabled: true },
      },
      { assetId, liability: true }
    )
  }

  private _updateRamp(update: RampUpdate, priced?: { assetId: AssetId; liability: boolean }) {
    const self = this
    // Signing happens in nested transactions that each switch chain right before signing.
    return this._transact(
      (ctx) => {
        assertCrosschainMessagingEnabled(self.network.centrifugeId)
        const hubUpdate = (accountingAssetId: AssetId | null) =>
          ctx.isBatching
            ? from(self._hubRampSteps(ctx, update, accountingAssetId))
            : self._transact(
                (hubCtx) => self._hubRampSteps(hubCtx, update, accountingAssetId),
                self.network.pool.centrifugeId
              )
        if (!priced) return hubUpdate(null)
        return defer(() => self._accountingTokenAsset(priced.assetId, priced.liability)).pipe(
          switchMap((accounting) => {
            if (!accounting || accounting.assetId) return hubUpdate(accounting?.assetId ?? null)
            // A build or batch cannot register on another chain before constructing its hub call.
            if (ctx.isBatching) {
              throw new Error(
                `Accounting token ${accounting.accountingToken} (tokenId ${accounting.tokenId}) is not registered on spoke ${accounting.spoke}. Register it with registerAsset before building or batching the ramp update so notifyAssetPrice can be included.`
              )
            }
            return self._registerAndUpdateRamp(ctx, accounting, hubUpdate)
          })
        )
      },
      this.network.pool.centrifugeId,
      { switchChain: false }
    )
  }

  /**
   * The hub transaction: `Hub.updateContract` with the v3.2 trusted-call encoding, or `Hub.managerCall` with the
   * v3.3 `fromHub` one, plus `Hub.notifyAssetPrice` for the accounting token when there is one to price.
   */
  private async *_hubRampSteps(ctx: TransactionContext, update: RampUpdate, accountingAssetId: AssetId | null) {
    const hubCtx = await this._root.protocolContext(this.network.pool.id)
    const poolId = this.network.pool.id
    const data: HexString[] = []
    const messages: MessageTypeWithSubType[] = []
    if (isV3_3(hubCtx)) {
      data.push(
        encodeHubManagerCall(hubCtx, {
          centrifugeId: this.network.centrifugeId,
          target: this.onrampAddress,
          payload: encodeOnOffRampPayload(update.v3_3Payload),
          label: `OnOffRamp.${update.v3_3Payload.kind}`,
          refund: ctx.signingAddress,
        })
      )
      messages.push(messageV3_3(MessageTypeV3_3.ManagerCallFromHub, poolId))
    } else {
      data.push(
        encodeFunctionData({
          abi: hubCtx.contractAbis.Hub,
          functionName: 'updateContract',
          args: [
            poolId.raw,
            this.shareClass.id.raw,
            this.network.centrifugeId,
            addressToBytes32(this.onrampAddress),
            update.v3_2Payload(),
            0n,
            ctx.signingAddress,
          ],
        })
      )
      messages.push({ type: MessageType.TrustedContractUpdate, poolId })
    }
    if (accountingAssetId) {
      const notifyAssetPrice = notifyAssetPriceCall(
        hubCtx,
        poolId,
        this.shareClass.id.raw,
        accountingAssetId,
        ctx.signingAddress
      )
      data.push(notifyAssetPrice.data)
      messages.push(notifyAssetPrice.message)
    }

    yield* wrapTransaction(update.title, ctx, {
      contract: hubCtx.hub,
      policy: { poolId },
      data,
      messages: { [this.network.centrifugeId]: messages },
    })
  }

  /** Registers the accounting token on the ramp's chain, then sends the priced hub update. Signing only. */
  private _registerAndUpdateRamp(
    ctx: TransactionContext,
    accounting: AccountingTokenAsset,
    hubUpdate: (accountingAssetId: AssetId) => Observable<OperationStatus | BatchTransactionData>
  ) {
    const self = this
    return defer(() => {
      let registeredAssetId: AssetId | null = null

      const registration = this._transact(async function* (spokeCtx) {
        const { receipt } = yield* self._root._registerAsset(
          spokeCtx,
          self.network.centrifugeId,
          self.network.pool.centrifugeId,
          accounting.accountingToken,
          accounting.tokenId
        )
        registeredAssetId =
          findRegisteredAssetId(receipt, accounting) ??
          (await accounting.lookups.assetId(accounting.accountingToken, accounting.tokenId))
        if (!registeredAssetId) {
          throw new Error(
            `Registered accounting token ${accounting.accountingToken} (tokenId ${accounting.tokenId}) in ${receipt.transactionHash}, but the spoke on centrifugeId ${self.network.centrifugeId} does not report it`
          )
        }
      }, this.network.centrifugeId)

      const update = defer(() => hubUpdate(registeredAssetId!))

      return defer(() => self._assertHubManager(ctx.signingAddress)).pipe(switchMap(() => concat(registration, update)))
    })
  }

  /** The accounting token this ramp deposits for `assetId`, or `null` for a legacy ramp that deposits none. */
  private async _accountingTokenAsset(assetId: AssetId, liability: boolean): Promise<AccountingTokenAsset | null> {
    const [{ hubContext, spoke: context }, client] = await Promise.all([
      this.network._registrationContexts(),
      this._root.getClient(this.network.centrifugeId),
    ])
    const rampAccountingToken = await this._rampAccountingToken(client, context)
    if (!rampAccountingToken) return null

    if (!context.accountingToken || !isAddressEqual(rampAccountingToken, context.accountingToken)) {
      throw new Error(
        `On/off-ramp ${this.onrampAddress} deposits accounting token ${rampAccountingToken}, but the registry lists ${context.accountingToken ?? 'none'} for centrifugeId ${this.network.centrifugeId}`
      )
    }

    const lookups = spokeAssets(client, context)
    const asset = await lookups.asset(assetId)
    if (!asset) {
      throw new Error(`Asset ${assetId.toString()} is not registered on spoke ${context.spoke}`)
    }
    if (asset.tokenId !== 0n) {
      throw new Error(
        `Asset ${assetId.toString()} is ERC-6909 token ${asset.tokenId} of ${asset.address}; the on/off-ramp only supports ERC-20 assets`
      )
    }
    const accounting = {
      spoke: context.spoke,
      accountingToken: context.accountingToken,
      tokenId: toAccountingTokenId(this.network.pool.id.raw, asset.address, liability),
      spokeCtx: context,
    }
    const accountingAssetId = await lookups.assetId(accounting.accountingToken, accounting.tokenId)
    if (accountingAssetId) await this._assertRegisteredOnHub(accounting, accountingAssetId, hubContext)
    return { ...accounting, assetId: accountingAssetId, lookups }
  }

  /** A v3.2 hub rejects the holding update of a token it does not know, so the ramp must not be enabled before. */
  private async _assertRegisteredOnHub(
    accounting: AccountingTokenRef,
    accountingAssetId: AssetId,
    hubCtx: SdkProtocolContext
  ) {
    const hubCentrifugeId = this.network.pool.centrifugeId
    const client = await this._root.getClient(hubCentrifugeId)
    const registered = await getContract({
      address: requireContract(hubCtx, 'hubRegistry'),
      abi: hubCtx.contractAbis.HubRegistry,
      client,
    }).read.isRegistered([accountingAssetId.raw])
    if (!registered) {
      throw new Error(
        `Accounting token ${accounting.accountingToken} (tokenId ${accounting.tokenId}) is registered on spoke ${accounting.spoke} as asset ${accountingAssetId.toString()}, but the hub on centrifugeId ${hubCentrifugeId} does not know it yet: its RegisterAsset message from an earlier call has not been executed on the hub. If the indexer shows the message awaiting delivery, retry in a few minutes; if it shows it failed, retry it with retryMessage first; if it stays undelivered, the lane to the hub is not relaying.`
      )
    }
  }

  private async _rampAccountingToken(client: Client, ctx: SdkProtocolContext): Promise<HexString | null> {
    try {
      return await getContract({
        address: this.onrampAddress,
        abi: ctx.contractAbis.OnOffRampManager,
        client,
      }).read.accountingToken()
    } catch (error) {
      if (isContractRevert(error)) return null
      throw error
    }
  }

  private async _assertHubManager(address: HexString) {
    const isManager = await this._root._reader.isPoolManager(this.network.pool.id.raw.toString(), address)
    if (!isManager) {
      throw new Error(
        `${address} is not a hub manager of pool ${this.network.pool.id.toString()}, so it cannot send the ramp update the accounting token would be registered for`
      )
    }
  }

  deposit(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const { contractAbis: ABI } = await self.network._protocolContext()
      yield* doTransaction('Deposit', ctx, () =>
        getContract({ address: self.onrampAddress, abi: ABI.OnOffRampManager, client: ctx.walletClient }).write.deposit(
          [assetAddress, 0n, amount.toBigInt(), receiverAddress]
        )
      )
    }, self.network.centrifugeId)
  }

  withdraw(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const { contractAbis: ABI } = await self.network._protocolContext()
      yield* doTransaction('Withdraw', ctx, () =>
        getContract({
          address: self.onrampAddress,
          abi: ABI.OnOffRampManager,
          client: ctx.walletClient,
        }).write.withdraw([assetAddress, 0n, amount.toBigInt(), receiverAddress])
      )
    }, self.network.centrifugeId)
  }
}

function findRegisteredAssetId(receipt: TransactionReceipt, accounting: AccountingTokenRef): AssetId | null {
  const registered = parseEventLogs({
    logs: receipt.logs,
    eventName: 'RegisterAsset',
    address: accounting.spoke,
    protocolVersion: accounting.spokeCtx.protocolVersion,
  })
    .map((log) => log.args as { assetId: bigint; asset: HexString; tokenId: bigint })
    .find((args) => isAddressEqual(args.asset, accounting.accountingToken) && args.tokenId === accounting.tokenId)
  return registered ? new AssetId(registered.assetId) : null
}
