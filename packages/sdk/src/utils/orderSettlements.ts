import { BATCH_REQUEST_MANAGER_ACTION } from '@centrifuge/protocol'
import type { HexString } from '../types/index.js'
import {
  callsBatchRequestManager,
  decodeOrderCall,
  type HubCallScope,
  type OrderCall,
  type ParsedHubCall,
} from './hubCallMessages.js'
import type { AssetId, PoolId } from './types.js'

// What a group of hub calls does to the orders of a share class: the `BatchRequestManager` approvals, issues and revokes
// it holds. An issue or a revoke leaves claims for the investors, which no Hub call sends. Everything here reads
// calldata only.

export type OrderKind = 'deposit' | 'redeem'

/** One approve, issue or revoke of a group. `settle` is an issue (deposits) or a revoke (redeems). */
export type OrderStep = {
  kind: OrderKind
  step: 'approve' | 'settle'
  scId: HexString
  assetId: AssetId
  epoch: number
}

const STEPS: Record<number, Pick<OrderStep, 'kind' | 'step'>> = {
  [BATCH_REQUEST_MANAGER_ACTION.approveDeposits]: { kind: 'deposit', step: 'approve' },
  [BATCH_REQUEST_MANAGER_ACTION.issueShares]: { kind: 'deposit', step: 'settle' },
  [BATCH_REQUEST_MANAGER_ACTION.approveRedeems]: { kind: 'redeem', step: 'approve' },
  [BATCH_REQUEST_MANAGER_ACTION.revokeShares]: { kind: 'redeem', step: 'settle' },
}

const stepOf = ({ action, ...order }: OrderCall): OrderStep => ({ ...STEPS[action]!, ...order })

/**
 * Whether `call` is a `managerCall` of `poolId` to its hub chain whose payload issues or revokes shares. The target is
 * not compared, since the pool's `BatchRequestManager` is known only from the address book: another contract on the hub
 * chain that takes the same payload counts as well, and {@link orderStepsOf} tells them apart.
 */
export function settlesOrders(call: ParsedHubCall | null, poolId: PoolId): boolean {
  if (call?.functionName !== 'managerCall' || call.args[0] !== poolId.raw || call.args[1] !== poolId.centrifugeId) {
    return false
  }
  const order = decodeOrderCall(call.args[3] as HexString)
  return order !== null && STEPS[order.action]?.step === 'settle'
}

/** The approves, issues and revokes among `calls`: the calls to the pool's `BatchRequestManager`, in order. */
export function orderStepsOf(calls: readonly ParsedHubCall[], scope: HubCallScope): OrderStep[] {
  return calls
    .filter((call) => call.functionName === 'managerCall' && callsBatchRequestManager(call.args, scope))
    .flatMap((call) => decodeOrderCall(call.args[3] as HexString) ?? [])
    .map(stepOf)
}
