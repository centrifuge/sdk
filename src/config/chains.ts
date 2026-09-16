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
  hyperliquidEvmTestnet,
  mainnet,
  monad,
  optimism,
  plumeMainnet,
  sepolia,
  xLayer,
} from 'viem/chains'
import { defineChain } from 'viem'

// viem ships Arc with no default public RPC (`rpcUrls.default.http: []`). This is
// Circle's own mainnet endpoint — first-party, keyless — so it can be bundled the
// same way `pharos` bundles its own default below.
export const arc = {
  ...arcWithoutDefaultRpc,
  rpcUrls: { ...arcWithoutDefaultRpc.rpcUrls, default: { http: ['https://rpc.mainnet.arc.io'] } },
}

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
