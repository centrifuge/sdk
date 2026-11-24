// Generic `multicall(bytes[])` fragment shared by every protocol contract that
// supports batching (Hub, BalanceSheet, VaultRouter, …). Used for encoding batch
// calldata in one place (`encodeBatchCalldata`) so it is not coupled to any one
// contract's ABI.
/**
 * ABI for `Multicall` at protocol v3.2: the single copy both the backend
 * builders and the SDK encode against.
 */
export const MULTICALL_ABI_V3_2 = [
  "function multicall(bytes[] data) payable",
] as const;
