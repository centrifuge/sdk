import {
  arbitrum,
  arbitrumSepolia,
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
  plumeMainnet,
  sepolia,
} from 'viem/chains'
import { defineChain } from 'viem'

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
})

// TODO: convert to use the indexer to avoid hard coding
export const chains = [
  arbitrum,
  arbitrumSepolia,
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
]
