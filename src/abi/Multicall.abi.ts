// Generic `multicall(bytes[])` fragment shared by every protocol contract that
// supports batching (Hub, BalanceSheet, VaultRouter, …). Used for encoding batch
// calldata in one place (`encodeBatchCalldata`) so it is not coupled to any one
// contract's ABI.
export default ['function multicall(bytes[] data) payable'] as const
