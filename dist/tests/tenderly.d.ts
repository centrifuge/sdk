import { type Account, type Chain, type Hex, type LocalAccount, type PublicClient, type Transport, type WalletClient } from 'viem';
type TenderlyVirtualNetwork = {
    id: string;
    slug: string;
    display_name: string;
    status: string;
    fork_config: {
        network_id: number;
        block_number: string;
    };
    virtual_network_config: {
        chain_config: {
            chain_id: number;
        };
        accounts: {
            address: string;
        }[];
    };
    rpcs: {
        url: string;
        name: string;
    }[];
};
type TokenAddress = string;
type ReceivingAddress = string;
type Amount = `0x${string}`;
type CustomRpcSchema = [
    {
        Method: 'tenderly_setErc20Balance';
        Parameters: [TokenAddress, ReceivingAddress, Amount];
        ReturnType: string;
    },
    {
        Method: 'anvil_dealERC20';
        Parameters: [TokenAddress, ReceivingAddress, Amount];
        ReturnType: string;
    },
    {
        Method: 'tenderly_setBalance';
        Parameters: [ReceivingAddress, Amount];
        ReturnType: string;
    },
    {
        Method: 'anvil_setBalance';
        Parameters: [ReceivingAddress, Amount];
        ReturnType: string;
    }
];
export declare class TenderlyFork {
    chain: Chain;
    vnetId?: string;
    _rpcUrl?: string;
    /**
     * after impersonateAddress is set, centrifuge.setSigner() must be called again to update the signer
     */
    private _impersonateAddress?;
    get impersonateAddress(): `0x${string}` | undefined;
    set impersonateAddress(address: `0x${string}` | undefined);
    forkedNetwork?: TenderlyVirtualNetwork;
    get rpcUrl(): string;
    private _publicClient?;
    get publicClient(): PublicClient<Transport, Chain, Account, CustomRpcSchema>;
    private _signer?;
    get signer(): WalletClient;
    /**
     * if no account is set, one will be created randomly
     * if an impersonated address is set, a custom account will be created with that address which will override the fromAddress parameter in calls
     */
    private _account?;
    get account(): LocalAccount;
    constructor(chain: Chain, vnetId?: string, rpcUrl?: string);
    static create(chain: Chain, vnetId?: string): Promise<TenderlyFork>;
    private setPublicClient;
    private setSigner;
    createAccount(privateKey?: Hex): LocalAccount;
    createCustomAccount(address: `0x${string}`): LocalAccount;
    forkNetwork(): Promise<{
        url: any;
        vnetId?: undefined;
    } | {
        url: string;
        vnetId: string;
    }>;
    deleteTenderlyRpcEndpoint(): Promise<boolean>;
    fundAccountEth(address: string, amount: bigint): Promise<void>;
    fundAccountERC20(address: string, amount: bigint): Promise<void>;
}
export {};
//# sourceMappingURL=tenderly.d.ts.map