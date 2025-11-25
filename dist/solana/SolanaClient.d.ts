import { Connection, PublicKey } from '@solana/web3.js';
import { Observable } from 'rxjs';
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
     */
    getAccountInfo(publicKey: PublicKey | string): Observable<import("@solana/web3.js").AccountInfo<Buffer> | null>;
    /**
     * Get the current slot
     */
    getSlot(): Observable<number>;
    /**
     * Get the balance of an account in lamports
     */
    getBalance(publicKey: PublicKey | string): Observable<number>;
    /**
     * Get recent blockhash
     */
    getLatestBlockhash(): Observable<Readonly<{
        blockhash: import("@solana/web3.js").Blockhash;
        lastValidBlockHeight: number;
    }>>;
    /**
     * Create an observable that watches for account changes
     */
    watchAccount(publicKey: PublicKey | string): Observable<any>;
}
//# sourceMappingURL=SolanaClient.d.ts.map