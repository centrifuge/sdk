import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { getAddress } from 'viem'
import { HUB_ACTIONS, type HubAction } from '../tests/hubActions.js'
import { depositEpoch, depositOrder, redeemEpoch, redeemOrder, stubIndexer } from '../tests/settledOrders.js'
import { ctx, entitiesOf, HUB, pool33Id, scId33, spokeAssetId, thenable, who } from '../tests/hubGroup.js'
import {
  argsOf,
  type Chain,
  deployFixture,
  DEPLOY_READS,
  delayedOf,
  FIRST_DEPLOYMENT,
  initiated,
  inner,
  judged,
  lastStatus,
  nameOf,
  OTHER_SIGNER,
  rig,
  same,
  scheduledData,
  sharePriceFixture,
  SIGNER,
  type Sent,
} from '../tests/hubPolicyRig.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'

// Every v3.3 write of an entity that sends Hub calls (`tests/hubActions.ts`) runs on a pool whose policy is `StdHubPolicy`
// and has scheduled nothing, so what it delays ends in `OutOfPolicy`. That status is scheduled, the authorizations
// mature and the group is executed. The oracle is the same write sent with no policy installed: its calls are the calls
// `scheduleOutOfPolicy` sends and the calls `executeAuthorizations` sends, and the fees add up.

type Subject = ReturnType<typeof rig>

const labelOf = (data: HexString) => {
  try {
    return nameOf(data)
  } catch {
    return data.slice(0, 10)
  }
}
/** The calls of the sends in order; a send that is no Hub multicall is one call. */
const callsOf = (sends: readonly Sent[]) =>
  sends.flatMap((tx) => (labelOf(tx.data) === 'multicall' ? inner(tx.data) : [tx.data]))
const total = (sends: readonly Sent[]) => sends.reduce((sum, tx) => sum + tx.value, 0n)
const refundOf = (data: HexString) => getAddress(argsOf(data).at(-1))

/** `calls` less one occurrence of each of `taken`, in order. */
function without(calls: readonly HexString[], taken: readonly HexString[]) {
  const left = [...taken]
  return calls.filter((call) => {
    const at = left.indexOf(call)
    if (at < 0) return true
    left.splice(at, 1)
    return false
  })
}

/** Runs the write once with no policy installed, and returns the calls it sent. */
async function entityCalls(subject: Subject, write: () => PromiseLike<unknown>) {
  await write()
  const sent = subject.sent.splice(0)
  return { sent, calls: callsOf(sent) }
}

/**
 * The action under the policy: the status it ends in, the transaction that schedules it, and the transaction that
 * executes the group once the authorizations matured, all on the chain state of `chain`.
 */
async function roundTrip(action: HubAction, prepare: (chain: Chain) => void = () => {}) {
  const subject = rig(action.reads, action.contracts)
  const { pool, write } = action.setup(subject.centrifuge)
  prepare(subject.chain)
  const oracle = await entityCalls(subject, write)
  const status = await judged(subject, write)
  const scheduling = await lastStatus(pool.scheduleOutOfPolicy(status))
  const atScheduling = subject.sent.splice(0)
  subject.chain.authorizationDefault = 'matured'
  const execution = await lastStatus(pool.executeAuthorizations(scheduledData(status)))
  const atExecution = subject.sent.splice(0)

  const initiates = callsOf(atScheduling).filter((call) => labelOf(call) === 'initiateAuthorization')
  const sentNow = without(callsOf(atScheduling), initiates)
  const executed = callsOf(atExecution)
  const group = scheduledData(status)
  const deferred = status.batch.filter((call) => call.deferred).map((call) => call.data)
  return {
    subject,
    pool,
    oracle,
    status,
    scheduling,
    atScheduling,
    execution,
    atExecution,
    initiates,
    sentNow,
    executed,
    group,
    deferred,
    /** What the action sent that neither transaction sends. */
    lost: without(oracle.calls, [...sentNow, ...executed]),
    /** What a transaction sends that the action did not. */
    extra: without([...sentNow, ...executed], oracle.calls),
    /** Calls sent at scheduling that the action sent after a call that is sent later. */
    reordered: sentNow.filter((call) => {
      const before = oracle.calls.slice(0, oracle.calls.indexOf(call))
      return before.some((earlier) => !sentNow.includes(earlier))
    }),
  }
}

