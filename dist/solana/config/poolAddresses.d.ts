/**
 * Internal mapping of ShareClass IDs to Solana pool addresses
 *
 * IMPORTANT: These addresses should match the deployed Solana accounts
 * that are authorized to receive USDC investments for each pool/share class
 */
export interface SolanaPoolConfig {
    address: string;
    environment: 'mainnet' | 'testnet';
    poolName?: string;
}
export declare const USDC_MINT_ADDRESSES: {
    readonly mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    readonly testnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
};
//# sourceMappingURL=poolAddresses.d.ts.map