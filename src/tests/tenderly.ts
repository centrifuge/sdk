import dotenv from 'dotenv'
import {
  createPublicClient,
  createWalletClient,
  http,
  rpcSchema,
  toHex,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
dotenv.config({ path: './src/tests/.env' })

type TenderlyVirtualNetwork = {
  id: string
  slug: string
  display_name: string
  status: string
  fork_config: {
    network_id: number
    block_number: string
  }
  virtual_network_config: {
    chain_config: {
      chain_id: number
    }
    accounts: {
      address: string
    }[]
  }
  rpcs: {
    url: string
    name: string
  }[]
}

type TenderlyError = {
  error: {
    id: string
    slug: string
    message: string
  }
}

type TokenAddress = string
type ReceivingAddress = string
type Amount = `0x${string}`
type CustomRpcSchema = [
  {
    Method: 'tenderly_setErc20Balance'
    Parameters: [TokenAddress, ReceivingAddress, Amount]
    ReturnType: string
  },
  {
    Method: 'tenderly_setBalance'
    Parameters: [ReceivingAddress, Amount]
    ReturnType: string
  },
]

const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

const TENDERLY_API_URL = 'https://api.tenderly.co/api/v1'
const TENDERLY_VNET_URL = 'https://virtual.sepolia.rpc.tenderly.co'
const PROJECT_SLUG = process.env.PROJECT_SLUG
const ACCOUNT_SLUG = process.env.ACCOUNT_SLUG
const TENDERLY_ACCESS_KEY = process.env.TENDERLY_ACCESS_KEY as string

export class TenderlyFork {
  chain: Chain
  vnetId?: string
  _rpcUrl?: string
  forkedNetwork?: TenderlyVirtualNetwork
  get rpcUrl(): string {
    if (!this._rpcUrl) {
      throw new Error('RPC URL is not initialized. Ensure forkNetwork() or TenderlyFork.create() has been called.')
    }
    return this._rpcUrl
  }
  private _publicClient?: PublicClient<Transport, Chain, Account, CustomRpcSchema>
  get publicClient(): PublicClient<Transport, Chain, Account, CustomRpcSchema> {
    return this._publicClient ?? this.setPublicClient()
  }
  private _signer?: WalletClient
  get signer(): WalletClient {
    return this._signer ?? this.setSigner()
  }
  /**
   * if no account is set, one will be created randomly
   * alternatively, this.account can set be set with `createAccount(privateKey)`
   */
  private _account?: Account
  get account(): Account {
    return this._account ?? this.createAccount()
  }

  constructor(chain: Chain, vnetId?: string, rpcUrl?: string) {
    this.chain = chain
    this.vnetId = vnetId
    this._rpcUrl = rpcUrl
  }

  public static async create(chain: Chain, vnetId?: string): Promise<TenderlyFork> {
    let rpcUrl: string
    if (vnetId) {
      rpcUrl = `${TENDERLY_VNET_URL}/${vnetId}`
      return new TenderlyFork(chain, vnetId, rpcUrl)
    } else {
      const instance = new TenderlyFork(chain)
      const { vnetId, url } = await instance.forkNetwork()
      return new TenderlyFork(chain, vnetId, url)
    }
  }

  private setPublicClient<T extends CustomRpcSchema>(): PublicClient<Transport, Chain, Account, CustomRpcSchema> {
    this._publicClient =
      this._publicClient ??
      createPublicClient({
        chain: this.chain,
        transport: http(this.rpcUrl),
        rpcSchema: rpcSchema<T>(),
      })
    return this._publicClient!
  }

  private setSigner(): WalletClient {
    const walletAccount = this.account
    this._signer =
      this._signer ??
      createWalletClient({
        account: walletAccount,
        transport: http(this.rpcUrl),
        chain: this.chain,
      })
    return this._signer!
  }

  createAccount(privateKey?: Hex) {
    const key = privateKey ?? generatePrivateKey()
    const walletAccount = privateKeyToAccount(key)
    this._account = walletAccount
    return walletAccount
  }

  async forkNetwork() {
    try {
      const tenderlyApi = `${TENDERLY_API_URL}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets`
      const timestamp = Date.now()
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
            block_number: '6924285',
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
      })

      const virtualNetwork: TenderlyVirtualNetwork | TenderlyError = await response.json()
      if ('error' in virtualNetwork) {
        throw new Error(JSON.stringify(virtualNetwork.error))
      }
      const forkedRpc = virtualNetwork.rpcs.find((rpc) => rpc.name === 'Admin RPC')
      if (!forkedRpc?.url) {
        throw new Error('Failed to find forked RPC URL')
      }
      console.log('Created Tenderly RPC endpoint', virtualNetwork.id)
      this.forkedNetwork = virtualNetwork
      this.vnetId = virtualNetwork.id
      this._rpcUrl = forkedRpc.url
      return { url: forkedRpc.url, vnetId: virtualNetwork.id }
    } catch (error) {
      throw error
    }
  }

  async deleteTenderlyRpcEndpoint() {
    try {
      const tenderlyApi = `${TENDERLY_API_URL}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets/${this.vnetId}`
      const response = await fetch(tenderlyApi, {
        method: 'DELETE',
        headers: {
          'X-Access-Key': TENDERLY_ACCESS_KEY as string,
        },
      })
      if (response.status !== 204) {
        console.error('Failed to delete Tenderly RPC endpoint', this.vnetId)
        throw new Error(JSON.stringify(await response.json()))
      }
      console.log('Deleted Tenderly RPC endpoint', this.vnetId)
      return response.status === 204
    } catch (error) {
      console.error('Failed to delete Tenderly RPC endpoint', this.vnetId)
      throw error
    }
  }

  async fundAccountEth(address: string, amount: bigint) {
    try {
      const ethResult = await this.publicClient.request({
        jsonrpc: '2.0',
        method: 'tenderly_setBalance',
        params: [address, toHex(amount)],
        id: '1234',
      })

      return ethResult
    } catch (error) {
      throw error
    }
  }

  async fundAccountERC20(address: string, amount: bigint) {
    try {
      const erc20Result = await this.publicClient.request({
        jsonrpc: '2.0',
        method: 'tenderly_setErc20Balance',
        params: [tUSD, address, toHex(amount)],
        id: '1234',
      })

      return erc20Result
    } catch (error) {
      throw error
    }
  }
}
