import { Connection, PublicKey } from '@solana/web3.js';
import { Observable, defer } from 'rxjs';
/**
 * Manages Solana blockchain connections
 * Similar to how viem clients are managed for EVM chains
 */
export class SolanaClient {
    #connection;
    #config;
    constructor(config) {
        this.#config = config;
        const connectionConfig = {
            commitment: config.commitment ?? 'confirmed',
            wsEndpoint: config.wsEndpoint,
        };
        this.#connection = new Connection(config.rpcUrl, connectionConfig);
    }
    /**
     * Get the underlying Solana connection
     */
    get connection() {
        return this.#connection;
    }
    /**
     * Get the Solana RPC URL
     */
    get rpcUrl() {
        return this.#config.rpcUrl;
    }
    /**
     * Get account info for a given public key
     */
    getAccountInfo(publicKey) {
        const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
        return defer(() => this.#connection.getAccountInfo(pubkey));
    }
    /**
     * Get the current slot
     */
    getSlot() {
        return defer(() => this.#connection.getSlot());
    }
    /**
     * Get the balance of an account in lamports
     */
    getBalance(publicKey) {
        const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
        return defer(() => this.#connection.getBalance(pubkey));
    }
    /**
     * Get recent blockhash
     */
    getLatestBlockhash() {
        return defer(() => this.#connection.getLatestBlockhash());
    }
    /**
     * Create an observable that watches for account changes
     */
    watchAccount(publicKey) {
        const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
        return new Observable((subscriber) => {
            const subscriptionId = this.#connection.onAccountChange(pubkey, (accountInfo) => {
                subscriber.next(accountInfo);
            }, { commitment: this.#config.commitment });
            return () => {
                this.#connection.removeAccountChangeListener(subscriptionId);
            };
        });
    }
}
//# sourceMappingURL=SolanaClient.js.map