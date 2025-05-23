export default [
  'error AssetAlreadyRegistered()',
  'error AssetNotFound()',
  'error EmptyAccount()',
  'error EmptyCurrency()',
  'error EmptyShareClassManager()',
  'error NonExistingPool(uint64 id)',
  'error NotAuthorized()',
  'error PoolAlreadyRegistered()',
  'error Uint128_Overflow()',
  'event Deny(address indexed user)',
  'event NewAsset(uint128 indexed assetId, uint8 decimals)',
  'event NewPool(uint64 poolId, address indexed manager, uint128 indexed currency)',
  'event Rely(address indexed user)',
  'event SetMetadata(uint64 indexed poolId, bytes metadata)',
  'event UpdateCurrency(uint64 indexed poolId, uint128 currency)',
  'event UpdateDependency(bytes32 indexed what, address dependency)',
  'event UpdateManager(uint64 indexed poolId, address indexed manager, bool canManage)',
  'function currency(uint64) view returns (uint128)',
  'function decimals(uint128 assetId) view returns (uint8 decimals_)',
  'function decimals(uint256 asset_) view returns (uint8 decimals_)',
  'function decimals(uint64 poolId_) view returns (uint8 decimals_)',
  'function deny(address user)',
  'function dependency(bytes32) view returns (address)',
  'function exists(uint64 poolId_) view returns (bool)',
  'function isRegistered(uint128 assetId) view returns (bool)',
  'function manager(uint64, address) view returns (bool)',
  'function metadata(uint64) view returns (bytes)',
  'function poolId(uint16 centrifugeId, uint48 postfix) pure returns (uint64 poolId_)',
  'function registerAsset(uint128 assetId, uint8 decimals_)',
  'function registerPool(uint64 poolId_, address manager_, uint128 currency_)',
  'function rely(address user)',
  'function setMetadata(uint64 poolId_, bytes metadata_)',
  'function updateCurrency(uint64 poolId_, uint128 currency_)',
  'function updateDependency(bytes32 what, address dependency_)',
  'function updateManager(uint64 poolId_, address manager_, bool canManage)',
  'function wards(address) view returns (uint256)',
] as const
