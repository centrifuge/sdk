import type { Observable } from 'rxjs';
import type { Centrifuge } from '../../Centrifuge.js';
import type { SolanaWalletAdapter, SolanaTransactionStatus } from '../types/wallet.js';
import type { Balance } from '../../utils/BigInt.js';
import type { ShareClassId } from '../../utils/types.js';
import { Entity } from '../../entities/Entity.js';
/**
 * Entity for managing Solana-based ShareClass methods in a pool
 * This provides a bridge between the ShareClass entity and Solana functionality
 */
export declare class SolanaShareClass extends Entity {
    shareClassId: ShareClassId;
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
//# sourceMappingURL=SolanaShareClass.d.ts.map