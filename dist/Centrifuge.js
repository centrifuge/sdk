import { combineLatest, defer, filter, first, identity, isObservable, map, mergeMap, of, switchMap, timer, Observable, shareReplay, } from 'rxjs';
import { fromFetch } from 'rxjs/fetch';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, fallback, getContract, http, keccak256, parseAbi, toHex, } from 'viem';
import { ABI } from './abi/index.js';
import { chains } from './config/chains.js';
import { PERMIT_TYPEHASH } from './constants.js';
import { Investor } from './entities/Investor.js';
import { Pool } from './entities/Pool.js';
import { SolanaManager } from './solana/SolanaManager.js';
import { emptyMessage, MessageType, } from './types/transaction.js';
import { Balance } from './utils/BigInt.js';
import { randomUint } from './utils/index.js';
import { createPinning, getUrlFromHash } from './utils/ipfs.js';
import { hashKey } from './utils/query.js';
import { makeThenable, repeatOnEvents, shareReplayWithDelayedReset } from './utils/rx.js';
import { doTransaction, isLocalAccount, parseEventLogs, wrapTransaction, } from './utils/transaction.js';
import { AssetId, PoolId, ShareClassId } from './utils/types.js';
const PINNING_API_DEMO = 'https://europe-central2-peak-vista-185616.cloudfunctions.net/pinning-api-demo';
const envConfig = {
    mainnet: {
        indexerUrl: 'https://api.centrifuge.io',
        ipfsUrl: 'https://centrifuge.mypinata.cloud',
        ...createPinning(PINNING_API_DEMO),
    },
    testnet: {
        indexerUrl: 'https://api-v3-hitz.marble.live/graphql',
        ipfsUrl: 'https://centrifuge.mypinata.cloud',
        ...createPinning(PINNING_API_DEMO),
    },
};
const defaultConfig = {
    environment: 'mainnet',
    cache: true,
};
export class Centrifuge {
    #config;
    get config() {
        return this.#config;
    }
    #clients = new Map();
    getClient(chainId) {
        const client = this.#clients.get(chainId);
        if (!client)
            throw new Error(`No client found for chain ID "${chainId}"`);
        return client;
    }
    get chains() {
        return [...this.#clients.keys()];
    }
    getChainConfig(chainId) {
        return this.getClient(chainId).chain;
    }
    #signer = null;
    setSigner(signer) {
        this.#signer = signer;
    }
    get signer() {
        return this.#signer;
    }
    #solanaManager = null;
    /**
     * Access Solana functionality
     * Returns null if Solana was not configured in the constructor
     */
    get solana() {
        return this.#solanaManager;
    }
    #isBatching = new WeakSet();
    constructor(config = {}) {
        const defaultConfigForEnv = envConfig[config?.environment || 'mainnet'];
        this.#config = {
            ...defaultConfig,
            ...defaultConfigForEnv,
            ...config,
        };
        Object.freeze(this.#config);
        chains
            .filter((chain) => (this.#config.environment === 'mainnet' ? !chain.testnet : chain.testnet))
            .forEach((chain) => {
            const rpcUrl = this.#config.rpcUrls?.[chain.id] ?? undefined;
            if (!rpcUrl) {
                console.warn(`No rpcUrl defined for chain ${chain.id}. Using public RPC endpoint.`);
            }
            this.#clients.set(chain.id, createPublicClient({
                chain,
                transport: Array.isArray(rpcUrl)
                    ? fallback(rpcUrl.map((url) => http(url)), {
                        rank: {
                            interval: 30_000,
                            sampleCount: 5,
                        },
                    })
                    : http(rpcUrl),
                batch: { multicall: true },
                pollingInterval: this.#config.pollingInterval,
                cacheTime: 100,
            }));
        });
        if (this.#config.solana) {
            this.#solanaManager = new SolanaManager(this, this.#config.solana);
        }
    }
    /**
     * Create a new pool on the given chain.
     * @param metadataInput - The metadata for the pool
     * @param currencyCode - The currency code for the pool
     * @param chainId - The chain ID to create the pool on
     * @param counter - The pool counter, used to create a unique pool ID (uint48)
     */
    createPool(metadataInput, currencyCode = 840, chainId, counter) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [addresses, id] = await Promise.all([self._protocolAddresses(chainId), self.id(chainId)]);
            const poolId = PoolId.from(id, counter ?? randomUint(48));
            const createPoolData = encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'createPool',
                args: [poolId.raw, ctx.signingAddress, BigInt(currencyCode)],
            });
            const scIds = Array.from({ length: metadataInput.shareClasses.length }, (_, i) => ShareClassId.from(poolId, i + 1));
            const shareClassesById = {};
            metadataInput.shareClasses.forEach((sc, index) => {
                shareClassesById[scIds[index].raw] = {
                    minInitialInvestment: sc.minInvestment,
                    apyPercentage: sc.apyPercentage,
                    apy: sc.apy,
                    defaultAccounts: sc.defaultAccounts,
                };
            });
            const formattedMetadata = {
                version: 1,
                pool: {
                    name: metadataInput.poolName,
                    icon: metadataInput.poolIcon,
                    asset: {
                        class: metadataInput.assetClass,
                        subClass: metadataInput.subAssetClass,
                    },
                    issuer: {
                        name: metadataInput.issuerName,
                        repName: metadataInput.issuerRepName,
                        description: metadataInput.issuerDescription,
                        email: metadataInput.email,
                        logo: metadataInput.issuerLogo,
                        shortDescription: metadataInput.issuerShortDescription,
                        categories: metadataInput.issuerCategories,
                    },
                    poolStructure: metadataInput.poolStructure,
                    investorType: metadataInput.investorType,
                    links: {
                        executiveSummary: metadataInput.executiveSummary,
                        forum: metadataInput.forum,
                        website: metadataInput.website,
                    },
                    details: metadataInput.details,
                    status: 'open',
                    listed: metadataInput.listed ?? true,
                    poolRatings: metadataInput.poolRatings.length > 0 ? metadataInput.poolRatings : [],
                    reports: metadataInput.report
                        ? [
                            {
                                author: {
                                    name: metadataInput.report.author.name,
                                    title: metadataInput.report.author.title,
                                    avatar: metadataInput.report.author.avatar,
                                },
                                uri: metadataInput.report.uri,
                            },
                        ]
                        : [],
                },
                shareClasses: shareClassesById,
                onboarding: {
                    shareClasses: metadataInput.onboarding?.shareClasses || {},
                    taxInfoRequired: metadataInput.onboarding?.taxInfoRequired,
                    externalOnboardingUrl: metadataInput.onboarding?.externalOnboardingUrl,
                },
            };
            const cid = await self.config.pinJson(formattedMetadata);
            const setMetadataData = encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'setPoolMetadata',
                args: [poolId.raw, toHex(cid)],
            });
            const addScData = metadataInput.shareClasses.map((sc) => encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'addShareClass',
                args: [
                    poolId.raw,
                    sc.tokenName,
                    sc.symbolName,
                    sc.salt?.startsWith('0x') ? sc.salt : toHex(sc.salt ?? randomUint(256), { size: 32 }),
                ],
            }));
            const accountIsDebitNormal = new Map();
            const accountNumbers = [
                ...new Set(metadataInput.shareClasses.flatMap((sc) => Object.entries(sc.defaultAccounts ?? {})
                    .filter(([k, v]) => {
                    if (!v)
                        return false;
                    if (['asset', 'expense'].includes(k)) {
                        if (accountIsDebitNormal.get(v) === false)
                            throw new Error(`Account "${v}" is set as both credit normal and debit normal.`);
                        accountIsDebitNormal.set(v, true);
                    }
                    else {
                        if (accountIsDebitNormal.get(v) === true)
                            throw new Error(`Account "${v}" is set as both credit normal and debit normal.`);
                        accountIsDebitNormal.set(v, false);
                    }
                    return true;
                })
                    .map(([, v]) => v))),
            ];
            const createAccountsData = accountNumbers.map((account) => encodeFunctionData({
                abi: ABI.Hub,
                functionName: 'createAccount',
                args: [poolId.raw, account, accountIsDebitNormal.get(account)],
            }));
            yield* doTransaction('Create pool', ctx, () => {
                return ctx.walletClient.writeContract({
                    address: addresses.hub,
                    abi: ABI.Hub,
                    functionName: 'multicall',
                    args: [[createPoolData, setMetadataData, ...addScData, ...createAccountsData]],
                });
            });
        }, chainId);
    }
    id(chainId) {
        return this._query(['centrifugeId', chainId], () => this._protocolAddresses(chainId).pipe(switchMap(({ messageDispatcher }) => {
            return this.getClient(chainId).readContract({
                address: messageDispatcher,
                abi: ABI.MessageDispatcher,
                functionName: 'localCentrifugeId',
            });
        })));
    }
    /**
     * Get the existing pools on the different chains.
     */
    pools() {
        return this._queryIndexer(`{
        pools {
          items {
            id
            blockchain {
              id
            }
          }
        }
      }`, {}, (data) => {
            return data.pools.items.map((pool) => {
                const poolId = new PoolId(pool.id);
                return new Pool(this, poolId.toString(), Number(pool.blockchain.id));
            });
        });
    }
    pool(id) {
        return this._query(['pool', id.toString()], () => this.pools().pipe(map((pools) => {
            const pool = pools.find((pool) => pool.id.equals(id));
            if (!pool)
                throw new Error(`Pool with id ${id} not found`);
            return pool;
        })));
    }
    /**
     * Get the metadata for an ERC20 or ERC6909 token
     * @param address - The token address
     * @param chainId - The chain ID
     */
    currency(address, chainId, tokenId = 0n) {
        const curAddress = address.toLowerCase();
        return this._query(['currency', curAddress, chainId, tokenId], () => defer(async () => {
            let decimals, name, symbol, supportsPermit;
            if (tokenId) {
                const contract = getContract({
                    address: curAddress,
                    abi: ABI.ERC6909,
                    client: this.getClient(chainId),
                });
                [decimals, name, symbol] = await Promise.all([
                    contract.read.decimals([tokenId]),
                    contract.read.name([tokenId]),
                    contract.read.symbol([tokenId]),
                ]);
                supportsPermit = false;
            }
            else {
                const contract = getContract({
                    address: curAddress,
                    abi: ABI.Currency,
                    client: this.getClient(chainId),
                });
                [decimals, name, symbol, supportsPermit] = await Promise.all([
                    contract.read.decimals(),
                    contract.read.name(),
                    contract.read.symbol(),
                    contract.read
                        .PERMIT_TYPEHASH()
                        .then((hash) => hash === PERMIT_TYPEHASH)
                        .catch(() => false),
                ]);
            }
            return {
                address: curAddress,
                tokenId,
                decimals,
                name,
                symbol,
                chainId,
                supportsPermit,
            };
        }));
    }
    /**
     * Get the asset currency details for a given asset ID
     * @param assetId - The asset ID to query
     */
    assetCurrency(assetId) {
        return this._query(['asset', assetId.toString()], () => this._idToChain(assetId.centrifugeId).pipe(switchMap((chainId) => this._protocolAddresses(chainId).pipe(map(({ spoke }) => ({ chainId, spoke })))), switchMap(async ({ spoke, chainId }) => {
            const [assetAddress, tokenId] = await this.getClient(chainId).readContract({
                address: spoke,
                abi: ABI.Spoke,
                functionName: 'idToAsset',
                args: [assetId.raw],
            });
            return this.currency(assetAddress, chainId, tokenId);
        })));
    }
    investor(address) {
        return this._query(['investor', address.toLowerCase()], () => of(new Investor(this, address)));
    }
    /**
     * Get the balance of an ERC20 token for a given owner.
     * @param currency - The token address
     * @param owner - The owner address
     * @param chainId - The chain ID
     */
    balance(currency, owner, chainId) {
        const address = owner.toLowerCase();
        return this._query(['balance', currency, owner, chainId], () => {
            return this.currency(currency, chainId).pipe(switchMap((currencyMeta) => defer(async () => {
                const val = await this.getClient(chainId).readContract({
                    address: currency,
                    abi: ABI.Currency,
                    functionName: 'balanceOf',
                    args: [address],
                });
                return {
                    balance: new Balance(val, currencyMeta.decimals),
                    currency: currencyMeta,
                };
            }).pipe(repeatOnEvents(this, {
                address: currency,
                eventName: 'Transfer',
                filter: (events) => {
                    return events.some((event) => {
                        return event.args.from?.toLowerCase() === address || event.args.to?.toLowerCase() === address;
                    });
                },
            }, chainId))));
        });
    }
    /**
     * Get the assets that exist on a given spoke chain that have been registered on a given hub chain.
     * @param spokeChainId - The chain ID where the assets exist
     * @param hubChainId - The chain ID where the assets should optionally be registered
     */
    assets(spokeChainId, hubChainId = spokeChainId) {
        return this._query(['assets', spokeChainId, hubChainId], () => combineLatest([this.id(spokeChainId), this.id(hubChainId)]).pipe(switchMap(([spokeCentId, hubCentId]) => this._queryIndexer(`query ($hubCentId: String!) {
              assetRegistrations(where: { centrifugeId: $hubCentId }, limit: 1000) {
                items {
                  assetId
                  asset {
                    centrifugeId
                    address
                    name
                    symbol
                    decimals
                    assetTokenId
                  }
                }
              }
            }`, { hubCentId: String(hubCentId) }).pipe(map((data) => {
            return data.assetRegistrations.items
                .filter((assetReg) => assetReg.asset && Number(assetReg.asset.centrifugeId) === spokeCentId)
                .map((assetReg) => {
                return {
                    id: new AssetId(assetReg.assetId),
                    address: assetReg.asset.address,
                    name: assetReg.asset.name,
                    symbol: assetReg.asset.symbol,
                    decimals: assetReg.asset.decimals,
                    tokenId: assetReg.asset.assetTokenId ? BigInt(assetReg.asset.assetTokenId) : undefined,
                };
            });
        })))));
    }
    /**
     * Get the valuation addresses that can be used for holdings.
     */
    valuations(chainId) {
        return this._query(['valuations', chainId], () => this._protocolAddresses(chainId).pipe(map(({ identityValuation }) => {
            return {
                identityValuation,
            };
        })));
    }
    /**
     * Get the restriction hook addresses that can be used for share tokens.
     */
    restrictionHooks(chainId) {
        return this._query(['restrictionHooks', chainId], () => this._protocolAddresses(chainId).pipe(map(({ freezeOnlyHook, redemptionRestrictionsHook, fullRestrictionsHook /* freelyTransferableHook */ }) => {
            return {
                freezeOnlyHook,
                redemptionRestrictionsHook,
                fullRestrictionsHook,
            };
        })));
    }
    /**
     * Register an asset
     * @param originChainId - The chain ID where the asset exists
     * @param registerOnChainId - The chain ID where the asset should be registered
     * @param assetAddress - The address of the asset to register
     * @param tokenId - Optional token ID for ERC6909 assets
     */
    registerAsset(originChainId, registerOnChainId, assetAddress, tokenId = 0) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [addresses, id, estimate] = await Promise.all([
                self._protocolAddresses(originChainId),
                self.id(registerOnChainId),
                self._estimate(originChainId, { chainId: registerOnChainId }, MessageType.RegisterAsset),
            ]);
            yield* doTransaction('Register asset', ctx, () => ctx.walletClient.writeContract({
                address: addresses.spoke,
                abi: ABI.Spoke,
                functionName: 'registerAsset',
                args: [id, assetAddress, BigInt(tokenId)],
                value: estimate,
            }));
        }, originChainId);
    }
    /**
     * Repay an underpaid batch of messages on the Gateway
     */
    repayBatch(fromChain, to, batch, extraPayment = 0n) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [addresses, toCentId] = await Promise.all([
                self._protocolAddresses(fromChain),
                'chainId' in to ? self.id(to.chainId) : to.centId,
            ]);
            const client = self.getClient(fromChain);
            const batchHash = keccak256(batch);
            const [counter, gasLimit] = await client.readContract({
                address: addresses.gateway,
                abi: ABI.Gateway,
                functionName: 'underpaid',
                args: [toCentId, batchHash],
            });
            if (counter === 0n) {
                throw new Error(`Batch is not underpaid and can't be repaid. Batch hash: "${batchHash}"`);
            }
            const estimate = await client.readContract({
                address: addresses.multiAdapter,
                abi: ABI.MultiAdapter,
                functionName: 'estimate',
                args: [toCentId, batch, gasLimit],
            });
            yield* doTransaction('Repay', ctx, () => ctx.walletClient.writeContract({
                address: addresses.gateway,
                abi: ABI.Gateway,
                functionName: 'repay',
                args: [toCentId, batch],
                value: estimate + extraPayment,
            }));
        }, fromChain);
    }
    /**
     * Retry a failed message on the destination chain
     */
    retryMessage(fromChain, toChain, message) {
        const self = this;
        return this._transact(async function* (ctx) {
            const [addresses, fromCentId] = await Promise.all([self._protocolAddresses(toChain), self.id(fromChain)]);
            yield* doTransaction('Retry', ctx, () => ctx.walletClient.writeContract({
                address: addresses.gateway,
                abi: ABI.Gateway,
                functionName: 'retry',
                args: [fromCentId, message],
            }));
        }, toChain);
    }
    /**
     * Get the decimals of asset on the Hub side
     * @internal
     */
    _assetDecimals(assetId, chainId) {
        return this._query(['assetDecimals', assetId.toString()], () => this._protocolAddresses(chainId).pipe(switchMap(({ hubRegistry }) => this.getClient(chainId).readContract({
            address: hubRegistry,
            // Use inline ABI because of function overload
            abi: parseAbi(['function decimals(uint128) view returns (uint8)']),
            functionName: 'decimals',
            args: [assetId.raw],
        }))));
    }
    /**
     * Get the allowance of an ERC20 or ERC6909 token.
     * which is the contract that moves funds into the vault on behalf of the investor.
     * @param owner - The address of the owner
     * @param spender - The address of the spender
     * @param chainId - The chain ID where the asset is located
     * @param asset - The address of the asset
     * @param tokenId - Optional token ID for ERC6909 assets
     * @internal
     */
    _allowance(owner, spender, chainId, asset, tokenId) {
        return this._query(['allowance', owner.toLowerCase(), spender.toLowerCase(), asset.toLowerCase(), chainId, tokenId], () => defer(async () => {
            const client = this.getClient(chainId);
            if (tokenId) {
                return client.readContract({
                    address: asset,
                    abi: ABI.ERC6909,
                    functionName: 'allowance',
                    args: [owner, spender, tokenId],
                });
            }
            return client.readContract({
                address: asset,
                abi: ABI.Currency,
                functionName: 'allowance',
                args: [owner, spender],
            });
        }).pipe(repeatOnEvents(this, {
            address: asset,
            eventName: ['Approval', 'Transfer'],
            filter: (events) => {
                return events.some((event) => {
                    return (event.args.owner?.toLowerCase() === owner.toLowerCase() ||
                        event.args.spender?.toLowerCase() === owner.toLowerCase() ||
                        event.args.from?.toLowerCase() === owner.toLowerCase());
                });
            },
        }, chainId)));
    }
    /**
     * Returns an observable of all events on a given chain.
     * @internal
     */
    _events(chainId) {
        return this._query(['events', chainId], () => new Observable((subscriber) => {
            const unwatch = this.getClient(chainId).watchEvent({
                onLogs: (logs) => subscriber.next(logs),
            });
            return unwatch;
        }).pipe(filter((logs) => logs.length > 0), shareReplay({ bufferSize: 1, refCount: true }) // ensures only one watcher per chainId
        ), { cache: true });
    }
    /**
     * Returns an observable of events on a given chain, filtered by name(s) and address(es).
     * @internal
     */
    _filteredEvents(address, eventName, chainId) {
        return this._events(chainId).pipe(map((logs) => {
            return parseEventLogs({
                address,
                eventName,
                logs,
            });
        }), filter((logs) => logs.length > 0));
    }
    /**
     * @internal
     */
    _getIndexerObservable(query, variables) {
        return fromFetch(this.config.indexerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ query, variables }),
            selector: async (res) => {
                const { data, errors } = await res.json();
                if (errors?.length) {
                    throw errors;
                }
                return data;
            },
        });
    }
    _queryIndexer(query, variables, postProcess, pollInterval = this.config.indexerPollingInterval ?? 120_000) {
        return this._query([query, variables], () => 
        // If subscribed, refetch every `pollInterval` milliseconds
        timer(0, pollInterval).pipe(switchMap(() => this._getIndexerObservable(query, variables).pipe(map(postProcess ?? identity)))));
    }
    /**
     * @internal
     */
    _queryIPFS(hash) {
        return this._query([hash], () => defer(async () => {
            const url = getUrlFromHash(hash, this.#config.ipfsUrl);
            if (!url) {
                throw new Error(`Invalid IPFS hash: ${hash}`);
            }
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Error fetching IPFS hash ${hash}: ${res.statusText}`);
            }
            const data = (await res.json());
            return data;
        }));
    }
    #memoized = new Map();
    #memoizeWith(keys, callback) {
        const cacheKey = hashKey(keys);
        if (this.#memoized.has(cacheKey)) {
            return this.#memoized.get(cacheKey);
        }
        const result = callback();
        this.#memoized.set(cacheKey, result);
        return result;
    }
    /**
     * Wraps an observable, memoizing the result based on the keys provided.
     * If keys are provided, the observable will be memoized, multicasted, and the last emitted value cached.
     * Additional options can be provided to control the caching behavior.
     * By default, the observable will keep the last emitted value and pass it immediately to new subscribers.
     * When there are no subscribers, the observable resets after a short timeout and purges the cached value.
     *
     * @example
     *
     * ```ts
     * const address = '0xabc...123'
     * const tUSD = '0x456...def'
     * const chainId = 1
     *
     * // Wrap an observable that continuously emits values
     * const query = this._query(['balance', address, tUSD, chainId], () => {
     *   return defer(() => fetchBalance(address, tUSD, chainId))
     *   .pipe(
     *     repeatOnEvents(
     *       this,
     *       {
     *         address: tUSD,
     *         eventName: 'Transfer',
     *       },
     *       chainId
     *     )
     *   )
     * })
     *
     * // Logs the current balance and updated balances whenever a transfer event is emitted
     * const obs1 = query.subscribe(balance => console.log(balance))
     *
     * // Subscribing twice only fetches the balance once and will emit the same value to both subscribers
     * const obs2 = query.subscribe(balance => console.log(balance))
     *
     * // ... sometime later
     *
     * // Later subscribers will receive the last emitted value immediately
     * const obs3 = query.subscribe(balance => console.log(balance))
     *
     * // Awaiting the query will also immediately return the last emitted value or wait for the next value
     * const balance = await query
     *
     * obs1.unsubscribe()
     * obs2.unsubscribe()
     * obs3.unsubscribe()
     * ```
     *
     * ```ts
     * const address = '0xabc...123'
     * const tUSD = '0x456...def'
     * const chainId = 1
     *
     * // Wrap an observable that only emits one value and then completes
     * const query = this._query(['balance', address, tUSD, chainId], () => {
     *   return defer(() => fetchBalance(address, tUSD, chainId))
     * }, { valueCacheTime: 60_000 })
     *
     * // Logs the current balance and updated balances whenever a new
     * const obs1 = query.subscribe(balance => console.log(balance))
     *
     * // Subscribing twice only fetches the balance once and will emit the same value to both subscribers
     * const obs2 = query.subscribe(balance => console.log(balance))
     *
     * // ... sometime later
     *
     * // Later subscribers will receive the last emitted value immediately
     * const obs3 = query.subscribe(balance => console.log(balance))
     *
     * // Awaiting the query will also immediately return the last emitted value or wait for the next value
     * const balance = await query
     *
     * obs1.unsubscribe()
     * obs2.unsubscribe()
     * obs3.unsubscribe()
     * ```
     *
     * @internal
     */
    _query(keys, observableCallback, options) {
        const cache = options?.cache !== false && this.#config.cache !== false;
        const obsCacheTime = options?.observableCacheTime ?? this.#config.pollingInterval ?? 4000;
        function get() {
            const $shared = observableCallback().pipe(shareReplayWithDelayedReset({
                bufferSize: cache ? 1 : 0,
                resetDelay: cache ? obsCacheTime : 0,
            }));
            return makeThenable($shared);
        }
        return keys ? this.#memoizeWith(keys, get) : get();
    }
    /**
     * Executes one or more transactions on a given chain.
     * When subscribed to, it emits status updates as it progresses.
     * When awaited, it returns the final confirmed result if successful.
     * Will additionally prompt the user to switch chains if they're not on the correct chain.
     *
     * @example
     *
     * ```ts
     * const tx = this._transact(async function* ({ walletClient, publicClient, chainId, signingAddress, signer }) {
     *   const permit = yield* doSignMessage('Sign Permit', () => {
     *     return signPermit(walletClient, signer, chainId, signingAddress, '0xabc...123', '0xdef...456', 1000000n)
     *   })
     *   yield* doTransaction('Invest', publicClient, () =>
     *     walletClient.writeContract({
     *       address: '0xdef...456',
     *       abi: ABI.LiquidityPool,
     *       functionName: 'requestDepositWithPermit',
     *       args: [1000000n, permit],
     *     })
     *   )
     * }, 1)
     * tx.subscribe(status => console.log(status))
     *
     * // Results in something like the following values being emitted (assuming the user was on the right chain):
     * // { type: 'SigningMessage', title: 'Sign Permit' }
     * // { type: 'SignedMessage', title: 'Sign Permit', signed: { ... } }
     * // { type: 'SigningTransaction', title: 'Invest' }
     * // { type: 'TransactionPending', title: 'Invest', hash: '0x123...abc' }
     * // { type: 'TransactionConfirmed', title: 'Invest', hash: '0x123...abc', receipt: { ... } }
     * ```
     *
     * @internal
     */
    _transact(transactionCallback, chainId) {
        const self = this;
        async function* transact() {
            let isBatching = false;
            if (self.#isBatching.has($tx)) {
                isBatching = true;
            }
            const { signer } = self;
            if (!signer)
                throw new Error('Signer not set');
            const publicClient = self.getClient(chainId);
            const chain = self.getChainConfig(chainId);
            let walletClient = isLocalAccount(signer)
                ? createWalletClient({
                    account: signer,
                    chain,
                    transport: http(),
                })
                : createWalletClient({ transport: custom(signer) });
            const [address] = await walletClient.getAddresses();
            if (!address)
                throw new Error('No account selected');
            if (!isBatching) {
                const selectedChain = await walletClient.getChainId();
                if (selectedChain !== chainId) {
                    yield { type: 'SwitchingChain', chainId };
                    await walletClient.switchChain({ id: chainId });
                }
            }
            // Re-create the wallet client with the correct chain and account
            // Saves having to pass `account` and `chain` to every `writeContract` call
            walletClient = isLocalAccount(signer)
                ? walletClient
                : createWalletClient({ account: address, chain, transport: custom(signer) });
            const transaction = transactionCallback({
                isBatching,
                signingAddress: address,
                chain,
                chainId,
                publicClient,
                walletClient,
                signer,
                root: self,
            });
            if (Symbol.asyncIterator in transaction) {
                yield* transaction;
            }
            else if (isObservable(transaction)) {
                yield transaction;
            }
            else {
                throw new Error('Invalid arguments');
            }
        }
        const $tx = defer(transact).pipe(mergeMap((d) => (isObservable(d) ? d : of(d))));
        makeThenable($tx, true);
        Object.assign($tx, {
            chainId,
        });
        return $tx;
    }
    /**
     * Batch multiple transactions together into a single transaction.
     * It's not exposed, because it is somewhat limited and requires knowledge of internals.
     * It only works when there's only a single transaction being done in the method.
     * It only works for methods that wrap the transaction in `wrapTransaction`.
     * It only works when the transactions are executed on the same contract on the same chain,
     * and that contract supports multicall
     * @internal
     */
    _experimental_batch(title, transactions) {
        const chainIds = [...new Set(transactions.map((tx) => tx.chainId))];
        if (chainIds.length !== 1) {
            throw new Error(`Cannot batch transactions on different chains: ${chainIds.join(', ')}`);
        }
        for (const tx of transactions) {
            this.#isBatching.add(tx);
        }
        return this._transact((ctx) => {
            if (transactions.length === 0)
                throw new Error('No transactions to batch');
            return combineLatest(transactions.map((tx) => tx.pipe(first()))).pipe(switchMap(async function* (batches_) {
                const batches = batches_;
                if (!batches.every((b) => b.data && b.contract)) {
                    throw new Error('Not all transactions can be batched');
                }
                const value = batches.reduce((acc, b) => acc + (b.value ?? 0n), 0n);
                const data = batches.map((b) => b.data).flat();
                const messages = batches.reduce((acc, b) => {
                    if (b.messages) {
                        Object.entries(b.messages).forEach(([cid, types]) => {
                            const chainId = Number(cid);
                            if (!acc[chainId])
                                acc[chainId] = [];
                            acc[chainId].push(...types);
                        });
                    }
                    return acc;
                }, {});
                const contracts = [...new Set(batches.map((b) => b.contract))];
                if (contracts.length !== 1) {
                    throw new Error(`Cannot batch transactions to different contracts: ${contracts.join(', ')}`);
                }
                yield* wrapTransaction(title, ctx, { data, value, contract: contracts[0], messages });
            }));
        }, chainIds[0]);
    }
    /** @internal */
    _protocolAddresses(chainId) {
        return this._query(['protocolAddresses', chainId], () => this._deployments().pipe(map((data) => {
            if (!this.chains.includes(chainId)) {
                throw new Error(`Chain ID "${chainId}" not supported`);
            }
            const deployment = data.deployments.items.find((d) => Number(d.chainId) === chainId);
            if (!deployment) {
                throw new Error(`No protocol contracts found for chain ID "${chainId}"`);
            }
            return deployment;
        })));
    }
    /** @internal */
    _getQuote(valuationAddress, baseAmount, baseAssetId, quoteAssetId, chainId) {
        return this._query(['getQuote', baseAmount, baseAssetId.toString(), quoteAssetId.toString()], () => timer(0, 60_000).pipe(switchMap(() => this._protocolAddresses(chainId)), switchMap(({ hubRegistry }) => defer(async () => {
            const [quote, quoteDecimals] = await Promise.all([
                this.getClient(chainId).readContract({
                    address: valuationAddress,
                    abi: ABI.Valuation,
                    functionName: 'getQuote',
                    args: [baseAmount.toBigInt(), baseAssetId.raw, quoteAssetId.raw],
                }),
                this.getClient(chainId).readContract({
                    address: hubRegistry,
                    // Use inline ABI because of function overload
                    abi: parseAbi(['function decimals(uint256) view returns (uint8)']),
                    functionName: 'decimals',
                    args: [quoteAssetId.raw],
                }),
            ]);
            return new Balance(quote, quoteDecimals);
        }))));
    }
    /**
     * Estimates the gas cost needed to bridge the message from one chain to another,
     * that results from a transaction
     * @internal
     */
    _estimate(fromChain, to, messageType) {
        return this._query(['estimate', fromChain, to, messageType], () => this._protocolAddresses(fromChain).pipe(switchMap(({ multiAdapter, gasService }) => {
            const types = Array.isArray(messageType) ? messageType : [messageType];
            return combineLatest([
                'chainId' in to ? this.id(to.chainId) : of(to.centId),
                ...types.map((typeAndMaybeSubtype) => {
                    const type = typeof typeAndMaybeSubtype === 'number' ? typeAndMaybeSubtype : typeAndMaybeSubtype.type;
                    const subtype = typeof typeAndMaybeSubtype === 'number' ? undefined : typeAndMaybeSubtype.subtype;
                    const data = emptyMessage(type, subtype);
                    return this.getClient(fromChain).readContract({
                        address: gasService,
                        abi: ABI.GasService,
                        functionName: 'messageGasLimit',
                        args: [0, data],
                    });
                }),
            ]).pipe(switchMap(async ([toCentId, ...gasLimits]) => {
                const estimate = await this.getClient(fromChain).readContract({
                    address: multiAdapter,
                    abi: ABI.MultiAdapter,
                    functionName: 'estimate',
                    args: [toCentId, '0x0', gasLimits.reduce((acc, val) => acc + val, 0n)],
                });
                return (estimate * 3n) / 2n; // Add 50% buffer to the estimate
            }));
        })));
    }
    /** @internal */
    _maxBatchGasLimit(chainId) {
        return this._query(['maxBatchGasLimit', chainId], () => this._protocolAddresses(chainId).pipe(switchMap(async ({ gasService }) => {
            try {
                // `batchGasLimit` was renamed to `maxBatchGasLimit`, support both for backwards compatibility,
                // until all chains are updated
                return await this.getClient(chainId).readContract({
                    address: gasService,
                    abi: ABI.GasService,
                    functionName: 'maxBatchGasLimit',
                    args: [0],
                });
            }
            catch {
                return await this.getClient(chainId).readContract({
                    address: gasService,
                    abi: ABI.GasService,
                    functionName: 'batchGasLimit',
                    args: [0],
                });
            }
        })));
    }
    /** @internal */
    _idToChain(centrifugeId) {
        return this._query(['idToChain', centrifugeId], () => this._deployments().pipe(map((data) => {
            const item = data.blockchains.items.find((b) => Number(b.centrifugeId) === centrifugeId);
            if (!item)
                throw new Error(`Chain with Centrifuge ID "${centrifugeId}" not found`);
            return Number(item.id);
        })));
    }
    /** @internal */
    _deployments() {
        return this._query(['deployments'], () => this._getIndexerObservable(`{
            blockchains {
              items {
                centrifugeId
                id
              }
            }
            deployments {
              items {
                accounting
                asyncRequestManager
                asyncVaultFactory
                axelarAdapter
                balanceSheet
                centrifugeId
                chainId
                freezeOnlyHook
                fullRestrictionsHook
                gasService
                gateway
                globalEscrow
                guardian
                holdings
                hub
                hubRegistry
                identityValuation
                messageDispatcher
                messageProcessor
                multiAdapter
                poolEscrowFactory
                redemptionRestrictionsHook
                root
                routerEscrow
                shareClassManager
                spoke
                syncDepositVaultFactory
                syncManager
                wormholeAdapter
                vaultRouter
                tokenFactory
                onOfframpManagerFactory
                merkleProofManagerFactory
              }
            }
          }`));
    }
}
//# sourceMappingURL=Centrifuge.js.map