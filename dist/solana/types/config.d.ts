import type { Commitment } from '@solana/web3.js';
/**
 * Solana-specific environment types
 * Note: This is separate from the EVM environment configuration
 * Solana uses 'devnet' for development, which doesn't exist in EVM
 */
export type SolanaEnvironment = 'mainnet' | 'testnet' | 'devnet';
export interface SolanaConfig {
    rpcUrl: string;
    commitment?: Commitment;
    wsEndpoint?: string;
    environment?: SolanaEnvironment;
}
//# sourceMappingURL=config.d.ts.map