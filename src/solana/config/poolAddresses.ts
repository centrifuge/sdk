/**
 * Internal mapping of ShareClass IDs to Solana pool addresses
 *
 * IMPORTANT: These addresses should match the deployed Solana accounts
 * that are authorized to receive USDC investments for each pool/share class
 */

import type { SolanaEnvironment } from '../types/config.js'

export interface SolanaPoolConfig {
  address: string // The Solana address that receives USDC for this pool
  environment: SolanaEnvironment
  poolName: string
  poolId: number
}

// Pool address mappings by ShareClass ID
const POOL_ADDRESS_MAPPING: Record<string, SolanaPoolConfig> = {
  // Mainnet pools
  // '0x00010000000000060000000000000001': {
  //   address: '',
  //   environment: 'mainnet',
  //   poolName: 'AAA_CLO',
  //   poolId: 281474976710662,
  // },
  // Testnet/Devnet pools (using devnet as default for development)
  '0x00010000000000060000000000000001': {
    address: 'BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN',
    environment: 'devnet',
    poolName: 'AAA_CLO',
    poolId: 281474976710662,
  },
}

export const USDC_MINT_ADDRESSES: Record<SolanaEnvironment, string> = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  testnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const

/**
 * Get the Solana pool address for a given ShareClass ID
 * @param shareClassId - The ShareClass ID (hex string)
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns The Solana pool configuration or undefined if not found
 * @internal
 */
export function getSolanaPoolAddress(
  shareClassId: string,
  environment: SolanaEnvironment
): SolanaPoolConfig | undefined {
  const config = POOL_ADDRESS_MAPPING[shareClassId.toLowerCase()]

  if (!config || config.environment !== environment) {
    return undefined
  }

  return config
}

/**
 * Get the USDC mint address for a given environment
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns The USDC mint address
 * @internal
 */
export function getUsdcMintAddress(environment: SolanaEnvironment): string {
  return USDC_MINT_ADDRESSES[environment]
}

/**
 * Check if a ShareClass ID has a Solana pool address configured
 * @param shareClassId - The ShareClass ID
 * @param environment - The Solana environment - mainnet, testnet, or devnet
 * @returns True if the pool is configured for Solana investments
 * @internal
 */
export function hasSolanaPoolAddress(shareClassId: string, environment: SolanaEnvironment): boolean {
  return getSolanaPoolAddress(shareClassId, environment) !== undefined
}
