export default [
  'function newManager(uint64 poolId, bytes16 scId) returns (address)',
  'event DeployOnOffRamp(uint64 indexed poolId, bytes16 scId, address indexed manager)',
  'event DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address indexed manager)',
] as const