/** The actions whose calls `StdHubPolicy` all lets through, so none of them ends in `OutOfPolicy`. */
const INSTANT_ONLY = new Set([
  'Pool.updateMetadata',
  'ShareClass.notifySharePrice',
  'ShareClass.notifyAssetPrice',
  'ShareClass.freezeMember',
])

/** What each action defers and sends at scheduling, by function name; an action not listed does neither. */
const SPLIT: Record<string, { deferred?: string[]; sentNow?: string[]; reordered?: string[] }> = {
  'Pool.update': {
    sentNow: ['setPoolMetadata', 'updateShareClassMetadata', 'notifyShareMetadata'],
    reordered: ['updateShareClassMetadata', 'notifyShareMetadata'],
  },
  'ShareClass.updateSharePrice': { deferred: ['notifySharePrice', 'notifySharePrice'] },
  'PoolNetwork.deploy, first deployment on a spoke': { deferred: ['notifyPool'] },
  'PoolNetwork.deploy, two share classes on a first deployment': { deferred: ['notifyPool'] },
  'PoolNetwork.deploy, a first deployment whose adapters are not wired': { deferred: ['notifyPool'] },
  'PoolNetwork.deploy, a sync deposit vault': { deferred: ['notifyAssetPrice'] },
  'PoolNetwork.deploy, an async deposit vault with the balance sheet manager not yet set': {
    deferred: ['notifyAssetPrice'],
  },
  'Centrifuge.batchTransactions of a Freeze and Member updates': { sentNow: ['updateRestriction'] },
  'OnOffRampManager.setAsset, which also prices the accounting token': {
    sentNow: ['notifyAssetPrice'],
    reordered: ['notifyAssetPrice'],
  },
}

