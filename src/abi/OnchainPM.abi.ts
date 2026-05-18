export default [
  'function computeScriptHash(bytes32[] commands, bytes[] state, uint128 stateBitmap, (bytes32 hash, address caller)[] callbacks) pure returns (bytes32)',
  'function policy(address strategist) view returns (bytes32)',

  'function execute(bytes32[] commands, bytes[] state, uint128 stateBitmap, (bytes32 hash, address caller)[] callbacks, bytes32[] proof)',
  'function executeCallback(bytes32[] commands, bytes[] state, uint128 stateBitmap)',
  'function trustedCall(address target, bytes data) returns (bytes)',

  'error NotAStrategist()',
  'error InvalidProof()',
  'error AlreadyExecuting()',
  'error StateLengthOverflow()',
  'error UnconsumedCallbacks()',
] as const
