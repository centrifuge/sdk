import { combineLatest, map, of, switchMap } from 'rxjs'
import { encodeFunctionData, encodePacked, toHex } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { Balance } from '../utils/BigInt.js'
import { addressToBytes32 } from '../utils/index.js'
import { doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

export class OnOffRampManager extends Entity {
  /** @internal */
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
            onRampAssets.map((item) => this._root.balance(item.assetAddress, this.onrampAddress, this.network.centrifugeId))
          )
        }),
        map((balances) => balances.filter((b) => b.balance.gt(0n)))
      )
    )
  }

  /**
   * Set a receiver address for a given asset.
   * @param assetId - The asset ID to set the receiver for
   * @param receiver - The receiver address to set
   */
  setReceiver(assetId: AssetId, receiver: HexString, enabled: boolean = true) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        Promise.resolve(self.network.centrifugeId),
        self._root._protocolAddresses(self.network.centrifugeId),
      ])

      yield* wrapTransaction(enabled ? 'Enable Receiver' : 'Disable Receiver', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.network.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.onrampAddress),
            encodePacked(
              ['uint8', 'bytes32', 'uint128', 'bytes32', 'bool'],
              [3, toHex('offramp', { size: 32 }), assetId.raw, addressToBytes32(receiver), enabled]
            ),
            0n,
          ],
        }),
      })
    }, this.network.centrifugeId)
  }

  /**
   * Set a relayer.
   * @param relayer - The relayer address to set
   * @param enabled - Whether the relayer is enabled
   */
  setRelayer(relayer: HexString, enabled: boolean = true) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        Promise.resolve(self.network.centrifugeId),
        self._root._protocolAddresses(self.network.centrifugeId),
      ])

      yield* wrapTransaction(enabled ? 'Enable Relayer' : 'Disable Relayer', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.network.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.onrampAddress),
            encodePacked(
              ['uint8', 'bytes32', 'uint128', 'bytes32', 'bool'],
              [3, toHex('relayer', { size: 32 }), 0n, addressToBytes32(relayer), enabled]
            ),
            0n,
          ],
        }),
      })
    }, this.network.centrifugeId)
  }

  setAsset(assetId: AssetId) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        Promise.resolve(self.network.centrifugeId),
        self._root._protocolAddresses(self.network.centrifugeId),
      ])

      yield* wrapTransaction('Set Relayer', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.network.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.onrampAddress),
            encodePacked(
              ['uint8', 'bytes32', 'uint128', 'bytes32', 'bool'],
              [
                /* UpdateContractType.UpdateAddress */ 3,
                toHex('onramp', { size: 32 }),
                assetId.raw,
                toHex(0, { size: 32 }),
                true,
              ]
            ),
            0n,
          ],
        }),
      })
    }, this.network.centrifugeId)
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
