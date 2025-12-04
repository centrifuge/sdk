export declare class PoolId {
    #private;
    /**
     * Creates a PoolId from a centrifuge ID and a pool counter.
     * @param centrifugeId - uint16
     * @param poolCounter - uint48
     * @returns A new PoolId instance.
     */
    static from(centrifugeId: number, poolCounter: number | bigint): PoolId;
    constructor(id: string | bigint | number);
    get centrifugeId(): number;
    get raw(): bigint;
    toString(): string;
    equals(other: PoolId | string | bigint | number): boolean;
}
export declare class ShareClassId {
    #private;
    static from(poolId: PoolId, shareClassCounter: number): ShareClassId;
    constructor(id: string);
    get poolId(): PoolId;
    get centrifugeId(): number;
    get raw(): `0x${string}`;
    toString(): `0x${string}`;
    equals(other: ShareClassId | string): boolean;
}
export declare class AssetId {
    #private;
    static from(centrifugeId: number, assetCounter: number): AssetId;
    static fromIso(countryCode: number): AssetId;
    constructor(id: string | bigint);
    get centrifugeId(): number;
    get isNationalCurrency(): boolean;
    get addr(): `0x${string}`;
    get raw(): bigint;
    get nationalCurrencyCode(): number | null;
    toString(): string;
    equals(other: AssetId | string | bigint): boolean;
}
//# sourceMappingURL=types.d.ts.map