describe('hub actions under StdHubPolicy', () => {
  afterEach(() => sinon.restore())

  it('has one scenario per action', () => {
    const names = HUB_ACTIONS.map((action) => action.name)

    expect(new Set(names).size).to.equal(names.length)
  })

  describe('an action whose calls the policy all lets through', () => {
    for (const action of HUB_ACTIONS.filter(({ name }) => INSTANT_ONLY.has(name))) {
      it(`${action.name} is sent as it is and never ends in OutOfPolicy`, async () => {
        const subject = rig(action.reads, action.contracts)
        const { write } = action.setup(subject.centrifuge)
        const { sent, calls } = await entityCalls(subject, write)
        expect(delayedOf(calls), 'calls the policy delays').to.deep.equal([])

        subject.chain.installed = true
        subject.chain.authorizationDefault = 'none'
        const result = await lastStatus(write())

        expect(result.type).to.equal('TransactionConfirmed')
        same(sent, subject.sent)
      })
    }
  })

  describe('an action with a call the policy delays', () => {
    for (const action of HUB_ACTIONS.filter(({ name }) => !INSTANT_ONLY.has(name))) {
      it(`${action.name}: the calls it sent are sent by scheduling and by executing the group`, async () => {
        const trip = await roundTrip(action)
        const split = SPLIT[action.name] ?? {}

        expect(delayedOf(trip.oracle.calls), 'calls the policy delays').to.not.deep.equal([])
        expect(trip.scheduling.type, 'scheduling').to.equal('TransactionConfirmed')
        expect(trip.execution.type, 'execution').to.equal('TransactionConfirmed')
        expect(trip.atScheduling, 'one transaction schedules').to.have.length(1)
        expect(trip.initiates.map(initiated), 'what scheduling initiates').to.deep.equal(trip.group)
        expect(trip.lost, 'calls the action sent that neither transaction sends').to.deep.equal([])
        expect(trip.extra, 'calls a transaction sends that the action did not').to.deep.equal([])
        expect(trip.deferred.map(nameOf), 'deferred').to.deep.equal(split.deferred ?? [])
        expect(trip.sentNow.map(nameOf), 'sent at scheduling').to.deep.equal(split.sentNow ?? [])
        expect(trip.reordered.map(nameOf), 'sent at scheduling ahead of a call that precedes it').to.deep.equal(
          split.reordered ?? []
        )
        expect(without(trip.executed, trip.group), 'rebuilt by the execution').to.have.members(trip.deferred)
        expect(total(trip.atScheduling) + total(trip.atExecution), 'the fees add up').to.equal(total(trip.oracle.sent))
        if (trip.sentNow.length === 0) same(trip.oracle.sent, trip.atExecution)
      })
    }
  })

  // The execution rebuilds the calls the status defers from the calls of the group and the chain as it is then, so two
  // variants of an action that schedule the same calls but defer other ones cannot be told apart by their group.
  describe('variants of an action that schedule the same calls', () => {
    const SIGNER_LOWER = SIGNER.toLowerCase() as HexString
    const poolManagers = (updates: { address: HexString; canManage: boolean }[]): HubAction => ({
      name: 'Pool.updatePoolManagers',
      covers: ['updateHubManager'],
      setup(centrifuge) {
        const { pool } = entitiesOf(centrifuge)
        sinon.stub(pool, 'poolManagers').returns(thenable([{ address: SIGNER_LOWER }]) as any)
        return { pool, write: () => pool.updatePoolManagers(updates.map((update) => ({ ...update }))) }
      },
    })

    type Outcome = 'identical' | 'calls sent at scheduling differ' | 'calls the execution rebuilds differ'
    async function outcomeOf(a: HubAction, b: HubAction): Promise<Outcome> {
      const batches = []
      for (const action of [a, b]) {
        const subject = rig(action.reads, action.contracts)
        batches.push((await judged(subject, action.setup(subject.centrifuge).write)).batch)
        sinon.restore()
      }
      const [first, second] = batches as [(typeof batches)[0], (typeof batches)[0]]
      const group = (batch: typeof first) => batch.filter((call) => call.status === 'needs-authorization')
      expect(
        group(first).map((call) => call.data),
        'the variants schedule the same calls'
      ).to.deep.equal(group(second).map((call) => call.data))
      if (JSON.stringify(first) === JSON.stringify(second)) return 'identical'
      const rebuilt = (batch: typeof first) => batch.filter((call) => call.deferred).map((call) => call.data)
      return JSON.stringify(rebuilt(first)) === JSON.stringify(rebuilt(second))
        ? 'calls sent at scheduling differ'
        : 'calls the execution rebuilds differ'
    }

    const variants: [string, () => [HubAction, HubAction], Outcome][] = [
      [
        'a pool manager update, whatever the order the signer is listed in',
        () => [
          poolManagers([
            { address: SIGNER_LOWER, canManage: false },
            { address: who, canManage: true },
          ]),
          poolManagers([
            { address: who, canManage: true },
            { address: SIGNER_LOWER, canManage: false },
          ]),
        ],
        'identical',
      ],
      [
        'approve and issue, with and without the claim notifications, which are no Hub calls',
        () => [approveAndIssue(), approveAndIssue({ notify: false })],
        'identical',
      ],
      [
        'a pool update that renames a share class, whose instant calls scheduling sends as the status holds them',
        () => [poolUpdate('New'), poolUpdate('Newer')],
        'calls sent at scheduling differ',
      ],
      [
        'a share price update that skips a network (skipNetworks, the documented exception)',
        () => [sharePriceAction(), sharePriceAction({ skipNetworks: [HUB] })],
        'calls the execution rebuilds differ',
      ],
      [
        'a share price update that refunds another address than the signer',
        () => [sharePriceAction(), sharePriceAction({ refundAddress: OTHER_SIGNER })],
        'calls the execution rebuilds differ',
      ],
    ]

    for (const [name, make, outcome] of variants) {
      it(`${name}: ${outcome}`, async () => {
        expect(await outcomeOf(...make())).to.equal(outcome)
      })
    }
  })

  describe('where the group does not send what the action sent', () => {
    it('sends a notification to a network that skipNetworks left out, since that option is in no calldata', async () => {
      const trip = await roundTrip(sharePriceAction({ skipNetworks: [HUB] }))

      expect(trip.lost).to.deep.equal([])
      expect(trip.extra.map((call) => [nameOf(call), argsOf(call)[2]])).to.deep.equal([['notifySharePrice', HUB]])
    })

    it('refunds the notifications it rebuilds to the signer, not to the refund address the action named', async () => {
      const trip = await roundTrip(sharePriceAction({ refundAddress: OTHER_SIGNER }))

      expect(trip.lost.map(refundOf)).to.deep.equal([OTHER_SIGNER, OTHER_SIGNER])
      expect(trip.extra.map(refundOf)).to.deep.equal([SIGNER, SIGNER])
      expect([...trip.lost, ...trip.extra].map(nameOf)).to.deep.equal(Array(4).fill('notifySharePrice'))
    })

    it('refunds the notifyPool it rebuilds to the signer, not to the refund address a deployment named', async () => {
      const deployment: HubAction = {
        name: 'PoolNetwork.deploy with a refund address',
        covers: ['notifyPool'],
        reads: DEPLOY_READS,
        contracts: HUB_ACTIONS.find(({ name }) => name.startsWith('PoolNetwork.deploy, first'))!.contracts,
        setup(centrifuge) {
          const { pool, network } = deployFixture(centrifuge, FIRST_DEPLOYMENT)
          return { pool, write: () => network.deploy([{ id: scId33, hook: who }], [], { refundAddress: OTHER_SIGNER }) }
        },
      }

      const trip = await roundTrip(deployment)

      expect(trip.lost.map((call) => [nameOf(call), refundOf(call)])).to.deep.equal([['notifyPool', OTHER_SIGNER]])
      expect(trip.extra.map((call) => [nameOf(call), refundOf(call)])).to.deep.equal([['notifyPool', SIGNER]])
    })

    describe('the claim notifications of an order flow, which are calls of the BatchRequestManager and not of the Hub', () => {
      const batchRequestManager = ctx(pool33Id, '3.3').addresses.batchRequestManager!.toLowerCase()

      it('are sent by neither transaction, and by claimsAfterExecution after the execution as the action sent them', async () => {
        const trip = await roundTrip(approveAndIssue())
        const claims = trip.oracle.sent[1]!
        expect(trip.oracle.sent).to.have.length(2)
        expect(claims.to.toLowerCase()).to.equal(batchRequestManager)
        expect(trip.lost).to.deep.equal(callsOf([claims]))
        expect(trip.extra).to.deep.equal([])
        settledDeposits(trip.subject.centrifuge)

        const result = await lastStatus(trip.pool.claimsAfterExecution(trip.group))

        expect(result.type).to.equal('TransactionConfirmed')
        expect(trip.subject.sent).to.deep.equal([claims])
      })

      it('are sent for a revoke, one notification for an investor of the two epochs it revokes', async () => {
        const trip = await roundTrip(approveAndRevoke())
        const claims = trip.oracle.sent[1]!
        expect(trip.oracle.sent).to.have.length(2)
        expect(claims.to.toLowerCase()).to.equal(batchRequestManager)
        expect(trip.lost).to.deep.equal(callsOf([claims]))
        settledRedemptions(trip.subject.centrifuge)

        await trip.pool.claimsAfterExecution(trip.group)

        expect(trip.subject.sent).to.deep.equal([claims])
      })

      it('are not sent by an action that opted out of them, and claimsAfterExecution still sends them', async () => {
        const trip = await roundTrip(approveAndIssue({ notify: false }))
        expect(trip.oracle.sent).to.have.length(1)
        settledDeposits(trip.subject.centrifuge)

        await trip.pool.claimsAfterExecution(trip.group)

        expect(trip.subject.sent).to.have.length(1)
        expect(trip.subject.sent[0]!.to.toLowerCase()).to.equal(batchRequestManager)
      })
    })

    it('sends a notifyShareMetadata that follows a delayed updateShareClassMetadata before it, with the old metadata', async () => {
      const action = HUB_ACTIONS.find(({ name }) => name === 'Pool.update')!

      const trip = await roundTrip(action, (chain) => chain.instant.delete('updateShareClassMetadata'))

      expect(trip.lost).to.deep.equal([])
      expect(trip.extra).to.deep.equal([])
      expect(trip.sentNow.map(nameOf)).to.deep.equal(['setPoolMetadata', 'notifyShareMetadata'])
      expect(trip.executed.map(nameOf)).to.include('updateShareClassMetadata')
      expect(trip.reordered.map(nameOf)).to.deep.equal(['notifyShareMetadata'])
    })
  })
})

