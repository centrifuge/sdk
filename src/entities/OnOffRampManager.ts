import { combineLatest, concat, defer, from, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { MessageType, type MessageTypeWithSubType, type TransactionContext } from '../types/transaction.js'
import { toAccountingTokenId } from '../utils/accountingToken.js'
import { Balance } from '../utils/BigInt.js'
import { assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { isContractRevert, spokeAssets } from '../utils/spokeAssets.js'
import { doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
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
}

type AccountingTokenAsset = AccountingTokenRef & { assetId: AssetId | null }

export class OnOffRampManager extends Entity {
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    public shareClass: ShareClass,
    public onrampAddress: HexString
  ) {
    super(_root, ['onofframpmanager', shareClass.id.toString(), network.centrifugeId])

    this.onrampAddress = onrampAddress
  }

  /**
   * Get the receivers of an OnOffRampManager
   */
  receivers() {
    return this._query(null, () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryIndexer(
            `query ($scId: String!, $centrifugeId: String!) {
              offRampAddresss(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  assetAddress
                  receiverAddress
                  asset {
                    id
                  }
                }
              }
            }`,
            {
              scId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (data: {
              offRampAddresss: {
                items: {
                  assetAddress: HexString
                  receiverAddress: HexString
                  asset: {
                    id: string
                  }
                }[]
              }
            }) =>
              data.offRampAddresss.items.map((item) => ({
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
    return this._query(null, () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryIndexer(
            `query ($scId: String!, $centrifugeId: String!) {
              offrampRelayers(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  address
                  isEnabled
                }
              }
            }`,
            {
              scId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (data: {
              offrampRelayers: {
                items: {
                  address: HexString
                  isEnabled: boolean
                }[]
              }
            }) => data.offrampRelayers.items.map((item) => item)
          )
        )
      )
    )
  }

  assets() {
    return this._query(null, () =>
      of(this.network.centrifugeId).pipe(
        switchMap((centrifugeId) =>
          this._root._queryIndexer(
            `query ($scId: String!, $centrifugeId: String!) {
              onRampAssets(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  assetAddress
                  asset {
                    id
                  }
                }
              }
            }`,
            {
              scId: this.shareClass.id.toString(),
              centrifugeId: centrifugeId.toString(),
            },
            (data: {
              onRampAssets: {
                items: {
                  assetAddress: HexString
                  asset: {
                    id: string
                  }
                }[]
              }
            }) =>
              data.onRampAssets.items.map((item) => ({
                assetAddress: item.assetAddress,
                assetId: new AssetId(item.asset.id),
              }))
          )
        )
      )
    )
  }

  balances() {
    return this._query(null, () =>
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
   * @param assetId - The asset ID to set the receiver for
   * @param receiver - The receiver address to set
   */
  setReceiver(assetId: AssetId, receiver: HexString, enabled: boolean = true) {
    return this._updateRamp(
      enabled ? 'Enable Receiver' : 'Disable Receiver',
      () => encode([OnOffRampManagerTrustedCall.Offramp, assetId.raw, receiver, enabled]),
      enabled ? { assetId, liability: false } : undefined
    )
  }

  /**
   * Set a relayer.
   * @param relayer - The relayer address to set
   * @param enabled - Whether the relayer is enabled
   */
  setRelayer(relayer: HexString, enabled: boolean = true) {
    return this._updateRamp(enabled ? 'Enable Relayer' : 'Disable Relayer', () =>
      encode([OnOffRampManagerTrustedCall.Relayer, relayer, enabled])
    )
  }

  /**
   * Enable an onramp asset. Also notifies the price of the accounting token `deposit` deposits; a signed call
   * registers that token on the spoke first if needed.
   */
  setAsset(assetId: AssetId) {
    return this._updateRamp('Set Asset', () => encode([OnOffRampManagerTrustedCall.Onramp, assetId.raw, true]), {
      assetId,
      liability: true,
    })
  }

  private _updateRamp(
    title: string,
    encodePayload: () => HexString,
    priced?: { assetId: AssetId; liability: boolean }
  ) {
    const self = this
    return this._transact((ctx) => {
      const payload = encodePayload()
      if (!priced) return self._hubRampSteps(ctx, title, payload, null)
      return defer(() => self._accountingTokenAsset(priced.assetId, priced.liability)).pipe(
        switchMap((accounting) =>
          // A build or a batch carries a single hub call, so it can only price a token that is already registered.
          !accounting || accounting.assetId || ctx.isBatching
            ? from(self._hubRampSteps(ctx, title, payload, accounting?.assetId ?? null))
            : self._registerAndUpdateRamp(ctx, title, payload, accounting)
        )
      )
    }, this.network.pool.centrifugeId)
  }

  private async *_hubRampSteps(
    ctx: TransactionContext,
    title: string,
    payload: HexString,
    accountingAssetId: AssetId | null
  ) {
    assertCrosschainMessagingEnabled(this.network.centrifugeId)

    const { hub } = await this._root._protocolAddresses(this.network.pool.centrifugeId)
    const data = [
      encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'updateContract',
        args: [
          this.network.pool.id.raw,
          this.shareClass.id.raw,
          this.network.centrifugeId,
          addressToBytes32(this.onrampAddress),
          payload,
          0n,
          ctx.signingAddress,
        ],
      }),
    ]
    const messages: MessageTypeWithSubType[] = [
      { type: MessageType.TrustedContractUpdate, poolId: this.network.pool.id },
    ]
    if (accountingAssetId) {
      data.push(
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'notifyAssetPrice',
          args: [this.network.pool.id.raw, this.shareClass.id.raw, accountingAssetId.raw, ctx.signingAddress],
        })
      )
      messages.push({ type: MessageType.NotifyPricePoolPerAsset, poolId: this.network.pool.id })
    }

    yield* wrapTransaction(title, ctx, {
      contract: hub,
      data,
      messages: { [this.network.centrifugeId]: messages },
    })
  }

  /** Registers the accounting token on the ramp's chain, then sends the priced hub update. Signing only. */
  private _registerAndUpdateRamp(
    ctx: TransactionContext,
    title: string,
    payload: HexString,
    accounting: AccountingTokenAsset
  ) {
    const self = this
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
        (await (await self._spokeAssets(accounting.spoke)).assetId(accounting.accountingToken, accounting.tokenId))
      if (!registeredAssetId) {
        throw new Error(
          `Registered accounting token ${accounting.accountingToken} (tokenId ${accounting.tokenId}) in ${receipt.transactionHash}, but the spoke on centrifugeId ${self.network.centrifugeId} does not report it`
        )
      }
    }, this.network.centrifugeId)

    const update = defer(() =>
      self._transact(
        (hubCtx) => self._hubRampSteps(hubCtx, title, payload, registeredAssetId),
        self.network.pool.centrifugeId
      )
    )

    return defer(() => self._assertHubManager(ctx.signingAddress)).pipe(switchMap(() => concat(registration, update)))
  }

  /** The accounting token this ramp deposits for `assetId`, or `null` for a legacy ramp that deposits none. */
  private async _accountingTokenAsset(assetId: AssetId, liability: boolean): Promise<AccountingTokenAsset | null> {
    const rampAccountingToken = await this._rampAccountingToken()
    if (!rampAccountingToken) return null

    const context = await this._root._protocolAddresses(this.network.centrifugeId)
    if (!context.accountingToken || !isAddressEqual(rampAccountingToken, context.accountingToken)) {
      throw new Error(
        `On/off-ramp ${this.onrampAddress} deposits accounting token ${rampAccountingToken}, but the deployments list ${context.accountingToken ?? 'none'} for centrifugeId ${this.network.centrifugeId}`
      )
    }

    const assets = await this._spokeAssets(context.spoke)
    const asset = await assets.asset(assetId)
    if (!asset) {
      throw new Error(`Asset ${assetId.toString()} is not registered on spoke ${context.spoke}`)
    }
    const accounting = {
      spoke: context.spoke,
      accountingToken: context.accountingToken,
      tokenId: toAccountingTokenId(this.network.pool.id.raw, asset.address, liability),
    }
    return { ...accounting, assetId: await assets.assetId(accounting.accountingToken, accounting.tokenId) }
  }

  private async _rampAccountingToken(): Promise<HexString | null> {
    const client = await this._root.getClient(this.network.centrifugeId)
    try {
      return await client.readContract({
        address: this.onrampAddress,
        abi: ABI.OnOffRampManager,
        functionName: 'accountingToken',
      })
    } catch (error) {
      if (isContractRevert(error)) return null
      throw error
    }
  }

  private async _spokeAssets(spoke: HexString) {
    return spokeAssets(await this._root.getClient(this.network.centrifugeId), spoke)
  }

  private async _assertHubManager(address: HexString) {
    const hubCentrifugeId = this.network.pool.centrifugeId
    const [{ hubRegistry }, client] = await Promise.all([
      this._root._protocolAddresses(hubCentrifugeId),
      this._root.getClient(hubCentrifugeId),
    ])
    const isManager = await client.readContract({
      address: hubRegistry,
      abi: ABI.HubRegistry,
      functionName: 'manager',
      args: [this.network.pool.id.raw, address],
    })
    if (!isManager) {
      throw new Error(
        `${address} is not a hub manager of pool ${this.network.pool.id.toString()}, so it cannot send the ramp update the accounting token would be registered for`
      )
    }
  }

  deposit(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      yield* doTransaction('Deposit', ctx, () =>
        ctx.walletClient.writeContract({
          address: self.onrampAddress,
          abi: ABI.OnOffRampManager,
          functionName: 'deposit',
          args: [assetAddress, 0n, amount.toBigInt(), receiverAddress],
        })
      )
    }, self.network.centrifugeId)
  }

  withdraw(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      yield* doTransaction('Withdraw', ctx, () =>
        ctx.walletClient.writeContract({
          address: self.onrampAddress,
          abi: ABI.OnOffRampManager,
          functionName: 'withdraw',
          args: [assetAddress, 0n, amount.toBigInt(), receiverAddress],
        })
      )
    }, self.network.centrifugeId)
  }
}

function findRegisteredAssetId(receipt: TransactionReceipt, accounting: AccountingTokenRef): AssetId | null {
  const event = parseEventLogs({ abi: ABI.Spoke, eventName: 'RegisterAsset', logs: receipt.logs }).find(
    ({ address, args }) =>
      isAddressEqual(address, accounting.spoke) &&
      isAddressEqual(args.asset, accounting.accountingToken) &&
      args.tokenId === accounting.tokenId
  )
  return event ? new AssetId(event.args.assetId) : null
}
