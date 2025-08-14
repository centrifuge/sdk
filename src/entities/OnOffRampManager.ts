import { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { Entity } from './Entity.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { AssetId } from '../utils/types.js'
import { ABI } from '../abi/index.js'
import { doTransaction, wrapTransaction } from '../utils/transaction.js'
import { encodeFunctionData, encodePacked, toHex } from 'viem'
import { addressToBytes32 } from '../utils/index.js'
import { combineLatest, map, switchMap } from 'rxjs'
import { Balance } from '../utils/BigInt.js'

type Receiver = {
  assetAddress: HexString
  centrifugeId: number
  poolId: number
  receiverAddress: HexString
  tokenId: HexString
  asset: {
    address: HexString
    assetTokenId: HexString
    id: HexString
  }
}

type Relayer = {
  address: HexString
  isEnabled: boolean
}

type Asset = {
  assetAddress: HexString
  centrifugeId: number
  poolId: number
  tokenId: HexString
}

export class OnOffRampManager extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public poolNetwork: PoolNetwork,
    public shareClass: ShareClass,
    public onrampAddress: HexString
  ) {
    super(_root, ['onofframpmanager', shareClass.id.toString(), poolNetwork.chainId])

    this.onrampAddress = onrampAddress
  }

  receivers() {
    return this._query(null, () =>
      this._root._queryIndexer(
        RECEIVERS_QUERY,
        {},
        (data: {
          offRampAddresss: {
            items: Receiver[]
          }
        }) => data.offRampAddresss.items.map((item) => item)
      )
    )
  }

  relayers() {
    return this._query(null, () =>
      this._root._queryIndexer(
        RELAYERS_QUERY,
        {},
        (data: {
          offrampRelayers: {
            items: Relayer[]
          }
        }) => data.offrampRelayers.items.map((item) => item)
      )
    )
  }

  assets() {
    return this._query(null, () =>
      this._root._queryIndexer(
        ON_RAMP_ASSETS_QUERY,
        {},
        (data: {
          onRampAssets: {
            items: Asset[]
          }
        }) => data.onRampAssets.items.map((item) => item)
      )
    )
  }

  balances() {
    return this._query(null, () =>
      this._root
        ._queryIndexer<{
          onRampAssets: {
            items: Asset[]
          }
        }>(ON_RAMP_ASSETS_QUERY)
        .pipe(
          switchMap(({ onRampAssets }) => {
            return combineLatest(
              onRampAssets.items.map((item) =>
                this._root.balance(item.assetAddress, this.onrampAddress, this.poolNetwork.chainId)
              )
            )
          }),
          map((balances) => balances.filter((b) => b.balance.gt(0n)))
        )
    )
  }

  setReceiver(assetId: AssetId, receiver: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        self._root.id(self.poolNetwork.chainId),
        self._root._protocolAddresses(self.poolNetwork.chainId),
      ])

      yield* wrapTransaction('Set Receiver', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.poolNetwork.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.onrampAddress),
            encodePacked(
              ['uint8', 'bytes32', 'uint128', 'bytes32', 'bool'],
              [
                /* UpdateContractType.UpdateAddress */ 3,
                toHex('offramp', { size: 32 }),
                assetId.raw,
                addressToBytes32(receiver),
                true,
              ]
            ),
            0n,
          ],
        }),
      })
    }, this.poolNetwork.chainId)
  }

  setRelayer(relayer: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        self._root.id(self.poolNetwork.chainId),
        self._root._protocolAddresses(self.poolNetwork.chainId),
      ])

      yield* wrapTransaction('Set Relayer', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.poolNetwork.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.onrampAddress),
            encodePacked(
              ['uint8', 'bytes32', 'uint128', 'bytes32', 'bool'],
              [
                /* UpdateContractType.UpdateAddress */ 3,
                toHex('relayer', { size: 32 }),
                0n,
                addressToBytes32(relayer),
                true,
              ]
            ),
            0n,
          ],
        }),
      })
    }, this.poolNetwork.chainId)
  }

  setAsset(assetId: AssetId) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        self._root.id(self.poolNetwork.chainId),
        self._root._protocolAddresses(self.poolNetwork.chainId),
      ])

      yield* wrapTransaction('Set Relayer', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.poolNetwork.pool.id.raw,
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
    }, this.poolNetwork.chainId)
  }

  deposit(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      yield* doTransaction('Deposit', publicClient, () =>
        walletClient.writeContract({
          address: self.onrampAddress,
          abi: ABI.OnOffRampManager,
          functionName: 'deposit',
          args: [assetAddress, 0n, amount.toBigInt(), receiverAddress],
        })
      )
    }, self.poolNetwork.chainId)
  }

  withdraw(assetAddress: HexString, amount: Balance, receiverAddress: HexString) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient }) {
      yield* doTransaction('Withdraw', publicClient, () =>
        walletClient.writeContract({
          address: self.onrampAddress,
          abi: ABI.OnOffRampManager,
          functionName: 'withdraw',
          args: [assetAddress, 0n, amount.toBigInt(), receiverAddress],
        })
      )
    }, self.poolNetwork.chainId)
  }
}

const RECEIVERS_QUERY = `
query OffRampAdresses {
  offRampAddresss {
    items {
      assetAddress
      centrifugeId
      poolId
      receiverAddress
      tokenId
      asset {
        address
        assetTokenId
        id
      }
    }
  }
}
`

const RELAYERS_QUERY = `
query OffRampRelayers {
  offrampRelayers {
    items {
      address
      isEnabled
    }
  }
}
`

const ON_RAMP_ASSETS_QUERY = `
query OnRampAssets {
  onRampAssets {
    items {
      assetAddress
      centrifugeId
      poolId
      tokenId
    }
  }
}
`
