import { toHex } from 'viem'

export class PoolId {
  static from(centrifugeId: number, poolCounter: number) {
    return new PoolId((BigInt(centrifugeId) << 48n) + BigInt(poolCounter))
  }

  #id: bigint

  constructor(id: string | bigint) {
    this.#id = BigInt(id)
  }

  get centrifugeId() {
    return Number(this.#id >> 48n)
  }

  get raw() {
    return this.#id
  }

  toString() {
    return this.#id.toString()
  }

  equals(other: PoolId) {
    return this.raw === other.raw
  }
}

export class ShareClassId {
  static from(poolId: PoolId, shareClassCounter: number) {
    return new ShareClassId(toHex((BigInt(poolId.raw) << 64n) + BigInt(shareClassCounter), { size: 16 }))
  }

  #id: bigint

  constructor(id: string) {
    this.#id = BigInt(id)
  }

  get poolId() {
    return new PoolId(this.#id >> 64n)
  }

  get centrifugeId() {
    return Number(this.#id >> 112n)
  }

  get raw() {
    return toHex(this.#id, { size: 16 })
  }

  toString() {
    return toHex(this.#id, { size: 16 })
  }

  equals(other: ShareClassId) {
    return this.raw === other.raw
  }
}

export class AssetId {
  static from(centrifugeId: number, assetCounter: number) {
    return new AssetId((BigInt(centrifugeId) << 112n) + BigInt(assetCounter))
  }
  static fromIso(countryCode: number) {
    return new AssetId(countryCode)
  }

  #id: bigint

  constructor(id: string | bigint | number) {
    this.#id = BigInt(id)
  }

  get centrifugeId() {
    return Number(this.#id >> 112n)
  }

  get isNationalCurrency() {
    return this.centrifugeId === 0
  }

  get addr() {
    return toHex(this.#id, { size: 20 })
  }

  get raw() {
    return this.#id
  }

  toString() {
    return this.#id.toString()
  }

  equals(other: AssetId) {
    return this.raw === other.raw
  }
}
