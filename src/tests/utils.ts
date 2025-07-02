import { HexString } from '../types/index.js'

export function randomAddress(): HexString {
  return `0x${Math.random().toString(16).slice(2).padStart(40, '0')}`
}
