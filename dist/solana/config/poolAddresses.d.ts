/**
 * Internal mapping of ShareClass IDs to Solana pool addresses
 *
 * IMPORTANT: These addresses should match the deployed Solana accounts
 * that are authorized to receive USDC investments for each pool/share class
 */
import type { SolanaEnvironment } from '../types/config.js';
export interface SolanaPoolConfig {
    address: string;
    environment: SolanaEnvironment;
    poolName?: string;
}
export declare const USDC_MINT_ADDRESSES: Record<SolanaEnvironment, string>;
//# sourceMappingURL=poolAddresses.d.ts.map