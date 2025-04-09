import { arbitrum, base, baseSepolia, celo, mainnet, sepolia } from 'viem/chains'

export const chains = [mainnet, sepolia, base, baseSepolia, arbitrum, celo]

export const chainIdToNetwork = {
  [mainnet.id]: 'mainnet',
  [sepolia.id]: 'sepolia',
  [base.id]: 'base',
  [baseSepolia.id]: 'baseSepolia',
  [arbitrum.id]: 'arbitrum',
  [celo.id]: 'celo',
}
