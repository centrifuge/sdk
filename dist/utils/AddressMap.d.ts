import { HexString } from '../types/index.js';
export declare class AddressMap<U> extends Map<HexString, U> {
    get(key: HexString): U | undefined;
    has(key: HexString): boolean;
    set(key: HexString, value: U): this;
}
//# sourceMappingURL=AddressMap.d.ts.map