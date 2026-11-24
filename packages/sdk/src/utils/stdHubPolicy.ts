import { parseAbi } from 'viem'

/**
 * The views of `StdHubPolicy` that classify a call, time its authorization and bound who may update the share price,
 * and the two errors a classification reverts with. A policy is deployed by a factory, so the address book's ABI sets
 * carry no ABI for it; its address is what `Hub.policy(poolId)` answers.
 */
export const STD_HUB_POLICY_ABI = parseAbi([
  'function authorizationDelay(uint64 poolId, address caller, bytes data) view returns (uint48 delay)',
  'function delay() view returns (uint48)',
  'function expiry() view returns (uint48)',
  'function escalation() view returns (uint48)',
  'function onchainAccounting() view returns (bool)',
  'function simplePriceManager() view returns (address)',
  'error CallerNotAllowed()',
  'error OnchainAccountingOnly()',
])
