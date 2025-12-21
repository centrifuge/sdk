import { HexString } from '../types/index.js';
import { Balance } from '../utils/BigInt.js';
import { AssetId } from '../utils/types.js';
import { Entity } from './Entity.js';
import { PoolNetwork } from './PoolNetwork.js';
import { ShareClass } from './ShareClass.js';
export declare class OnOffRampManager extends Entity {
    network: PoolNetwork;
    shareClass: ShareClass;
    onrampAddress: HexString;
    /**
     * Get the receivers of an OnOffRampManager
     */
    receivers(): import("../index.js").Query<{
        assetAddress: `0x${string}`;
        receiverAddress: `0x${string}`;
        assetId: AssetId;
    }[]>;
    relayers(): import("../index.js").Query<{
        address: HexString;
        isEnabled: boolean;
    }[]>;
    assets(): import("../index.js").Query<{
        assetAddress: `0x${string}`;
        assetId: AssetId;
    }[]>;
    balances(): import("../index.js").Query<{
        balance: Balance;
        currency: import("../types/index.js").CurrencyDetails;
    }[]>;
    /**
     * Set a receiver address for a given asset.
     * @param assetId - The asset ID to set the receiver for
     * @param receiver - The receiver address to set
     */
    setReceiver(assetId: AssetId, receiver: HexString, enabled?: boolean): import("../index.js").Transaction;
    /**
     * Set a relayer.
     * @param relayer - The relayer address to set
     * @param enabled - Whether the relayer is enabled
     */
    setRelayer(relayer: HexString, enabled?: boolean): import("../index.js").Transaction;
    setAsset(assetId: AssetId): import("../index.js").Transaction;
    deposit(assetAddress: HexString, amount: Balance, receiverAddress: HexString): import("../index.js").Transaction;
    withdraw(assetAddress: HexString, amount: Balance, receiverAddress: HexString): import("../index.js").Transaction;
}
//# sourceMappingURL=OnOffRampManager.d.ts.map