import { HexString } from '../types/index.js'
import { CentrifugeId } from './types.js'

/**
 * Convert an ID (i.e. centrifugeId) to an EVM address, matching Solidity's `address(uint160(centrifugeId))`.
 */
export function convertToEvmAddress(id: CentrifugeId | number): HexString {
  return `0x${id.toString(16).padStart(40, '0')}` as HexString
}
