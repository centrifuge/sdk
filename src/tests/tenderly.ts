import dotenv from 'dotenv'
import {
  createPublicClient,
  createWalletClient,
  http,
  rpcSchema,
  testActions,
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
import { mainnet, sepolia } from 'viem/chains'
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

const TENDERLY_API = 'https://api.tenderly.co/api/v1'
const PROJECT_SLUG = process.env.PROJECT_SLUG
const ACCOUNT_SLUG = process.env.ACCOUNT_SLUG
const TENDERLY_ACCESS_KEY = process.env.TENDERLY_ACCESS_KEY as string

export class TenderlyFork {
  chainId: number
  vnetId?: string
  private _publicClient?: PublicClient<Transport, Chain, Account, CustomRpcSchema>
  get publicClient(): PublicClient<Transport, Chain, Account, CustomRpcSchema> {
    if (!this._publicClient) {
      this.setPublicClient()
    }
    return this._publicClient!
  }
  private _signer?: WalletClient
  get signer(): WalletClient {
    if (!this._signer) {
      this.setSigner()
    }
    return this._signer!
  }
  /**
   * @returns the account, if no account is set, it will create one
   * alternatively, this.acount can set be set with `createAccount` and can receive a private key
   */
  private _account?: Account
  get account(): Account {
    if (!this._account) {
      this.createAccount()
    }
    return this._account!
  }

  constructor(chainId: number, vnetId?: string) {
    this.chainId = chainId
    this.vnetId = vnetId
  }

  private setPublicClient<T extends CustomRpcSchema>() {
    const { url, chain } = this.getForkedChains(this.chainId)
    this._publicClient =
      this._publicClient ??
      createPublicClient({
        chain,
        transport: http(url),
        rpcSchema: rpcSchema<T>(),
      })
  }

  private setSigner(walletAccount?: Account): void {
    const { url, chain } = this.getForkedChains(this.chainId)
    this._signer =
      this._signer ??
      createWalletClient({
        account: walletAccount,
        transport: http(url),
        chain,
      })
  }

  createAccount(privateKey?: Hex) {
    const key = privateKey ?? generatePrivateKey()
    const walletAccount = privateKeyToAccount(key)
    this._account = walletAccount
    return walletAccount
  }

  getForkedChains(chainId: number): { url: string; chain: Chain } {
    if (!this.vnetId) {
      throw new Error('Tenderly RPC endpoint not found')
    }
    const forks = {
      11155111: { url: `https://virtual.sepolia.rpc.tenderly.co/${this.vnetId}`, chain: sepolia },
      1: { url: `https://virtual.mainnet.rpc.tenderly.co/${this.vnetId}`, chain: mainnet },
    }
    return forks[chainId as keyof typeof forks]
  }

  async forkNetwork() {
    try {
      const tenderlyApi = `${TENDERLY_API}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets`
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
            network_id: this.chainId,
            block_number: '6924285',
          },
          virtual_network_config: {
            chain_config: {
              chain_id: this.chainId,
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
      const forkedRpcUrl = virtualNetwork.rpcs.find((rpc) => rpc.name === 'Public RPC')?.url
      if (!forkedRpcUrl) {
        throw new Error('Failed to find forked RPC URL')
      }
      console.log('Created Tenderly RPC endpoint', virtualNetwork.id)
      this.vnetId = virtualNetwork.id
      return { url: forkedRpcUrl }
    } catch (error) {
      throw error
    }
  }

  async deleteTenderlyRpcEndpoint() {
    try {
      const tenderlyApi = `${TENDERLY_API}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets/${this.vnetId}`
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
    const ethResult = await this.publicClient.request({
      jsonrpc: '2.0',
      method: 'tenderly_setBalance',
      params: [address, toHex(amount)],
      id: '1234',
    })

    return ethResult
  }

  async fundAccountERC20(address: string, amount: bigint) {
    const erc20Result = await this.publicClient.request({
      jsonrpc: '2.0',
      method: 'tenderly_setErc20Balance',
      params: [tUSD, address, toHex(amount)],
      id: '1234',
    })

    return erc20Result
  }
}
