export default [
  'error NoCode()',
  'error NotAuthorized()',
  'error SafeTransferFailed()',
  'error UnknownMessageType()',
  'event AddPool(uint64 indexed poolId)',
  'event AddTranche(uint64 indexed poolId, bytes16 indexed trancheId, address token)',
  'event Deny(address indexed user)',
  'event DeployVault(uint64 indexed poolId, bytes16 indexed trancheId, address indexed asset, uint256 tokenId, address factory, address vault)',
  'event File(bytes32 indexed what, address data)',
  'event File(bytes32 indexed what, address factory, bool status)',
  'event LinkVault(uint64 indexed poolId, bytes16 indexed trancheId, address indexed asset, uint256 tokenId, address vault)',
  'event PriceUpdate(uint64 indexed poolId, bytes16 indexed trancheId, address indexed asset, uint256 tokenId, uint256 price, uint64 computedAt)',
  'event RegisterAsset(uint128 indexed assetId, address indexed asset, uint256 indexed tokenId, string name, string symbol, uint8 decimals)',
  'event Rely(address indexed user)',
  'event TransferTrancheTokens(uint64 indexed poolId, bytes16 indexed trancheId, address indexed sender, uint64 destinationId, bytes32 destinationAddress, uint128 amount)',
  'event UnlinkVault(uint64 indexed poolId, bytes16 indexed trancheId, address indexed asset, uint256 tokenId, address vault)',
  'event UpdateContract(uint64 indexed poolId, bytes16 indexed trancheId, address target, bytes payload)',
  'function addPool(uint64 poolId)',
  'function addTranche(uint64 poolId, bytes16 trancheId, string name, string symbol, uint8 decimals, bytes32 salt, address hook) returns (address)',
  'function assetToId(address asset, uint256 tokenId) view returns (uint128 assetId)',
  'function deny(address user)',
  'function deployVault(uint64 poolId, bytes16 trancheId, uint128 assetId, address factory) returns (address)',
  'function escrow() view returns (address)',
  'function file(bytes32 what, address factory, bool status)',
  'function file(bytes32 what, address data)',
  'function handleTransferTrancheTokens(uint64 poolId, bytes16 trancheId, address destinationAddress, uint128 amount)',
  'function idToAsset(uint128 assetId) view returns (address asset, uint256 tokenId)',
  'function isLinked(uint64, bytes16, address, address vault) view returns (bool)',
  'function isPoolActive(uint64 poolId) view returns (bool)',
  'function linkVault(uint64 poolId, bytes16 trancheId, uint128 assetId, address vault)',
  'function pools(uint64 poolId) view returns (uint256 createdAt)',
  'function recoverTokens(address token, uint256 tokenId, address to, uint256 amount)',
  'function registerAsset(address asset, uint256 tokenId, uint16 destChainId) returns (uint128 assetId)',
  'function rely(address user)',
  'function sender() view returns (address)',
  'function tranche(uint64 poolId, bytes16 trancheId) view returns (address)',
  'function trancheFactory() view returns (address)',
  'function tranchePrice(uint64 poolId, bytes16 trancheId, uint128 assetId) view returns (uint128 price, uint64 computedAt)',
  'function transferTrancheTokens(uint64 poolId, bytes16 trancheId, uint16 destinationId, bytes32 recipient, uint128 amount)',
  'function unlinkVault(uint64 poolId, bytes16 trancheId, uint128 assetId, address vault)',
  'function update(uint64 poolId, bytes16 trancheId, bytes payload)',
  'function updateContract(uint64 poolId, bytes16 trancheId, address target, bytes update_)',
  'function updateRestriction(uint64 poolId, bytes16 trancheId, bytes update_)',
  'function updateTrancheHook(uint64 poolId, bytes16 trancheId, address hook)',
  'function updateTrancheMetadata(uint64 poolId, bytes16 trancheId, string name, string symbol)',
  'function updateTranchePrice(uint64 poolId, bytes16 trancheId, uint128 assetId, uint128 price, uint64 computedAt)',
  'function vaultDetails(address vault) view returns ((uint128 assetId, address asset, uint256 tokenId, bool isWrapper, bool isLinked) details)',
  'function vaultFactory(address factory) view returns (bool)',
  'function wards(address) view returns (uint256)',
] as const
