import { concatHex, padHex, toHex } from 'viem'
import { HexString } from '../types/index.js'

export function addressToBytes32(address: HexString) {
  return address.padEnd(66, '0').toLowerCase() as HexString
}

export function encode(values: unknown[]): HexString {
  return concatHex(
    values.map((v) =>
      typeof v === 'string' && v.startsWith('0x')
        ? padHex(v as HexString, { dir: 'right', size: 32 })
        : toHex(v as any, { size: 32 })
    )
  )
}

export function randomUint(bitLength: number) {
  if (!Number.isInteger(bitLength) || bitLength <= 0 || bitLength % 8 !== 0) {
    throw new Error('bitLength must be a positive integer and divisible by 8')
  }

  const byteLength = bitLength / 8
  const bytes = new Uint8Array(byteLength)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  let result = 0n
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte)
  }

  return result
}

/**
 * Generate a valid salt for addShareClass.
 * The salt must have the poolId encoded in its first 8 bytes.
 * Format: [poolId (8 bytes)][random (24 bytes)] = 32 bytes total
 */
export function generateShareClassSalt(poolId: bigint): HexString {
  const randomPart = randomUint(192)
  const salt = (poolId << 192n) | randomPart

  return toHex(salt, { size: 32 })
}
