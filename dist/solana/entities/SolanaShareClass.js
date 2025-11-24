import { getSolanaPoolAddress } from '../config/poolAddresses.js';
import { Entity } from '../../entities/Entity.js';
/**
 * Entity for managing Solana-based ShareClass methods in a pool
 * This provides a bridge between the ShareClass entity and Solana functionality
 */
export class SolanaShareClass extends Entity {
    shareClassId;
    constructor(_root, shareClassId) {
        super(_root, ['solana-investment', shareClassId.toString()]);
        this.shareClassId = shareClassId;
    }
    /**
     * Invest USDC into a Solana enabled pool
     *
     * @param amount - The USDC amount to invest
     * @param wallet - The connected Solana wallet adapter
     * @returns Observable that emits transaction status updates
     */
    invest(amount, wallet) {
        if (!this._root.solana) {
            throw new Error('Solana is not configured. Please initialize the Centrifuge SDK with Solana configuration.');
        }
        return this._root.solana.invest(amount, this.shareClassId, wallet);
    }
    /**
     * Check if this pool supports Solana investments
     * @returns True if the pool has a Solana address configured
     */
    isAvailable() {
        if (!this._root.solana) {
            return false;
        }
        const config = getSolanaPoolAddress(this.shareClassId.toString(), this._root.config.environment);
        return config !== undefined;
    }
}
//# sourceMappingURL=SolanaShareClass.js.map