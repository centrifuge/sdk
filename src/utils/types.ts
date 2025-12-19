import { toHex } from 'viem'

/**
 * Type alias for centrifuge ID (uint16)
 * Used to identify specific networks/chains in the Centrifuge protocol
 */
export type CentrifugeId = number

export class PoolId {
  /**
   * Creates a PoolId from a centrifuge ID and a pool counter.
   * @param centrifugeId - uint16
   * @param poolCounter - uint48
   * @returns A new PoolId instance.
   */
  static from(centrifugeId: CentrifugeId, poolCounter: number | bigint) {
    return new PoolId((BigInt(centrifugeId) << 48n) + BigInt(poolCounter))
  }

  #id: bigint

  constructor(id: string | bigint | number) {
    this.#id = BigInt(id)
  }

  get centrifugeId(): CentrifugeId {
    return Number(this.#id >> 48n) as CentrifugeId
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

  get centrifugeId(): CentrifugeId {
    return Number(this.#id >> 112n) as CentrifugeId
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
  static from(centrifugeId: CentrifugeId, assetCounter: number) {
    return new AssetId((BigInt(centrifugeId) << 112n) + BigInt(assetCounter))
  }
  static fromIso(countryCode: number) {
    return new AssetId(BigInt(countryCode))
  }

  #id: bigint

  constructor(id: string | bigint) {
    this.#id = BigInt(id)
  }

  get centrifugeId(): CentrifugeId {
    return Number(this.#id >> 112n) as CentrifugeId
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

  get nationalCurrencyCode() {
    return this.isNationalCurrency ? Number(this.#id) : null
  }

  toString() {
    return this.#id.toString()
  }

  equals(other: AssetId | string | bigint) {
    return this.raw === (other instanceof AssetId ? other : new AssetId(other)).raw
  }
}
