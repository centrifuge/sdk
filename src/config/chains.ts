import { arbitrum, base, baseSepolia, celo, mainnet, sepolia } from 'viem/chains'

export const chains = [mainnet, sepolia, base, arbitrum, celo, baseSepolia]

export const chainIdToNetwork = {
  [mainnet.id]: 'mainnet',
  [sepolia.id]: 'sepolia',
  [base.id]: 'base',
  [arbitrum.id]: 'arbitrum',
  [celo.id]: 'celo',
  [baseSepolia.id]: 'baseSepolia',
}
