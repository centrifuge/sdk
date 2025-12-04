export class AddressMap extends Map {
    get(key) {
        return super.get(key.toLowerCase());
    }
    has(key) {
        return super.has(key.toLowerCase());
    }
    set(key, value) {
        return super.set(key.toLowerCase(), value);
    }
}
//# sourceMappingURL=AddressMap.js.map