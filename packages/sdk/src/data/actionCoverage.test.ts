import { expect } from 'chai'
import { backendRoutingTable } from './routing.js'

/**
 * The wire names of every member of `PoolActionType`
 * (`apps/private-api/src/domain/transactions/pool-action.ts`) — the backend's
 * closed list of actions it can build calldata for.
 *
 * The dependency between the two packages runs apps -> sdk, never back, so
 * this list cannot import that enum and restates its string values instead.
 * An action present in the backend's enum but absent from both this list and
 * `ACTION_ROUTES` would be invisible to the checks below: `resolveActionRoute`
 * falls back to `'local'` for anything it does not recognise, so the action
 * would silently take the local (browser) build on the backend transport,
 * bypassing policy evaluation and custodial signing, with nothing failing.
 * Adding a member to the backend enum means adding it here too, and then
 * either giving it a row in `ACTION_ROUTES` or a reason in
 * {@link LOCAL_ACTIONS} for staying local.
 */
const BACKEND_ACTIONS = [
  'updatePoolMetadata',
  'createHolding',
  'depositHolding',
  'withdrawHolding',
  'deployVault',
  'updateVaults',
  'updatePoolManagers',
  'updateBalanceSheetManagers',
  'registerOnOffRamp',
  'updateSharePrice',
  'updateMember',
  'freezeMember',
  'unfreezeMember',
  'crosschainTransferShares',
  'repayBatch',
  'approveDeposits',
  'issueShares',
  'approveRedeems',
  'revokeShares',
  'issueSharesDirect',
  'revokeSharesDirect',
] as const

/**
 * Backend actions with no row in `ACTION_ROUTES`, and why each stays on the
 * local build. A reader deciding whether a reason still holds should recheck
 * it against the cited method or call site rather than trust the prose here.
 */
const LOCAL_ACTIONS: Record<string, string> = {
  updatePoolMetadata:
    'pool.updateMetadata() still goes through the local _transact path, so a row alone would route nothing; wiring the method through the routing helper is tracked in centrifuge/apps-management#1274.',
  repayBatch:
    'Centrifuge.repayBatch() repairs an underpaid gateway batch between two networks; it is keyed by a network pair, not a pool, and no entity method exposes it as a pool write, so there is nothing for a row to route.',
}

describe('action coverage', () => {
  it('routes every backend action or states why it stays local, never both, never neither', () => {
    const { writes } = backendRoutingTable()

    for (const action of BACKEND_ACTIONS) {
      const routed = writes[action] === 'backend'
      const local = action in LOCAL_ACTIONS
      const outcome =
        routed === local ? (routed ? 'both routed and listed as local' : 'neither routed nor listed as local') : 'ok'
      expect(outcome, action).to.equal('ok')
    }
  })

  it('flags a write route keyed by an action the backend does not build', () => {
    const { writes } = backendRoutingTable()
    const known: readonly string[] = BACKEND_ACTIONS

    for (const key of Object.keys(writes)) {
      expect(known.includes(key), key).to.equal(true)
    }
  })

  it('keeps every local exception attached to a real action, with more than a placeholder for a reason', () => {
    const known: readonly string[] = BACKEND_ACTIONS

    for (const [action, reason] of Object.entries(LOCAL_ACTIONS)) {
      expect(known.includes(action), action).to.equal(true)
      // A length floor only rules out an empty string or a "TODO"; whether the
      // reason is true is for the reader, per the comment on LOCAL_ACTIONS.
      expect(reason.trim().length > 40, action).to.equal(true)
    }
  })
})
