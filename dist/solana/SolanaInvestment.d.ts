import type { Observable } from 'rxjs';
import type { Centrifuge } from '../Centrifuge.js';
import type { SolanaWalletAdapter, SolanaTransactionStatus } from './types/wallet.js';
import type { Balance } from '../utils/BigInt.js';
import type { ShareClassId } from '../utils/types.js';
/**
 * Handles Solana investment operations for a specific pool/shareClass
 * This is a lightweight wrapper around SolanaManager for user-facing API
 */
export declare class SolanaInvestment {
    private readonly _root;
    readonly shareClassId: ShareClassId;
    constructor(_root: Centrifuge, shareClassId: ShareClassId);
    /**
     * Invest USDC into a Solana enabled pool
     *
     * @param amount - The USDC amount to invest
     * @param wallet - The connected Solana wallet adapter
     * @returns Observable that emits transaction status updates
     */
    invest(amount: Balance, wallet: SolanaWalletAdapter): Observable<SolanaTransactionStatus>;
    /**
     * Check if this pool supports Solana investments
     * @returns True if the pool has a Solana address configured
     */
    isAvailable(): boolean;
}
//# sourceMappingURL=SolanaInvestment.d.ts.map