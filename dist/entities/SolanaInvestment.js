import { getSolanaPoolAddress } from '../solana/config/poolAddresses.js';
import { Entity } from './Entity.js';
/**
 * Entity for managing Solana-based investments in a pool
 * This provides a bridge between the ShareClass entity and Solana functionality
 */
export class SolanaInvestment extends Entity {
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
     * @returns Observable that emits transaction status updates and can be awaited
     */
    invest(amount, wallet) {
        if (!this._root.solana) {
            throw new Error('Solana is not configured. Please initialize the Centrifuge SDK with Solana configuration:\n' +
                'new Centrifuge({ solana: { rpcUrl: "...", commitment: "confirmed" } })');
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
//# sourceMappingURL=SolanaInvestment.js.map