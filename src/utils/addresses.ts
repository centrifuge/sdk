import { HexString } from '../types/index.js'
import { CentrifugeId } from './types.js'

/**
 * Convert an address/ID (i.e. centrifugeId) to an EVM address, matching Solidity's `address(uint160(centrifugeId))`.
 */
export function convertToEvmAddress(centrifugeId: CentrifugeId): HexString {
  return `0x${centrifugeId.toString(16).padStart(40, '0')}` as HexString
}
