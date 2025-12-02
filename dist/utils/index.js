export function addressToBytes32(address) {
    return address.padEnd(66, '0').toLowerCase();
}
export function randomUint(bitLength) {
    if (!Number.isInteger(bitLength) || bitLength <= 0 || bitLength % 8 !== 0) {
        throw new Error('bitLength must be a positive integer and divisible by 8');
    }
    const byteLength = bitLength / 8;
    const bytes = new Uint8Array(byteLength);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < byteLength; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    let result = 0n;
    for (const byte of bytes) {
        result = (result << 8n) | BigInt(byte);
    }
    return result;
}
//# sourceMappingURL=index.js.map