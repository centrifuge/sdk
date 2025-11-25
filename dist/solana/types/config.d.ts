import type { Commitment } from '@solana/web3.js';
/**
 * Solana-specific environment types
 * Note: This is separate from the EVM environment configuration
 * Solana uses 'devnet' for development, which doesn't exist in EVM
 */
export type SolanaEnvironment = 'mainnet' | 'testnet' | 'devnet';
/**
 * Solana configuration for the Centrifuge SDK
 */
export interface SolanaConfig {
    rpcUrl: string;
    commitment?: Commitment;
    wsEndpoint?: string;
    /**
     * Optional environment override for Solana
     * If not provided, will derive from the main Centrifuge config:
     * - 'mainnet' -> 'mainnet'
     * - 'testnet' -> 'devnet' (Solana's development network)
     *
     * This allows explicit control when needed:
     * - Use 'devnet' for Solana development
     * - Use 'testnet' for Solana testnet (though devnet is more common)
     * - Use 'mainnet' for production
     */
    environment?: SolanaEnvironment;
}
//# sourceMappingURL=config.d.ts.map