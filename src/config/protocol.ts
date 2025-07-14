import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains'
import type { HexString } from '../types/index.js'

export const currencies: Record<number, HexString[]> = {
  [sepolia.id]: ['0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'],
  [baseSepolia.id]: ['0x5da2060c5418223e7ef7bed788d9d3ea61f68034'],
  [arbitrumSepolia.id]: ['0x19cc063f962B2769012cA32B2A9027b5c76dCFf3'],
}