function sharePriceAction(options: { skipNetworks?: number[]; refundAddress?: HexString } = {}): HubAction {
  return {
    name: 'ShareClass.updateSharePrice',
    covers: ['updateSharePrice', 'notifySharePrice'],
    setup(centrifuge) {
      const { pool, shareClasses } = sharePriceFixture(centrifuge)
      return {
        pool,
        write: () => shareClasses[0]!.updateSharePrice(new Price(10n ** 18n), new Date(1_700_000_000_000), options),
      }
    },
  }
}

/** Approve and issue with an investor who has a pending deposit, whom the action notifies unless `notify` is false. */
function approveAndIssue(options: { notify?: boolean } = {}): HubAction {
  return {
    name: 'ShareClass.approveDepositsAndIssueShares with an investor order',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      withInvestorOrder(shareClass)
      return {
        pool,
        write: () =>
          shareClass.approveDepositsAndIssueShares(
            [
              {
                assetId: spokeAssetId,
                approveAssetAmount: new Balance(500n, 6),
                approvePricePerAsset: new Balance(10n ** 18n, 18),
                issuePricePerShare: new Price(10n ** 18n),
              },
            ] as any,
            options
          ),
      }
    },
  }
}

/** Approve and revoke with an investor who has a pending redeem, whom the action notifies unless `notify` is false. */
function approveAndRevoke(options: { notify?: boolean } = {}): HubAction {
  return {
    name: 'ShareClass.approveRedeemsAndRevokeShares with an investor order',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingRedeem: new Balance(1_000n, 18), redeemEpoch: 5, revokeEpoch: 4 }],
        }) as any
      )
      sinon
        .stub(shareClass, '_redeemOrders')
        .returns(of({ redeemOrders: [{ assetId: spokeAssetId, investor: who, revokedAt: undefined }] }) as any)
      sinon.stub(shareClass, '_investorOrder').returns(
        thenable({
          assetId: spokeAssetId,
          investor: who,
          pendingRedeem: 5n,
          maxRedeemClaims: 0,
        }) as any
      )
      return {
        pool,
        write: () =>
          shareClass.approveRedeemsAndRevokeShares(
            [
              {
                assetId: spokeAssetId,
                approveShareAmount: new Balance(500n, 18),
                approvePricePerAsset: new Balance(10n ** 18n, 18),
                revokePricePerShare: new Price(10n ** 18n),
              },
            ] as any,
            options
          ),
      }
    },
  }
}

