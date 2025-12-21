export function isEIP1193ProviderLike(signer) {
    return signer !== null && typeof signer === 'object' && 'request' in signer;
}
//# sourceMappingURL=isEIP1193ProviderLike.js.map