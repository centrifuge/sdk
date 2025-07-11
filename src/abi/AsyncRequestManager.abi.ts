export default [
  'function addVault(uint64 poolId, bytes16 scId, uint128 assetId, address vault_, address asset_, uint256)',
  'function approvedDeposits(uint64 poolId, bytes16 scId, uint128 assetId, uint128 assetAmount, uint128 pricePoolPerAsset)',
  'function balanceSheet() view returns (address)',
  'function cancelDepositRequest(address vault_, address controller, address)',
  'function cancelRedeemRequest(address vault_, address controller, address)',
  'function claimCancelDepositRequest(address vault_, address receiver, address controller) returns (uint256 assets)',
  'function claimCancelRedeemRequest(address vault_, address receiver, address controller) returns (uint256 shares)',
  'function claimableCancelDepositRequest(address vault_, address user) view returns (uint256 assets)',
  'function claimableCancelRedeemRequest(address vault_, address user) view returns (uint256 shares)',
  'function convertToAssets(address vault_, uint256 shares) view returns (uint256 assets)',
  'function convertToShares(address vault_, uint256 assets) view returns (uint256 shares)',
  'function deny(address user)',
  'function deposit(address vault_, uint256 assets, address receiver, address controller) returns (uint256 shares)',
  'function file(bytes32 what, address data)',
  'function fulfillDepositRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 fulfilledAssets, uint128 fulfilledShares, uint128 cancelledAssets)',
  'function fulfillRedeemRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 fulfilledAssets, uint128 fulfilledShares, uint128 cancelledShares)',
  'function globalEscrow() view returns (address)',
  'function investments(address vault, address investor) view returns (uint128 maxMint, uint128 maxWithdraw, uint256 depositPrice, uint256 redeemPrice, uint128 pendingDepositRequest, uint128 pendingRedeemRequest, uint128 claimableCancelDepositRequest, uint128 claimableCancelRedeemRequest, bool pendingCancelDepositRequest, bool pendingCancelRedeemRequest)',
  'function issuedShares(uint64 poolId, bytes16 scId, uint128 shareAmount, uint128 pricePoolPerShare)',
  'function maxDeposit(address vault_, address user) view returns (uint256 assets)',
  'function maxMint(address vault_, address user) view returns (uint256 shares)',
  'function maxRedeem(address vault_, address user) view returns (uint256 shares)',
  'function maxWithdraw(address vault_, address user) view returns (uint256 assets)',
  'function mint(address vault_, uint256 shares, address receiver, address controller) returns (uint256 assets)',
  'function pendingCancelDepositRequest(address vault_, address user) view returns (bool isPending)',
  'function pendingCancelRedeemRequest(address vault_, address user) view returns (bool isPending)',
  'function pendingDepositRequest(address vault_, address user) view returns (uint256 assets)',
  'function pendingRedeemRequest(address vault_, address user) view returns (uint256 shares)',
  'function poolEscrow(uint64 poolId) view returns (address)',
  'function priceLastUpdated(address vault_) view returns (uint64 lastUpdated)',
  'function recoverTokens(address token, address receiver, uint256 amount)',
  'function recoverTokens(address token, uint256 tokenId, address receiver, uint256 amount)',
  'function redeem(address vault_, uint256 shares, address receiver, address controller) returns (uint256 assets)',
  'function rely(address user)',
  'function removeVault(uint64 poolId, bytes16 scId, uint128 assetId, address vault_, address asset_, uint256)',
  'function requestDeposit(address vault_, uint256 assets, address controller, address, address) returns (bool)',
  'function requestRedeem(address vault_, uint256 shares, address controller, address owner, address) returns (bool)',
  'function revokedShares(uint64 poolId, bytes16 scId, uint128 assetId, uint128 assetAmount, uint128 shareAmount, uint128 pricePoolPerShare)',
  'function root() view returns (address)',
  'function sender() view returns (address)',
  'function spoke() view returns (address)',
  'function vault(uint64 poolId, bytes16 scId, uint128 assetId) view returns (address vault)',
  'function vaultByAssetId(uint64 poolId, bytes16 scId, uint128 assetId) view returns (address)',
  'function wards(address) view returns (uint256)',
  'function withdraw(address vault_, uint256 assets, address receiver, address controller) returns (uint256 shares)',
  'event AddVault(uint64 indexed poolId, bytes16 indexed scId, uint128 indexed assetId, address vault)',
  'event Deny(address indexed user)',
  'event File(bytes32 indexed what, address data)',
  'event Rely(address indexed user)',
  'event RemoveVault(uint64 indexed poolId, bytes16 indexed scId, uint128 indexed assetId, address vault)',
  'event TriggerRedeemRequest(uint64 indexed poolId, bytes16 indexed scId, address user, address indexed asset, uint256 tokenId, uint128 shares)',
  'error AssetMismatch()',
  'error AssetNotAllowed()',
  'error CancellationIsPending()',
  'error ExceedsDepositLimits()',
  'error ExceedsMaxDeposit()',
  'error ExceedsMaxRedeem()',
  'error ExceedsRedeemLimits()',
  'error FailedRedeemRequest()',
  'error FileUnrecognizedParam()',
  'error MulDiv_Overflow()',
  'error NoCode()',
  'error NoPendingRequest()',
  'error NotAuthorized()',
  'error SafeTransferEthFailed()',
  'error SenderNotVault()',
  'error ShareTokenAmountIsZero()',
  'error ShareTokenTransferFailed()',
  'error TransferNotAllowed()',
  'error Uint128_Overflow()',
  'error Uint64_Overflow()',
  'error VaultAlreadyExists()',
  'error VaultDoesNotExist()',
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
  'error ZeroAmountNotAllowed()',
] as const
