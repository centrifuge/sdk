import type { Observable } from 'rxjs';
import type { Centrifuge } from '../Centrifuge.js';
import type { SolanaWalletAdapter, SolanaTransactionStatus } from '../solana/types/wallet.js';
import type { Balance } from '../utils/BigInt.js';
import type { ShareClassId } from '../utils/types.js';
import { Entity } from './Entity.js';
/**
 * Entity for managing Solana-based investments in a pool
 * This provides a bridge between the ShareClass entity and Solana functionality
 */
export declare class SolanaInvestment extends Entity {
    shareClassId: ShareClassId;
    constructor(_root: Centrifuge, shareClassId: ShareClassId);
    /**
     * Invest USDC into a Solana enabled pool
     *
     * @param amount - The USDC amount to invest
     * @param wallet - The connected Solana wallet adapter
     * @returns Observable that emits transaction status updates and can be awaited
     */
    invest(amount: Balance, wallet: SolanaWalletAdapter): Observable<SolanaTransactionStatus>;
    /**
     * Check if this pool supports Solana investments
     * @returns True if the pool has a Solana address configured
     */
    isAvailable(): boolean;
}
//# sourceMappingURL=SolanaInvestment.d.ts.map