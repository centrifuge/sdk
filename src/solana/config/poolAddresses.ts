/**
 * Internal mapping of ShareClass IDs to Solana pool addresses
 *
 * IMPORTANT: These addresses should match the deployed Solana accounts
 * that are authorized to receive USDC investments for each pool/share class
 */

export interface SolanaPoolConfig {
  address: string // The Solana address that receives USDC for this pool
  environment: 'mainnet' | 'testnet'
  poolName?: string
}

// Pool address mappings by ShareClass ID
const POOL_ADDRESS_MAPPING: Record<string, SolanaPoolConfig> = {
  // Mainnet pools
  // '0x00010000000000060000000000000001': {
  //   address: '',
  //   environment: 'mainnet',
  //   poolName: 'AAA_CLO',
  // },
  // Testnet pools
  '0x00010000000000060000000000000001': {
    address: 'BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN',
    environment: 'testnet',
    poolName: 'AAA_CLO',
  },
}

export const USDC_MINT_ADDRESSES = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  testnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC on Devnet
} as const

/**
 * Get the Solana pool address for a given ShareClass ID
 * @param shareClassId - The ShareClass ID (hex string)
 * @param environment - The environment - mainnet or testnet
 * @returns The Solana pool configuration or undefined if not found
 * @internal
 */
export function getSolanaPoolAddress(
  shareClassId: string,
  environment: 'mainnet' | 'testnet'
): SolanaPoolConfig | undefined {
  const config = POOL_ADDRESS_MAPPING[shareClassId.toLowerCase()]

  if (!config || config.environment !== environment) {
    return undefined
  }

  return config
}

/**
 * Get the USDC mint address for a given environment
 * @param environment - The environment - mainnet or testnet
 * @returns The USDC mint address
 * @internal
 */
export function getUsdcMintAddress(environment: 'mainnet' | 'testnet'): string {
  return USDC_MINT_ADDRESSES[environment]
}

/**
 * Check if a ShareClass ID has a Solana pool address configured
 * @param shareClassId - The ShareClass ID
 * @param environment - The environment - mainnet or testnet
 * @returns True if the pool is configured for Solana investments
 * @internal
 */
export function hasSolanaPoolAddress(shareClassId: string, environment: 'mainnet' | 'testnet'): boolean {
  return getSolanaPoolAddress(shareClassId, environment) !== undefined
}
