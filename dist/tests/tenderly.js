import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http, rpcSchema, toHex, } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
dotenv.config({ path: './src/tests/.env' });
const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93';
const TENDERLY_API_URL = 'https://api.tenderly.co/api/v1';
const TENDERLY_VNET_URL = 'https://virtual.sepolia.rpc.tenderly.co';
const PROJECT_SLUG = process.env.PROJECT_SLUG;
const ACCOUNT_SLUG = process.env.ACCOUNT_SLUG;
const TENDERLY_ACCESS_KEY = process.env.TENDERLY_ACCESS_KEY;
const isLocalFork = process.env.LOCAL === 'true';
export class TenderlyFork {
    chain;
    vnetId;
    _rpcUrl;
    /**
     * after impersonateAddress is set, centrifuge.setSigner() must be called again to update the signer
     */
    _impersonateAddress;
    get impersonateAddress() {
        return this._impersonateAddress;
    }
    set impersonateAddress(address) {
        this._impersonateAddress = address;
        this.setSigner();
    }
    forkedNetwork;
    get rpcUrl() {
        if (!this._rpcUrl) {
            throw new Error('RPC URL is not initialized. Ensure forkNetwork() or TenderlyFork.create() has been called.');
        }
        return this._rpcUrl;
    }
    _publicClient;
    get publicClient() {
        return this._publicClient ?? this.setPublicClient();
    }
    _signer;
    get signer() {
        return this._signer ?? this.setSigner();
    }
    /**
     * if no account is set, one will be created randomly
     * if an impersonated address is set, a custom account will be created with that address which will override the fromAddress parameter in calls
     */
    _account;
    get account() {
        if (this.impersonateAddress)
            return this.createCustomAccount(this.impersonateAddress);
        if (this._account)
            return this._account;
        return this.createAccount();
    }
    constructor(chain, vnetId, rpcUrl) {
        this.chain = chain;
        this.vnetId = vnetId;
        this._rpcUrl = rpcUrl;
    }
    static async create(chain, vnetId) {
        let rpcUrl;
        if (vnetId) {
            rpcUrl = `${TENDERLY_VNET_URL}/${vnetId}`;
            return new TenderlyFork(chain, vnetId, rpcUrl);
        }
        const instance = new TenderlyFork(chain);
        await instance.forkNetwork();
        return instance;
    }
    setPublicClient() {
        this._publicClient =
            this._publicClient ??
                createPublicClient({
                    chain: this.chain,
                    transport: http(this.rpcUrl),
                    rpcSchema: rpcSchema(),
                });
        return this._publicClient;
    }
    setSigner() {
        const client = createWalletClient({
            account: this.account,
            transport: http(this.rpcUrl),
            chain: this.chain,
            rpcSchema: rpcSchema(),
        });
        const signer = {
            ...client,
            // Override the request method to use override from address with impersonated account
            request: async (args) => {
                switch (args.method) {
                    case 'eth_accounts':
                        return [this.account.address];
                    case 'eth_sendTransaction':
                        // @ts-expect-error
                        const impersonatedParams = args.params.map((arg) => ({ ...arg, from: this.account.address }));
                        return client.request({ method: args.method, params: impersonatedParams });
                }
                // @ts-expect-error
                return client.request(args);
            },
        };
        this._signer = signer;
        return signer;
    }
    createAccount(privateKey) {
        const key = privateKey ?? generatePrivateKey();
        const walletAccount = privateKeyToAccount(key);
        this._account = walletAccount;
        return walletAccount;
    }
    createCustomAccount(address) {
        return {
            address,
            type: 'local',
            source: 'custom',
            signMessage: async () => '0x',
            signTransaction: async () => '0x',
            signTypedData: async () => '0x',
            publicKey: '0x',
        };
    }
    async forkNetwork() {
        if (isLocalFork) {
            const url = 'http://localhost:8544';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fork network: ${response.statusText}`);
            }
            const { rpcUrl } = await response.json();
            console.log('Forked network locally', rpcUrl);
            this._rpcUrl = rpcUrl;
            return { url: rpcUrl };
        }
        const tenderlyApi = `${TENDERLY_API_URL}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets`;
        const timestamp = Date.now();
        const response = await fetch(tenderlyApi, {
            method: 'POST',
            headers: {
                'X-Access-Key': TENDERLY_ACCESS_KEY,
            },
            body: JSON.stringify({
                slug: `centrifuge-sepolia-fork-${timestamp}`,
                display_name: `Centrifuge Sepolia Fork ${timestamp}`,
                fork_config: {
                    network_id: this.chain.id,
                    // block_number: '8212818',
                },
                virtual_network_config: {
                    chain_config: {
                        chain_id: this.chain.id,
                    },
                },
                sync_state_config: {
                    enabled: false,
                },
                explorer_page_config: {
                    enabled: false,
                    verification_visibility: 'bytecode',
                },
            }),
        });
        const virtualNetwork = await response.json();
        if ('error' in virtualNetwork) {
            throw new Error(JSON.stringify(virtualNetwork.error));
        }
        const forkedRpc = virtualNetwork.rpcs.find((rpc) => rpc.name === 'Admin RPC');
        if (!forkedRpc?.url) {
            throw new Error('Failed to find forked RPC URL');
        }
        console.log('Created Tenderly RPC endpoint', virtualNetwork.id);
        this.forkedNetwork = virtualNetwork;
        this.vnetId = virtualNetwork.id;
        this._rpcUrl = forkedRpc.url;
        return { url: forkedRpc.url, vnetId: virtualNetwork.id };
    }
    async deleteTenderlyRpcEndpoint() {
        try {
            let url = '';
            if (isLocalFork) {
                url = 'http://localhost:8544';
            }
            else {
                url = `${TENDERLY_API_URL}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets/${this.vnetId}`;
            }
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'X-Access-Key': TENDERLY_ACCESS_KEY,
                },
            });
            if (response.status !== 204) {
                console.error('Failed to delete Tenderly RPC endpoint', this.vnetId);
                throw new Error(JSON.stringify(await response.json()));
            }
            console.log('Deleted Tenderly RPC endpoint', this.vnetId);
            return response.status === 204;
        }
        catch (error) {
            console.error('Failed to delete Tenderly RPC endpoint', this.vnetId);
            throw error;
        }
    }
    async fundAccountEth(address, amount) {
        await this.publicClient.request({
            jsonrpc: '2.0',
            method: isLocalFork ? 'anvil_setBalance' : 'tenderly_setBalance',
            params: [address, toHex(amount)],
            id: '1234',
        });
    }
    async fundAccountERC20(address, amount) {
        await this.publicClient.request({
            jsonrpc: '2.0',
            method: isLocalFork ? 'anvil_dealERC20' : 'tenderly_setErc20Balance',
            params: [tUSD, address, toHex(amount)],
            id: '1234',
        });
    }
}
//# sourceMappingURL=tenderly.js.map