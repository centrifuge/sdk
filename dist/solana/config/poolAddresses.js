/**
 * Internal mapping of ShareClass IDs to Solana pool addresses
 *
 * IMPORTANT: These addresses should match the deployed Solana accounts
 * that are authorized to receive USDC investments for each pool/share class
 */
// Pool address mappings by ShareClass ID
const POOL_ADDRESS_MAPPING = {
    '0x00010000000000060000000000000001': {
        poolId: 281474976710662,
        poolName: 'AAA_CLO',
        environment: ['mainnet', 'devnet'],
        solanaAddress: {
            mainnet: '',
            testnet: '',
            devnet: 'BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN',
        },
    },
};
export const USDC_MINT_ADDRESSES = {
    mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    testnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
/**
 * Get the Solana pool address for a given ShareClass ID
 * @param shareClassId - The ShareClass ID (hex string)
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns The Solana pool configuration or undefined if not found
 * @internal
 */
export function getSolanaPoolConfig(shareClassId, environment) {
    const config = POOL_ADDRESS_MAPPING[shareClassId.toLowerCase()];
    if (!config || !config.environment.includes(environment)) {
        return undefined;
    }
    return config;
}
/**
 * Get the USDC mint address for a given environment
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns The USDC mint address
 * @internal
 */
export function getUsdcMintAddress(environment) {
    return USDC_MINT_ADDRESSES[environment];
}
/**
 * Check if a ShareClass ID has a Solana pool address configured
 * @param shareClassId - The ShareClass ID
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns True if the pool is configured for Solana investments
 * @internal
 */
export function hasSolanaPoolAddress(shareClassId, environment) {
    return getSolanaPoolConfig(shareClassId, environment) !== undefined;
}
//# sourceMappingURL=poolAddresses.js.map