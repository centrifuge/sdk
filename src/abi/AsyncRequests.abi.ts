export default [
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
  'error SafeTransferFailed()',
  'error SafeTransferFromFailed()',
  'error ShareTokenAmountIsZero()',
  'error ShareTokenTransferFailed()',
  'error TransferNotAllowed()',
  'error Uint128_Overflow()',
  'error VaultAlreadyExists()',
  'error VaultDoesNotExist()',
  'error ZeroAmountNotAllowed()',
  'event Deny(address indexed user)',
  'event File(bytes32 indexed what, address data)',
  'event Rely(address indexed user)',
  'event TriggerRedeemRequest(uint64 indexed poolId, bytes16 indexed scId, address user, address indexed asset, uint256 tokenId, uint128 shares)',
  'function addVault(uint64 poolId, bytes16 scId, address vaultAddr, address asset_, uint128 assetId)',
  'function balanceSheet() view returns (address)',
  'function cancelDepositRequest(address vaultAddr, address controller, address)',
  'function cancelRedeemRequest(address vaultAddr, address controller, address)',
  'function claimCancelDepositRequest(address vaultAddr, address receiver, address controller) returns (uint256 assets)',
  'function claimCancelRedeemRequest(address vaultAddr, address receiver, address controller) returns (uint256 shares)',
  'function claimableCancelDepositRequest(address vaultAddr, address user) view returns (uint256 assets)',
  'function claimableCancelRedeemRequest(address vaultAddr, address user) view returns (uint256 shares)',
  'function convertToAssets(address vaultAddr, uint256 shares) view returns (uint256 assets)',
  'function convertToShares(address vaultAddr, uint256 assets) view returns (uint256 shares)',
  'function deny(address user)',
  'function deposit(address vaultAddr, uint256 assets, address receiver, address controller) returns (uint256 shares)',
  'function escrow() view returns (address)',
  'function file(bytes32 what, address data)',
  'function fulfillCancelDepositRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 assets, uint128 fulfillment)',
  'function fulfillCancelRedeemRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 shares)',
  'function fulfillDepositRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 assets, uint128 shares)',
  'function fulfillRedeemRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 assets, uint128 shares)',
  'function investments(address vault, address investor) view returns (uint128 maxMint, uint128 maxWithdraw, uint256 depositPrice, uint256 redeemPrice, uint128 pendingDepositRequest, uint128 pendingRedeemRequest, uint128 claimableCancelDepositRequest, uint128 claimableCancelRedeemRequest, bool pendingCancelDepositRequest, bool pendingCancelRedeemRequest)',
  'function maxDeposit(address vaultAddr, address user) view returns (uint256 assets)',
  'function maxMint(address vaultAddr, address user) view returns (uint256 shares)',
  'function maxRedeem(address vaultAddr, address user) view returns (uint256 shares)',
  'function maxWithdraw(address vaultAddr, address user) view returns (uint256 assets)',
  'function mint(address vaultAddr, uint256 shares, address receiver, address controller) returns (uint256 assets)',
  'function pendingCancelDepositRequest(address vaultAddr, address user) view returns (bool isPending)',
  'function pendingCancelRedeemRequest(address vaultAddr, address user) view returns (bool isPending)',
  'function pendingDepositRequest(address vaultAddr, address user) view returns (uint256 assets)',
  'function pendingRedeemRequest(address vaultAddr, address user) view returns (uint256 shares)',
  'function poolManager() view returns (address)',
  'function priceLastUpdated(address vaultAddr) view returns (uint64 lastUpdated)',
  'function recoverTokens(address token, address receiver, uint256 amount)',
  'function recoverTokens(address token, uint256 tokenId, address receiver, uint256 amount)',
  'function redeem(address vaultAddr, uint256 shares, address receiver, address controller) returns (uint256 assets)',
  'function rely(address user)',
  'function removeVault(uint64 poolId, bytes16 scId, address vaultAddr, address asset_, uint128 assetId)',
  'function requestDeposit(address vaultAddr, uint256 assets, address controller, address, address) returns (bool)',
  'function requestRedeem(address vaultAddr, uint256 shares, address controller, address owner, address source) returns (bool)',
  'function root() view returns (address)',
  'function sender() view returns (address)',
  'function sharePriceProvider() view returns (address)',
  'function triggerRedeemRequest(uint64 poolId, bytes16 scId, address user, uint128 assetId, uint128 shares)',
  'function vault(uint64 poolId, bytes16 scId, uint128 assetId) view returns (address vault)',
  'function vaultByAssetId(uint64 poolId, bytes16 scId, uint128 assetId) view returns (address)',
  'function vaultKind(address) pure returns (uint8, address)',
  'function wards(address) view returns (uint256)',
  'function withdraw(address vaultAddr, uint256 assets, address receiver, address controller) returns (uint256 shares)',
] as const
