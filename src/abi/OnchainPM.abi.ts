export default [
  'function computeScriptHash(bytes32[] commands, bytes32[] state, uint128 stateBitmap, (bytes32 hash, address caller)[] callbacks) pure returns (bytes32)',
  'function policy() view returns (bytes32)',
  'function activeStrategist() view returns (address)',

  'function execute(bytes32[] commands, bytes32[] state, uint128 stateBitmap, (bytes32 hash, address caller)[] callbacks, bytes32[] proof)',
  'function executeCallback(bytes32[] commands, bytes32[] state, uint128 stateBitmap, (bytes32 hash, address caller)[] callbacks)',
  'function trustedCall(address target, bytes data) returns (bytes)',

  'error NotAStrategist()',
  'error InvalidProof()',
  'error AlreadyExecuting()',
  'error StateLengthOverflow()',
  'error UnconsumedCallbacks()',
] as const
