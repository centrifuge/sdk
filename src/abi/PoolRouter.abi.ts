export default [
  'constructor(address poolRegistry_, address assetRegistry_, address accounting_, address holdings_, address gateway_, address deployer)',
  'error AssetNotFound()',
  'error CallFailedWithEmptyRevert()',
  'error FileUnrecognizedWhat()',
  'error NotAuthorized()',
  'error NotAuthorizedAdmin()',
  'error PoolAlreadyUnlocked()',
  'error PoolLocked()',
  'error ShareClassNotFound()',
  'error UnauthorizedSender()',
  'event Deny(address indexed user)',
  'event File(bytes32 what, address addr)',
  'event Rely(address indexed user)',
  'function accounting() view returns (address)',
  'function addCredit(uint32 account, uint128 amount) payable',
  'function addDebit(uint32 account, uint128 amount) payable',
  'function addShareClass(string name, string symbol, bytes32 salt, bytes data) payable',
  'function allowPoolAdmin(address account, bool allow) payable',
  'function approveDeposits(bytes16 scId, uint128 paymentAssetId, uint128 maxApproval, address valuation) payable',
  'function approveRedeems(bytes16 scId, uint128 payoutAssetId, uint128 maxApproval) payable',
  'function assetRegistry() view returns (address)',
  'function cancelDepositRequest(uint64 poolId, bytes16 scId, bytes32 investor, uint128 depositAssetId)',
  'function cancelRedeemRequest(uint64 poolId, bytes16 scId, bytes32 investor, uint128 payoutAssetId)',
  'function claimDeposit(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) payable',
  'function claimRedeem(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) payable',
  'function createAccount(uint32 account, bool isDebitNormal) payable',
  'function createHolding(bytes16 scId, uint128 assetId, address valuation, uint24 prefix) payable',
  'function createPool(address admin, uint128 currency, address shareClassManager) payable returns (uint64 poolId)',
  'function decreaseHolding(bytes16 scId, uint128 assetId, address valuation, uint128 amount) payable',
  'function deny(address user)',
  'function depositRequest(uint64 poolId, bytes16 scId, bytes32 investor, uint128 depositAssetId, uint128 amount)',
  'function escrow(uint64 poolId, bytes16 scId, uint8 escrow_) pure returns (address)',
  'function execute(uint64 poolId, bytes[] data) payable',
  'function file(bytes32 what, address data)',
  'function gateway() view returns (address)',
  'function holdings() view returns (address)',
  'function increaseHolding(bytes16 scId, uint128 assetId, address valuation, uint128 amount) payable',
  'function issueShares(bytes16 scId, uint128 depositAssetId, uint128 navPerShare) payable',
  'function multicall(bytes[] data) payable',
  'function notifyPool(uint16 chainId) payable',
  'function notifyShareClass(uint16 chainId, bytes16 scId, bytes32 hook) payable',
  'function poolRegistry() view returns (address)',
  'function redeemRequest(uint64 poolId, bytes16 scId, bytes32 investor, uint128 payoutAssetId, uint128 amount)',
  'function registerAsset(uint128 assetId, string name, string symbol, uint8 decimals)',
  'function rely(address user)',
  'function revokeShares(bytes16 scId, uint128 payoutAssetId, uint128 navPerShare, address valuation) payable',
  'function sender() view returns (address)',
  'function setAccountMetadata(uint32 account, bytes metadata) payable',
  'function setHoldingAccountId(bytes16 scId, uint128 assetId, uint32 accountId) payable',
  'function setPoolMetadata(bytes metadata) payable',
  'function unlockedPoolId() view returns (uint64)',
  'function updateContract(uint16 chainId, bytes16 scId, bytes32 target, bytes payload) payable',
  'function updateHolding(bytes16 scId, uint128 assetId) payable',
  'function updateHoldingValuation(bytes16 scId, uint128 assetId, address valuation) payable',
  'function updateVault(bytes16 scId, uint128 assetId, bytes32 target, bytes32 vaultOrFactory, uint8 kind) payable',
  'function wards(address) view returns (uint256)',
] as const
