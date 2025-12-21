import { type Chain } from 'viem';
import { Investor } from './entities/Investor.js';
import { Pool } from './entities/Pool.js';
import { SolanaManager } from './solana/SolanaManager.js';
import type { Client, CurrencyDetails, DerivedConfig, HexString, UserProvidedConfig } from './types/index.js';
import { PoolMetadataInput } from './types/poolInput.js';
import type { Query } from './types/query.js';
import { type Signer, type Transaction } from './types/transaction.js';
import { Balance } from './utils/BigInt.js';
import { AssetId, PoolId } from './utils/types.js';
export declare class Centrifuge {
    #private;
    get config(): DerivedConfig;
    getClient(chainId: number): Client;
    get chains(): number[];
    getChainConfig(chainId: number): Chain;
    setSigner(signer: Signer | null): void;
    get signer(): Signer | null;
    /**
     * Access Solana functionality
     * Returns null if Solana was not configured in the constructor
     */
    get solana(): SolanaManager | null;
    constructor(config?: UserProvidedConfig);
    /**
     * Create a new pool on the given chain.
     * @param metadataInput - The metadata for the pool
     * @param currencyCode - The currency code for the pool
     * @param chainId - The chain ID to create the pool on
     * @param counter - The pool counter, used to create a unique pool ID (uint48)
     */
    createPool(metadataInput: PoolMetadataInput, currencyCode: number | undefined, chainId: number, counter?: number | bigint): Transaction;
    id(chainId: number): Query<number>;
    /**
     * Get the existing pools on the different chains.
     */
    pools(): Query<Pool[]>;
    pool(id: PoolId): Query<Pool>;
    /**
     * Get the metadata for an ERC20 or ERC6909 token
     * @param address - The token address
     * @param chainId - The chain ID
     */
    currency(address: HexString, chainId: number, tokenId?: bigint): Query<CurrencyDetails>;
    /**
     * Get the asset currency details for a given asset ID
     * @param assetId - The asset ID to query
     */
    assetCurrency(assetId: AssetId): Query<CurrencyDetails>;
    investor(address: HexString): Query<Investor>;
    /**
     * Get the balance of an ERC20 token for a given owner.
     * @param currency - The token address
     * @param owner - The owner address
     * @param chainId - The chain ID
     */
    balance(currency: HexString, owner: HexString, chainId: number): Query<{
        balance: Balance;
        currency: CurrencyDetails;
    }>;
    /**
     * Get the assets that exist on a given spoke chain that have been registered on a given hub chain.
     * @param spokeChainId - The chain ID where the assets exist
     * @param hubChainId - The chain ID where the assets should optionally be registered
     */
    assets(spokeChainId: number, hubChainId?: number): Query<{
        id: AssetId;
        address: `0x${string}`;
        name: string;
        symbol: string;
        decimals: number;
        tokenId: bigint | undefined;
    }[]>;
    /**
     * Get the valuation addresses that can be used for holdings.
     */
    valuations(chainId: number): Query<{
        identityValuation: `0x${string}`;
    }>;
    /**
     * Get the restriction hook addresses that can be used for share tokens.
     */
    restrictionHooks(chainId: number): Query<{
        freezeOnlyHook: `0x${string}`;
        redemptionRestrictionsHook: `0x${string}`;
        fullRestrictionsHook: `0x${string}`;
    }>;
    /**
     * Register an asset
     * @param originChainId - The chain ID where the asset exists
     * @param registerOnChainId - The chain ID where the asset should be registered
     * @param assetAddress - The address of the asset to register
     * @param tokenId - Optional token ID for ERC6909 assets
     */
    registerAsset(originChainId: number, registerOnChainId: number, assetAddress: HexString, tokenId?: number | bigint): Transaction;
    /**
     * Repay an underpaid batch of messages on the Gateway
     */
    repayBatch(fromChain: number, to: {
        chainId: number;
    } | {
        centId: number;
    }, batch: HexString, extraPayment?: bigint): Transaction;
    /**
     * Retry a failed message on the destination chain
     */
    retryMessage(fromChain: number, toChain: number, message: HexString): Transaction;
    _queryIndexer<Result>(query: string, variables?: Record<string, any>, postProcess?: undefined, pollInterval?: number): Query<Result>;
    _queryIndexer<Result, Return>(query: string, variables: Record<string, any>, postProcess: (data: Result) => Return, pollInterval?: number): Query<Return>;
}
//# sourceMappingURL=Centrifuge.d.ts.map