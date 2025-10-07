import { HexString } from '../types/index.js'
import { randomBytes } from 'crypto'

export function randomAddress(): HexString {
  return `0x${randomBytes(20).toString('hex')}` as HexString
}
