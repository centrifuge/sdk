import { HexString } from '../types/index.js'

export function addressToBytes32(address: string) {
  return address.padEnd(66, '0').toLowerCase() as HexString
}
