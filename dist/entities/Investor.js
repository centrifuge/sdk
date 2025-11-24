import { combineLatest, map, of, switchMap } from 'rxjs';
import { Entity } from './Entity.js';
import { Balance } from '../utils/BigInt.js';
export class Investor extends Entity {
    address;
    /** @internal */
    constructor(_root, address) {
        const addr = address.toLowerCase();
        super(_root, ['investor', addr]);
        this.address = addr;
    }
    /**
     * Retrieve the portfolio of an investor.
     * @param chainId - The chain ID
     */
    portfolio(chainId) {
        return this._query(['portfolio', chainId], () => this._root
            ._queryIndexer(`{
            vaults {
              items {
                assetAddress
                blockchain {
                  id
                }
              }
            }
            tokenInstances {
              items {
                address
                blockchain {
                  id
                }
              }
            }
          }`)
            .pipe(switchMap(({ vaults, tokenInstances }) => {
            const seenTuples = new Set();
            function check(chainId, asset) {
                const key = `${chainId}|${asset}`;
                if (seenTuples.has(key)) {
                    return true;
                }
                seenTuples.add(key);
                return false;
            }
            const all = [
                ...vaults.items
                    .map((item) => ({ ...item, address: item.assetAddress }))
                    // Exclude duplicate chainId/asset combinations
                    .filter((item) => !check(item.blockchain.id, item.assetAddress)),
                ...tokenInstances.items,
            ].filter((item) => !chainId || Number(item.blockchain.id) === chainId);
            if (all.length === 0)
                return of([]);
            return combineLatest(all.map((item) => this._root.balance(item.address, this.address, Number(item.blockchain.id))));
        }), map((balances) => balances.filter((b) => b.balance.gt(0n)))));
    }
    /**
     * Retrieve the investment of an investor.
     * @param poolId - The pool ID
     * @param scId - The share class ID
     * @param asset - The asset ID
     * @param chainId - The chain ID
     */
    investment(poolId, scId, asset, chainId) {
        return this._query(['investment', poolId.toString(), scId.toString(), asset.toString().toLowerCase(), chainId], () => this._root.pool(poolId).pipe(switchMap((pool) => pool.vault(chainId, scId, asset)), switchMap((vault) => vault.investment(this.address))));
    }
    /**
     * Retrieve if an account is a member of a share class.
     */
    isMember(scId, chainId) {
        return this._query(['isMember', scId.toString(), chainId], () => this._root.pool(scId.poolId).pipe(switchMap((pool) => pool.shareClass(scId)), switchMap((shareClass) => shareClass.member(this.address, chainId)), map(({ isMember }) => isMember)));
    }
    /**
     * Retrieve the transactions of an investor.
     * @param poolId - The pool ID
     * @param page
     * @param pageSize
     */
    transactions(poolId, page = 1, pageSize = 10) {
        const offset = (page - 1) * pageSize;
        return this._query(['transactions', poolId.toString(), page, pageSize], () => combineLatest([
            this._root._deployments(),
            this._root.pool(poolId).pipe(switchMap((pool) => pool.currency())),
            this._root._queryIndexer(`query ($address: String!, $poolId: BigInt!, $limit: Int!, $offset: Int!) {
          investorTransactions(
            where: { 
              account: $address,
              poolId: $poolId
            } 
            limit: $limit
            offset: $offset
          ) {
            items {
              account
              createdAt
              type
              txHash
              currencyAmount
              token { name symbol decimals }
              tokenAmount
              centrifugeId
              poolId
            }
            totalCount
          }
        }`, {
                address: this.address.toLowerCase(),
                poolId: poolId.toString(),
                limit: pageSize,
                offset: offset,
            }),
        ]).pipe(map(([deployments, currency, { investorTransactions }]) => {
            const chainsById = new Map(deployments.blockchains.items.map((chain) => [chain.centrifugeId, chain.id]));
            return {
                transactions: investorTransactions.items
                    .filter((item) => item.poolId === poolId.toString())
                    .map((item) => {
                    const chainId = chainsById.get(item.centrifugeId);
                    return {
                        type: item.type,
                        txHash: item.txHash,
                        createdAt: item.createdAt,
                        token: item.token.name,
                        tokenSymbol: item.token.symbol,
                        tokenAmount: new Balance(item.tokenAmount, Number(item.token.decimals)),
                        currencyAmount: new Balance(item.currencyAmount, currency.decimals),
                        chainId: Number(chainId),
                        poolId: item.poolId,
                    };
                }),
                totalCount: investorTransactions.totalCount || investorTransactions.items.length,
                page,
                pageSize,
            };
        })));
    }
    allTransactions(poolId) {
        return this.transactions(poolId, 1, 1000);
    }
}
//# sourceMappingURL=Investor.js.map