import type { HexString } from '../types/index.js';
import { Balance, Price } from '../utils/BigInt.js';
import { AssetId } from '../utils/types.js';
import { Entity } from './Entity.js';
import type { Pool } from './Pool.js';
import { PoolNetwork } from './PoolNetwork.js';
import { ShareClass } from './ShareClass.js';
/**
 * Query and interact with the balanceSheet, which is the main entry point for withdrawing and depositing funds.
 * A BalanceSheet exists for every ShareClass on any network that Vaults are deployed on.
 */
export declare class BalanceSheet extends Entity {
    network: PoolNetwork;
    shareClass: ShareClass;
    pool: Pool;
    chainId: number;
    balances(): import("../index.js").Query<{
        assetId: AssetId;
        amount: Balance;
        value: Balance;
        price: Price;
        asset: {
            decimals: number;
            address: `0x${string}`;
            tokenId: bigint;
            name: string;
            symbol: string;
            chainId: number;
        };
        holding: {
            valuation: `0x${string}`;
            amount: Balance;
            value: Balance;
            isLiability: boolean;
            accounts: {
                0: number | null;
                1: number | null;
                2: number | null;
                3: number | null;
                4: number | null;
                5: number | null;
            };
        } | null | undefined;
    }[]>;
    deposit(assetId: AssetId, amount: Balance): import("../index.js").Transaction;
    withdraw(assetId: AssetId, to: HexString, amount: Balance): import("../index.js").Transaction;
    /**
     * Issue directly into the balance sheet.
     * @param to - The address that should receive the shares.
     * @param amount - The amount to receive.
     * @param pricePerShare - The price of the shares to issue.
     */
    issue(to: HexString, amount: Balance, pricePerShare: Price): import("../index.js").Transaction;
    /**
     * Revokes shares from a specific user in the balance sheet.
     * * Calculates the number of shares to revoke.
     * @param user - The address of the user from whom shares will be revoked.
     * @param amount - The monetary value (currency amount) to revoke.
     * @param pricePerShare - The price per share used to calculate the number of shares to revoke.
     */
    revoke(user: HexString, amount: Balance, pricePerShare: Price): import("../index.js").Transaction;
}
//# sourceMappingURL=BalanceSheet.d.ts.map