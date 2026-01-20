export default [
  'function getPrice(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint128)',
  'function getQuote(uint64 poolId, bytes16 scId, uint128 assetId, uint128 baseAmount) view returns (uint128 quoteAmount)',
] as const
