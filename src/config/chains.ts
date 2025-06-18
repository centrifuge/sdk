import { arbitrum, arbitrumSepolia, base, baseSepolia, celo, mainnet, sepolia } from 'viem/chains'

export const chains = [mainnet, sepolia, base, baseSepolia, arbitrum, arbitrumSepolia, celo]

export const chainIdToNetwork = {
  [mainnet.id]: 'mainnet',
  [sepolia.id]: 'sepolia',
  [base.id]: 'base',
  [baseSepolia.id]: 'base-sepolia',
  [arbitrum.id]: 'arbitrum',
  [arbitrumSepolia.id]: 'arbitrum-sepolia',
  [celo.id]: 'celo',
}
