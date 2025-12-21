import { toHex } from 'viem';
export class PoolId {
    /**
     * Creates a PoolId from a centrifuge ID and a pool counter.
     * @param centrifugeId - uint16
     * @param poolCounter - uint48
     * @returns A new PoolId instance.
     */
    static from(centrifugeId, poolCounter) {
        return new PoolId((BigInt(centrifugeId) << 48n) + BigInt(poolCounter));
    }
    #id;
    constructor(id) {
        this.#id = BigInt(id);
    }
    get centrifugeId() {
        return Number(this.#id >> 48n);
    }
    get raw() {
        return this.#id;
    }
    toString() {
        return this.#id.toString();
    }
    equals(other) {
        return this.raw === (other instanceof PoolId ? other : new PoolId(other)).raw;
    }
}
export class ShareClassId {
    static from(poolId, shareClassCounter) {
        return new ShareClassId(toHex((BigInt(poolId.raw) << 64n) + BigInt(shareClassCounter), { size: 16 }));
    }
    #id;
    constructor(id) {
        if (!id.startsWith('0x') || id.length !== 34) {
            throw new Error(`Invalid share class ID: ${id}`);
        }
        this.#id = BigInt(id);
    }
    get poolId() {
        return new PoolId(this.#id >> 64n);
    }
    get centrifugeId() {
        return Number(this.#id >> 112n);
    }
    get raw() {
        return toHex(this.#id, { size: 16 });
    }
    toString() {
        return toHex(this.#id, { size: 16 });
    }
    equals(other) {
        return this.raw === (other instanceof ShareClassId ? other : new ShareClassId(other)).raw;
    }
}
export class AssetId {
    static from(centrifugeId, assetCounter) {
        return new AssetId((BigInt(centrifugeId) << 112n) + BigInt(assetCounter));
    }
    static fromIso(countryCode) {
        return new AssetId(BigInt(countryCode));
    }
    #id;
    constructor(id) {
        this.#id = BigInt(id);
    }
    get centrifugeId() {
        return Number(this.#id >> 112n);
    }
    get isNationalCurrency() {
        return this.centrifugeId === 0;
    }
    get addr() {
        return toHex(this.#id, { size: 20 });
    }
    get raw() {
        return this.#id;
    }
    get nationalCurrencyCode() {
        return this.isNationalCurrency ? Number(this.#id) : null;
    }
    toString() {
        return this.#id.toString();
    }
    equals(other) {
        return this.raw === (other instanceof AssetId ? other : new AssetId(other)).raw;
    }
}
//# sourceMappingURL=types.js.map