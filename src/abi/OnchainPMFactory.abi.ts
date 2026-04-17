export default [
  'function newOnchainPM(uint64 poolId) returns (address)',
  'function getAddress(uint64 poolId) view returns (address)',
  'event DeployOnchainPM(uint64 indexed poolId, address indexed manager)',
] as const
