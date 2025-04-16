import { toHex } from 'viem'

export class PoolId {
  static from(centrifugeId: number, poolCounter: number) {
    return new PoolId((BigInt(centrifugeId) << 48n) + BigInt(poolCounter))
  }

  #id: bigint

  constructor(id: string | bigint | number) {
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

  equals(other: PoolId | string | bigint | number) {
    return this.raw === (other instanceof PoolId ? other : new PoolId(other)).raw
  }
}

export class ShareClassId {
  static from(poolId: PoolId, shareClassCounter: number) {
    return new ShareClassId(toHex((BigInt(poolId.raw) << 64n) + BigInt(shareClassCounter), { size: 16 }))
  }

  #id: bigint

  constructor(id: string) {
    if (!id.startsWith('0x') || id.length !== 34) {
      throw new Error(`Invalid share class ID: ${id}`)
    }
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

  equals(other: ShareClassId | string) {
    return this.raw === (other instanceof ShareClassId ? other : new ShareClassId(other)).raw
  }
}

export class AssetId {
  static from(centrifugeId: number, assetCounter: number) {
    return new AssetId((BigInt(centrifugeId) << 112n) + BigInt(assetCounter))
  }
  static fromIso(countryCode: number) {
    return new AssetId(BigInt(countryCode))
  }

  #id: bigint

  constructor(id: string | bigint) {
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

  equals(other: AssetId | string | bigint) {
    return this.raw === (other instanceof AssetId ? other : new AssetId(other)).raw
  }
}
