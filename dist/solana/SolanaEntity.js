/**
 * Base class for Solana entities
 * Similar to Entity.ts but for Solana-specific operations
 */
export class SolanaEntity {
    _solanaManager;
    #baseKeys;
    constructor(
    /** @internal */
    _solanaManager, queryKeys) {
        this._solanaManager = _solanaManager;
        this.#baseKeys = queryKeys;
    }
    /** @internal */
    _query(keys, observableCallback, options) {
        return this._solanaManager._query(keys ? [...this.#baseKeys, ...keys] : null, observableCallback, options);
    }
}
//# sourceMappingURL=SolanaEntity.js.map