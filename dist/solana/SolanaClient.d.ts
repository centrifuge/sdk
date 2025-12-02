import { Connection, PublicKey } from '@solana/web3.js';
import type { SolanaConfig } from './types/config.js';
/**
 * Manages Solana blockchain connections
 * Similar to how viem clients are managed for EVM chains
 */
export declare class SolanaClient {
    #private;
    constructor(config: SolanaConfig);
    /**
     * Get the underlying Solana connection
     */
    get connection(): Connection;
    /**
     * Get the Solana RPC URL
     */
    get rpcUrl(): string;
    /**
     * Get account info for a given public key
     * @param publicKey - the Solana publicKey (address)
     */
    getAccountInfo(publicKey: PublicKey | string): import("rxjs").Observable<import("@solana/web3.js").AccountInfo<Buffer> | null>;
    /**
     * Get the current slot
     */
    getSlot(): import("rxjs").Observable<number>;
    /**
     * Get the balance of an account in lamports
     * * @param publicKey - the Solana publicKey (address)
     */
    getBalance(publicKey: PublicKey | string): import("rxjs").Observable<number>;
    /**
     * Get recent blockhash
     */
    getLatestBlockhash(): import("rxjs").Observable<Readonly<{
        blockhash: import("@solana/web3.js").Blockhash;
        lastValidBlockHeight: number;
    }>>;
}
//# sourceMappingURL=SolanaClient.d.ts.map