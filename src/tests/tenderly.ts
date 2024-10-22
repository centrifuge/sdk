import dotenv from 'dotenv'
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

const TENDERLY_API = 'https://api.tenderly.co/api/v1'
const PROJECT_SLUG = process.env.PROJECT_SLUG
const ACCOUNT_SLUG = process.env.ACCOUNT_SLUG
const TENDERLY_ACCESS_KEY = process.env.TENDERLY_ACCESS_KEY as string

export class TenderlyFork {
  #chainId: number
  vnetId?: string
  rpcUrl?: string
  constructor(chainId: number) {
    this.#chainId = chainId
  }

  forkTenderlyNetwork = async () => {
    try {
      const tenderlyApi = `${TENDERLY_API}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets`

      const response = await fetch(tenderlyApi, {
        method: 'POST',
        headers: {
          'X-Access-Key': TENDERLY_ACCESS_KEY,
        },
        body: JSON.stringify({
          slug: 'centrifuge-sepolia-fork',
          display_name: 'Centrifuge Sepolia Fork',
          fork_config: {
            network_id: this.#chainId,
            block_number: '6924285',
          },
          virtual_network_config: {
            chain_config: {
              chain_id: this.#chainId,
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
      this.vnetId = virtualNetwork.id
      return { forkedRpcUrl }
    } catch (error) {
      throw error
    }
  }

  deleteTenderlyRpcEndpoint = async () => {
    try {
      const tenderlyApi = `${TENDERLY_API}/account/${ACCOUNT_SLUG}/project/${PROJECT_SLUG}/vnets/${this.vnetId}`
      const response = await fetch(tenderlyApi, {
        method: 'DELETE',
        headers: {
          'X-Access-Key': TENDERLY_ACCESS_KEY as string,
        },
      })
      return response.status === 204
    } catch (error) {
      throw error
    }
  }
}