/** What the indexer holds once approve and issue (epoch 3) executed: the investor has one unclaimed closed epoch. */
function settledDeposits(centrifuge: Centrifuge) {
  stubIndexer(centrifuge, { [scId33.raw]: { deposits: { epochs: [depositEpoch(3)], orders: [depositOrder(who, 3)] } } })
}

/** The same once approve and revoke executed: the investor has an unclaimed closed order in each of the two epochs. */
function settledRedemptions(centrifuge: Centrifuge) {
  stubIndexer(centrifuge, {
    [scId33.raw]: {
      redemptions: {
        epochs: [redeemEpoch(4), redeemEpoch(5)],
        orders: [redeemOrder(who, 4), redeemOrder(who, 5)],
      },
    },
  })
}

/** One investor with a pending deposit. */
function withInvestorOrder(shareClass: ReturnType<typeof entitiesOf>['shareClass']) {
  sinon.stub(shareClass, 'pendingAmounts').returns(
    thenable({
      byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 3, issueEpoch: 3 }],
    }) as any
  )
  sinon
    .stub(shareClass, '_investOrders')
    .returns(of({ investOrders: [{ assetId: spokeAssetId, investor: who, issuedAt: undefined }] }) as any)
  sinon.stub(shareClass, '_investorOrder').returns(
    thenable({
      assetId: spokeAssetId,
      investor: who,
      pendingDeposit: 5n,
      maxDepositClaims: 0,
      issuedAt: undefined,
    }) as any
  )
}

function poolUpdate(tokenName: string): HubAction {
  const base = HUB_ACTIONS.find(({ name }) => name === 'Pool.update')!
  return {
    ...base,
    setup(centrifuge) {
      const { pool } = base.setup(centrifuge)
      return {
        pool,
        write: () =>
          pool.update(
            null,
            [{ id: scId33, tokenName, symbolName: 'NEW' } as any],
            [{ tokenName: 'Two', symbolName: 'TWO', salt: `0x${'ab'.repeat(32)}` } as any]
          ),
      }
    },
  }
}
