export default [
  'function feeder(uint64 poolId, uint16 centrifugeId, bytes32 feeder_) view returns (bool)',
  'function updateFeeder(uint64 poolId, uint16 centrifugeId, bytes32 feeder_, bool canFeed)',
  'function pricePoolPerAsset(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint128 value, bool isValid)',
  'event UpdatePrice(uint64 indexed poolId, bytes16 indexed scId, uint128 indexed assetId, uint128 newPrice)',
  'error NotFeeder()',
  'error NotHubManager()',
] as const
