import { Observable } from 'rxjs';
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { SolanaClient } from './SolanaClient.js';
import { Balance } from '../utils/BigInt.js';
import { getSolanaPoolAddress, getUsdcMintAddress } from './config/poolAddresses.js';
import { SolanaTransactionError, SolanaErrorCode, } from './types/wallet.js';
/**
 * Manages Solana operations within the Centrifuge SDK.
 * This class provides Solana-specific functionality
 */
export class SolanaManager {
    #client;
    #root;
    #signer = null;
    #solanaConfig;
    constructor(root, config) {
        this.#root = root;
        this.#solanaConfig = config;
        this.#client = new SolanaClient(config);
    }
    /**
     * Get the Solana-specific environment
     * Maps EVM environment to Solana environment, with optional override from config
     * @internal
     */
    #getSolanaEnvironment() {
        // If explicitly set in Solana config, use that
        if (this.#solanaConfig.environment) {
            return this.#solanaConfig.environment;
        }
        // Otherwise, map from the main SDK environment
        // EVM 'testnet' -> Solana 'devnet' (Solana's primary development network)
        // EVM 'mainnet' -> Solana 'mainnet'
        const evmEnvironment = this.#root.config.environment;
        return evmEnvironment === 'testnet' ? 'devnet' : 'mainnet';
    }
    /**
     * Get the Solana client
     */
    get client() {
        return this.#client;
    }
    /**
     * Get the underlying Solana connection
     */
    get connection() {
        return this.#client.connection;
    }
    /**
     * Set the Solana signer (keypair)
     */
    setSigner(signer) {
        this.#signer = signer;
    }
    /**
     * Get the current signer
     */
    get signer() {
        return this.#signer;
    }
    /**
     * Get account info for a given address
     * @param address - The public key or address string
     */
    accountInfo(address) {
        const pubkey = typeof address === 'string' ? new PublicKey(address) : address;
        const addressStr = pubkey.toBase58();
        return this._query(['solana', 'accountInfo', addressStr], () => {
            return this.#client.getAccountInfo(pubkey);
        });
    }
    /**
     * Get the balance of a Solana account in lamports
     * @param address - The public key or address string
     */
    balance(address) {
        const pubkey = typeof address === 'string' ? new PublicKey(address) : address;
        const addressStr = pubkey.toBase58();
        return this._query(['solana', 'balance', addressStr], () => {
            return this.#client.getBalance(pubkey);
        });
    }
    /**
     * Get the USDC balance for a given Solana wallet address
     * Returns the balance as a Balance object
     * @param address - The wallet's public key or address string
     * @returns Observable that emits the USDC balance
     */
    usdcBalance(address) {
        const pubkey = typeof address === 'string' ? new PublicKey(address) : address;
        const addressStr = pubkey.toBase58();
        return this._query(['solana', 'usdcBalance', addressStr], () => {
            return new Observable((subscriber) => {
                ;
                (async () => {
                    try {
                        const solanaEnvironment = this.#getSolanaEnvironment();
                        const usdcMint = new PublicKey(getUsdcMintAddress(solanaEnvironment));
                        const tokenAccount = await getAssociatedTokenAddress(usdcMint, pubkey);
                        const accountInfo = await this.connection.getTokenAccountBalance(tokenAccount);
                        const balance = new Balance(BigInt(accountInfo.value.amount), 6);
                        subscriber.next(balance);
                        subscriber.complete();
                    }
                    catch (error) {
                        if (error && typeof error === 'object' && 'message' in error) {
                            const errorMessage = error.message;
                            if (errorMessage.includes('could not find account') || errorMessage.includes('Invalid param')) {
                                subscriber.next(new Balance(0n, 6));
                                subscriber.complete();
                                return;
                            }
                        }
                        subscriber.error(error);
                    }
                })();
            });
        });
    }
    /**
     * Transfer SOL from the signer to another account
     * Returns an observable that emits transaction status updates
     * @param to - Recipient public key
     * @param lamports - Amount to transfer in lamports (1 SOL = 1,000,000,000 lamports)
     */
    transferSol(to, lamports) {
        return new Observable((subscriber) => {
            ;
            (async () => {
                try {
                    if (!this.#signer) {
                        throw new Error('Signer not set. Call setSigner() first.');
                    }
                    const toPubkey = typeof to === 'string' ? new PublicKey(to) : to;
                    subscriber.next({ status: 'signing' });
                    const transaction = new Transaction().add(SystemProgram.transfer({
                        fromPubkey: this.#signer.publicKey,
                        toPubkey,
                        lamports,
                    }));
                    subscriber.next({ status: 'sending' });
                    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.#signer]);
                    subscriber.next({ status: 'confirmed', signature });
                    subscriber.complete();
                }
                catch (error) {
                    subscriber.error(error);
                }
            })();
        });
    }
    /**
     * Get the current slot
     */
    getSlot() {
        return this._query(['solana', 'slot'], () => {
            return this.#client.getSlot();
        });
    }
    /**
     * Watch for account changes
     * @param address - The public key or address string to watch
     */
    watchAccount(address) {
        const pubkey = typeof address === 'string' ? new PublicKey(address) : address;
        return this.#client.watchAccount(pubkey);
    }
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
    invest(amount, shareClassId, wallet) {
        return new Observable((subscriber) => {
            ;
            (async () => {
                try {
                    if (!wallet.publicKey) {
                        throw new SolanaTransactionError('Wallet not connected. Please connect your Solana wallet.', SolanaErrorCode.WALLET_NOT_CONNECTED);
                    }
                    if (amount.decimals !== 6) {
                        throw new SolanaTransactionError(`Invalid amount decimals. USDC must have 6 decimals, got ${amount.decimals}.`, SolanaErrorCode.INVALID_DECIMALS);
                    }
                    if (!amount.gt(0n)) {
                        throw new SolanaTransactionError('Investment amount must be greater than 0.', SolanaErrorCode.INVALID_AMOUNT);
                    }
                    const solanaEnvironment = this.#getSolanaEnvironment();
                    const poolConfig = getSolanaPoolAddress(shareClassId.toString(), solanaEnvironment);
                    if (!poolConfig) {
                        throw new SolanaTransactionError(`No Solana pool address configured for share class ${shareClassId.toString()} in ${solanaEnvironment} environment. ` +
                            'This pool may not support Solana investments yet.', SolanaErrorCode.POOL_NOT_CONFIGURED);
                    }
                    subscriber.next({
                        type: 'preparing',
                        message: 'Preparing USDC transfer transaction...',
                    });
                    const usdcMint = new PublicKey(getUsdcMintAddress(solanaEnvironment));
                    const poolAddress = new PublicKey(poolConfig.address);
                    const fromTokenAccount = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);
                    const toTokenAccount = await getAssociatedTokenAddress(usdcMint, poolAddress);
                    try {
                        const accountInfo = await this.connection.getTokenAccountBalance(fromTokenAccount);
                        const currentBalance = BigInt(accountInfo.value.amount);
                        if (currentBalance < amount.toBigInt()) {
                            throw new SolanaTransactionError(`Insufficient USDC balance. Required: ${amount.toFloat()} USDC, Available: ${Number(currentBalance) / 1_000_000} USDC`, SolanaErrorCode.INSUFFICIENT_BALANCE);
                        }
                    }
                    catch (error) {
                        if (error instanceof SolanaTransactionError) {
                            throw error;
                        }
                        throw new SolanaTransactionError('Could not verify USDC balance. Please ensure you have a USDC token account.', SolanaErrorCode.NETWORK_ERROR, error);
                    }
                    const transaction = new Transaction();
                    transaction.add(createTransferInstruction(fromTokenAccount, toTokenAccount, wallet.publicKey, amount.toBigInt(), [], undefined));
                    let blockhash;
                    let lastValidBlockHeight;
                    try {
                        const latestBlockhash = await this.connection.getLatestBlockhash();
                        blockhash = latestBlockhash.blockhash;
                        lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
                        transaction.recentBlockhash = blockhash;
                        transaction.feePayer = wallet.publicKey;
                    }
                    catch (error) {
                        throw new SolanaTransactionError('Failed to fetch recent blockhash from Solana network.', SolanaErrorCode.NETWORK_ERROR, error);
                    }
                    subscriber.next({
                        type: 'signing',
                        message: 'Waiting for wallet signature...',
                    });
                    let signedTx;
                    try {
                        signedTx = await wallet.signTransaction(transaction);
                    }
                    catch (error) {
                        throw new SolanaTransactionError('Transaction signature was rejected. Please approve the transaction in your wallet.', SolanaErrorCode.SIGNATURE_REJECTED, error);
                    }
                    subscriber.next({
                        type: 'sending',
                        message: 'Sending transaction to Solana network...',
                    });
                    let signature;
                    try {
                        signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
                            skipPreflight: false,
                            preflightCommitment: 'confirmed',
                        });
                    }
                    catch (error) {
                        throw new SolanaTransactionError('Failed to send transaction to Solana network.', SolanaErrorCode.TRANSACTION_FAILED, error);
                    }
                    subscriber.next({
                        type: 'confirming',
                        message: 'Waiting for transaction confirmation...',
                        signature,
                    });
                    try {
                        const confirmation = await this.connection.confirmTransaction({
                            signature,
                            blockhash,
                            lastValidBlockHeight,
                        }, 'confirmed');
                        if (confirmation.value.err) {
                            throw new SolanaTransactionError(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`, SolanaErrorCode.TRANSACTION_FAILED, confirmation.value.err);
                        }
                    }
                    catch (error) {
                        if (error instanceof SolanaTransactionError) {
                            throw error;
                        }
                        throw new SolanaTransactionError('Transaction confirmation failed or timed out.', SolanaErrorCode.TRANSACTION_FAILED, error);
                    }
                    subscriber.next({
                        type: 'confirmed',
                        message: `Successfully invested ${amount.toFloat()} USDC into pool ${poolConfig.poolName || shareClassId.toString()}`,
                        signature,
                    });
                    subscriber.complete();
                }
                catch (error) {
                    if (error instanceof SolanaTransactionError) {
                        subscriber.error(error);
                    }
                    else {
                        subscriber.error(new SolanaTransactionError('An unexpected error occurred during the investment transaction.', SolanaErrorCode.TRANSACTION_FAILED, error));
                    }
                }
            })();
        });
    }
    /**
     * Internal query method that uses the root Centrifuge query cache
     * This ensures Solana queries are cached alongside EVM queries
     * @internal
     */
    _query(keys, observableCallback, options) {
        return this.#root._query(keys, observableCallback, options);
    }
}
//# sourceMappingURL=SolanaManager.js.map