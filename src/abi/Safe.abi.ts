export const SAFE_HUB_DECODE_ABI = [
  'function multicall(bytes[] data) payable',
  'function executeMulticall(bytes[] data) payable',
  'function updateSharePrice(uint64 poolId, bytes16 scId, uint128 pricePoolPerShare, uint64 computedAt) payable',
  'function notifySharePrice(uint64 poolId, bytes16 scId, uint16 centrifugeId, address refund) payable',
  'function notifyShareClass(uint64 poolId, bytes16 scId, uint16 centrifugeId, bytes32 hook, address refund) payable',
  'function notifyPool(uint64 poolId, uint16 centrifugeId, address refund) payable',
  'function setRequestManager(uint64 poolId, uint16 centrifugeId, address hubManager, bytes32 spokeManager, address refund) payable',
  'function updateHubManager(uint64 poolId, address who, bool canManage) payable',
  'function updateBalanceSheetManager(uint64 poolId, uint16 centrifugeId, bytes32 who, bool canManage, address refund) payable',
  'function updateGatewayManager(uint64 poolId, uint16 centrifugeId, bytes32 who, bool canManage, address refund) payable',
] as const

export const SAFE_EXECUTION_ABI = [
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)',
] as const
