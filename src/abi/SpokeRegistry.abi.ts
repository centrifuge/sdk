/**
 * Asset lookups of the v3.3 `SpokeRegistry`, which took them over from `Spoke`. Unlike the
 * `Spoke` lookups of v3.1/v3.2, these return zero for an unknown asset instead of reverting.
 * `Spoke.spokeRegistry()` locates it.
 */
export default [
  'function assetToId(address asset, uint256 tokenId) view returns (uint128 assetId)',
  'function idToAsset(uint128 assetId) view returns (address asset, uint256 tokenId)',
] as const
