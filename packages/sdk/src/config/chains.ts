import {
  arbitrum,
  arbitrumSepolia,
  arc as arcWithoutDefaultRpc,
  avalanche,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  hyperEvm,
  hyperliquidEvmTestnet as hyperliquidEvmTestnetWithoutMulticall,
  mainnet,
  monad,
  optimism,
  plumeMainnet,
  sepolia,
  xLayer,
} from 'viem/chains'
import { defineChain } from 'viem'

// viem ships Arc with an empty default RPC list, which leaves a client with no
// transport URL. This is a keyless public Arc mainnet endpoint.
export const arc = defineChain({
  ...arcWithoutDefaultRpc,
  rpcUrls: { ...arcWithoutDefaultRpc.rpcUrls, default: { http: ['https://rpc.mainnet.arc.io'] } },
  // Preinstalled at genesis, so there is no deployment block. Without it viem cannot batch reads.
  contracts: { ...arcWithoutDefaultRpc.contracts, multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
})

export const hyperliquidEvmTestnet = defineChain({
  ...hyperliquidEvmTestnetWithoutMulticall,
  contracts: {
    ...hyperliquidEvmTestnetWithoutMulticall.contracts,
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export const pharos = defineChain({
  id: 1672,
  name: 'Pharos Mainnet',
  nativeCurrency: {
    name: 'PharosCoin',
    symbol: 'PROS',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.pharos.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Pharos Explorer',
      url: 'https://pharosscan.xyz',
    },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

// TODO: convert to use the indexer to avoid hard coding
export const chains = [
  arbitrum,
  arbitrumSepolia,
  arc,
  avalanche,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  hyperEvm,
  hyperliquidEvmTestnet,
  mainnet,
  monad,
  optimism,
  pharos,
  plumeMainnet,
  sepolia,
  xLayer,
]
