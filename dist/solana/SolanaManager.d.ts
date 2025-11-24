import { Observable } from 'rxjs';
import { Connection, Keypair, PublicKey, TransactionSignature } from '@solana/web3.js';
import { SolanaClient, SolanaConfig } from './SolanaClient.js';
import type { Centrifuge } from '../Centrifuge.js';
import { Balance } from '../utils/BigInt.js';
import type { ShareClassId } from '../utils/types.js';
import { type SolanaWalletAdapter, type SolanaTransactionStatus } from './types/wallet.js';
/**
 * Manages Solana operations within the Centrifuge SDK.
 * This class provides Solana-specific functionality
 */
export declare class SolanaManager {
    #private;
    constructor(root: Centrifuge, config: SolanaConfig);
    /**
     * Get the Solana client
     */
    get client(): SolanaClient;
    /**
     * Get the underlying Solana connection
     */
    get connection(): Connection;
    /**
     * Set the Solana signer (keypair)
     */
    setSigner(signer: Keypair | null): void;
    /**
     * Get the current signer
     */
    get signer(): Keypair | null;
    /**
     * Get the balance of a Solana account in lamports
     * @param address - The public key or address string
     */
    balance(address: PublicKey | string): import("../types/query.js").Query<number>;
    /**
     * Get account info for a given address
     * @param address - The public key or address string
     */
    accountInfo(address: PublicKey | string): import("../types/query.js").Query<import("@solana/web3.js").AccountInfo<Buffer> | null>;
    /**
     * Transfer SOL from the signer to another account
     * Returns an observable that emits transaction status updates
     * @param to - Recipient public key
     * @param lamports - Amount to transfer in lamports (1 SOL = 1,000,000,000 lamports)
     */
    transferSol(to: PublicKey | string, lamports: number): Observable<{
        status: 'signing' | 'sending' | 'confirmed';
        signature?: TransactionSignature;
    }>;
    /**
     * Get the current slot
     */
    getSlot(): import("../types/query.js").Query<number>;
    /**
     * Watch for account changes
     * @param address - The public key or address string to watch
     */
    watchAccount(address: PublicKey | string): Observable<any>;
    /**
     * Invest USDC into a Pool's Solana address via Solana network
     * This method transfers USDC from the investor's wallet to the pool's Solana address.
     * The wallet adapter handles all signing and authorization.
     *
     * **Note**: This method is designed for single-signature wallets (Phantom, Solflare, etc.).
     * **TODO**: Create `prepareInvestTransaction()` for multi-sig wallets (Safe, Squads)
     *
     * @param amount - The USDC amount to invest (must have 6 decimals for USDC)
     * @param shareClassId - The share class ID of the pool to invest in
     * @param wallet - The connected Solana wallet adapter
     * @returns Observable that emits transaction status updates
     */
    invest(amount: Balance, shareClassId: ShareClassId, wallet: SolanaWalletAdapter): Observable<SolanaTransactionStatus>;
}
//# sourceMappingURL=SolanaManager.d.ts.map