import type { HexString } from '../types/index.js'

const ACCOUNTING_TOKEN_LIABILITY_BIT = 1n << 255n

/**
 * Mirrors `AccountingToken.toTokenId(poolId, asset, isLiability)`.
 * @internal
 */
export function toAccountingTokenId(poolIdRaw: bigint, assetAddress: HexString, liability: boolean): bigint {
  const baseId = (poolIdRaw << 160n) | BigInt(assetAddress)
  return liability ? baseId | ACCOUNTING_TOKEN_LIABILITY_BIT : baseId
}
