import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains'
import type { HexString } from '../types/index.js'

export const currencies: Record<number, HexString[]> = {
  [sepolia.id]: ['0x6ACfDbE81eC4B216fFE20cD6A625B70B191A2aca'],
  [baseSepolia.id]: ['0x39F562Ff7da2863B0075dDF10c0fC0524C28ac92'],
  [arbitrumSepolia.id]: ['0x19cc063f962B2769012cA32B2A9027b5c76dCFf3'],
}
