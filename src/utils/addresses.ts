import { getAddress, isAddress } from 'viem'
import { HexString } from '../types/index.js'
import { CentrifugeId } from './types.js'

/**
 * Convert an ID (i.e. centrifugeId) to an EVM address, matching Solidity's `address(uint160(centrifugeId))`.
 */
export function convertToEvmAddress(id: CentrifugeId | number): HexString {
  return `0x${id.toString(16).padStart(40, '0')}` as HexString
}

/**
 * Returns the checksummed address, throwing if `input` is not a valid EVM address.
 * Use at trust boundaries — anything entering the SDK from the indexer, user input,
 * or another untrusted source should pass through here before being used to build a tx.
 */
export function validateAddress(input: string, label = 'address'): HexString {
  if (!isAddress(input, { strict: false })) {
    throw new Error(`Invalid ${label}: ${input}`)
  }
  return getAddress(input) as HexString
}

export function addressesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
