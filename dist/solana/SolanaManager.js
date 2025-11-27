import { Observable } from 'rxjs';
import { PublicKey, Transaction } from '@solana/web3.js';
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
    #solanaConfig;
    /** @internal */
    constructor(root, config) {
        this.#root = root;
        this.#solanaConfig = config;
        this.#client = new SolanaClient(config);
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
     * Get the current slot
     */
    getSlot() {
        return this._query(['solana', 'slot'], () => {
            return this.#client.getSlot();
        });
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
     * Check if a pool/shareClass supports Solana investments
     * @param shareClassId - The share class ID to check
     * @returns True if the pool has a Solana address configured
     */
    isSolanaPool(shareClassId) {
        const solanaEnvironment = this.#getSolanaEnvironment();
        const config = getSolanaPoolAddress(shareClassId.toString(), solanaEnvironment);
        return config !== undefined;
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
                    const investDecimals = 6; // TODO: update if we use other tokens besides USDC
                    this.#validateInvestmentParams(amount, investDecimals, wallet);
                    const solanaEnvironment = this.#getSolanaEnvironment();
                    const poolConfig = this.#getPoolConfig(shareClassId, solanaEnvironment);
                    subscriber.next({
                        type: 'preparing',
                        message: 'Preparing USDC transfer transaction...',
                    });
                    const usdcMint = new PublicKey(getUsdcMintAddress(solanaEnvironment));
                    const poolAddress = new PublicKey(poolConfig.address);
                    const fromTokenAccount = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);
                    const toTokenAccount = await getAssociatedTokenAddress(usdcMint, poolAddress);
                    await this.#validateBalance(fromTokenAccount, amount);
                    const transaction = await this.#buildTransferTransaction(amount, fromTokenAccount, toTokenAccount, wallet);
                    const { blockhash, lastValidBlockHeight } = await this.#prepareTransaction(transaction, wallet.publicKey);
                    subscriber.next({
                        type: 'signing',
                        message: 'Waiting for wallet signature...',
                    });
                    const signature = await this.#signAndSendTransaction(transaction, wallet);
                    subscriber.next({
                        type: 'sending',
                        message: 'Sending transaction to Solana network...',
                    });
                    subscriber.next({
                        type: 'confirming',
                        message: 'Waiting for transaction confirmation...',
                        signature,
                    });
                    await this.#confirmTransaction(signature, blockhash, lastValidBlockHeight);
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
     * Get the Solana-specific environment
     * Maps EVM environment to Solana environment, with optional override from config
     * @internal
     */
    #getSolanaEnvironment() {
        if (this.#solanaConfig.environment) {
            return this.#solanaConfig.environment;
        }
        const evmEnvironment = this.#root.config.environment;
        return evmEnvironment === 'testnet' ? 'devnet' : 'mainnet';
    }
    /**
     * Get pool configuration and validate it exists
     * @internal
     * @param shareClassId - the ShareClassId to be invested in
     * @param solanaEnvironment - the current solana environment being used
     */
    #getPoolConfig(shareClassId, solanaEnvironment) {
        const poolConfig = getSolanaPoolAddress(shareClassId.toString(), solanaEnvironment);
        if (!poolConfig) {
            throw new SolanaTransactionError(`No Solana pool address configured for share class ${shareClassId.toString()} in ${solanaEnvironment} environment. ` +
                'This pool may not support Solana investments yet.', SolanaErrorCode.POOL_NOT_CONFIGURED);
        }
        return poolConfig;
    }
    /**
     * Validate investment parameters
     * @internal
     * @param amount - Balance amount
     * @param decimals - Number of decimals in invest token
     * @param wallet - Solana wallet adapter ({ publicKey, signTransaction })
     */
    #validateInvestmentParams(amount, decimals, wallet) {
        if (!wallet.publicKey) {
            throw new SolanaTransactionError('Wallet not connected. Please connect your Solana wallet.', SolanaErrorCode.WALLET_NOT_CONNECTED);
        }
        if (amount.decimals !== decimals) {
            throw new SolanaTransactionError(`Invalid amount decimals. Invest token must have ${decimals} decimals, got ${amount.decimals}.`, SolanaErrorCode.INVALID_DECIMALS);
        }
        if (!amount.gt(0n)) {
            throw new SolanaTransactionError('Investment amount must be greater than 0.', SolanaErrorCode.INVALID_AMOUNT);
        }
    }
    /**
     * Verify the wallet has sufficient balance of funds
     * @internal
     * @param fromTokenAccount - Solana wallet public key
     * @param amount - Balance amount
     */
    async #validateBalance(fromTokenAccount, amount) {
        try {
            const accountInfo = await this.connection.getTokenAccountBalance(fromTokenAccount);
            const currentBalance = BigInt(accountInfo.value.amount);
            if (currentBalance < amount.toBigInt()) {
                throw new SolanaTransactionError(`Insufficient balance. Required: ${amount.toFloat()}, Available: ${Number(currentBalance) / 1_000_000}`, SolanaErrorCode.INSUFFICIENT_BALANCE);
            }
        }
        catch (error) {
            if (error instanceof SolanaTransactionError) {
                throw error;
            }
            throw new SolanaTransactionError('Could not verify invest token balance. Please ensure you have an invest token account.', SolanaErrorCode.NETWORK_ERROR, error);
        }
    }
    /**
     * Build a transfer transaction
     * @internal
     * @param amount - Balance amount
     * @param fromTokenAccount - Solana wallet public key
     * @param toTokenAccount - Solana wallet public key
     * @param wallet - Solana wallet adapter ({ publicKey, signTransaction })
     */
    async #buildTransferTransaction(amount, fromTokenAccount, toTokenAccount, wallet) {
        const transaction = new Transaction();
        transaction.add(createTransferInstruction(fromTokenAccount, toTokenAccount, wallet.publicKey, amount.toBigInt(), [], undefined));
        return transaction;
    }
    /**
     * Prepare transaction with blockhash and fee payer
     * @internal
     * @param transaction - Solana Transaction
     * @param feePayer - Solana wallet public key
     */
    async #prepareTransaction(transaction, feePayer) {
        try {
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = feePayer;
            return {
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            };
        }
        catch (error) {
            throw new SolanaTransactionError('Failed to fetch recent blockhash from Solana network.', SolanaErrorCode.NETWORK_ERROR, error);
        }
    }
    /**
     * Sign and send transaction to the network
     * @internal
     * @param transaction - Solana Transaction
     * @param wallet - Solana wallet adapter ({ publicKey, signTransaction })
     */
    async #signAndSendTransaction(transaction, wallet) {
        let signedTx;
        try {
            signedTx = await wallet.signTransaction(transaction);
        }
        catch (error) {
            throw new SolanaTransactionError('Transaction signature was rejected. Please approve the transaction in your wallet.', SolanaErrorCode.SIGNATURE_REJECTED, error);
        }
        try {
            const signature = await this.connection.sendRawTransaction(signedTx.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });
            return signature;
        }
        catch (error) {
            throw new SolanaTransactionError('Failed to send transaction to Solana network.', SolanaErrorCode.TRANSACTION_FAILED, error);
        }
    }
    /**
     * Confirm transaction on the network
     * @internal
     * @param signature - string
     * @param blochash - string
     * @param lastValidBlockHeight - number
     */
    async #confirmTransaction(signature, blockhash, lastValidBlockHeight) {
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
    }
    /** @internal */
    _query(keys, observableCallback, options) {
        return this.#root._query(keys, observableCallback, options);
    }
}
//# sourceMappingURL=SolanaManager.js.map