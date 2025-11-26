import { Observable } from 'rxjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { SolanaClient } from './SolanaClient.js';
import { Balance } from '../utils/BigInt.js';
import type { ShareClassId } from '../utils/types.js';
import { type SolanaWalletAdapter, type SolanaTransactionStatus } from './types/wallet.js';
/**
 * Manages Solana operations within the Centrifuge SDK.
 * This class provides Solana-specific functionality
 */
export declare class SolanaManager {
    #private;
    /**
     * Get the Solana client
     */
    get client(): SolanaClient;
    /**
     * Get the underlying Solana connection
     */
    get connection(): Connection;
    /**
     * Get account info for a given address
     * @param address - The public key or address string
     */
    accountInfo(address: PublicKey | string): import("../types/query.js").Query<import("@solana/web3.js").AccountInfo<Buffer> | null>;
    /**
     * Get the balance of a Solana account in lamports
     * @param address - The public key or address string
     */
    balance(address: PublicKey | string): import("../types/query.js").Query<number>;
    /**
     * Get the USDC balance for a given Solana wallet address
     * Returns the balance as a Balance object
     * @param address - The wallet's public key or address string
     * @returns Observable that emits the USDC balance
     */
    usdcBalance(address: PublicKey | string): import("../types/query.js").Query<Balance>;
    /**
     * Get the current slot
     */
    getSlot(): import("../types/query.js").Query<number>;
    /**
     * Check if a pool/shareClass supports Solana investments
     * @param shareClassId - The share class ID to check
     * @returns True if the pool has a Solana address configured
     */
    isSolanaPool(shareClassId: ShareClassId): boolean;
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