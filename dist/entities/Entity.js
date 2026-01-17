export class Entity {
    _root;
    #baseKeys;
    /** @internal */
    _transact;
    constructor(
    /** @internal */
    _root, queryKeys) {
        this._root = _root;
        this.#baseKeys = queryKeys;
        this._transact = this._root._transact.bind(this._root);
    }
    /** @internal */
    _query(keys, observableCallback, options) {
        return this._root._query(keys ? [...this.#baseKeys, ...keys] : null, observableCallback, options);
    }
}
//# sourceMappingURL=Entity.js.map