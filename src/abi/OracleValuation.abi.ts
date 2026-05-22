export default [
  'function feeder(uint64 poolId, uint16 centrifugeId, bytes32 feeder_) view returns (bool)',
  'function updateFeeder(uint64 poolId, uint16 centrifugeId, bytes32 feeder_, bool canFeed)',
  'error NotFeeder()',
  'error NotHubManager()',
] as const
