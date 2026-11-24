import { ABIS_V3_3 } from '@centrifuge/protocol'
import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import { encodeFunctionData, getAddress, keccak256, toHex } from 'viem'
import { AuthorizationFoldError } from '../errors.js'
import { foldAuthorizations, hubInstallsOf, policyNeedingExpiry } from './authorizationFold.js'
import { PoolId } from './types.js'

// Rows are the catalogue's `PoolAuthorizationEventRow` and `HubPolicyRow`: numeric(78,0) columns as decimal strings,
// integer columns as numbers, hex and addresses lowercase as emitted. The event kinds are the ones the projection
// stores.

const HUB_CENTRIFUGE_ID = '1'
const SPOKE_CENTRIFUGE_ID = '2'
const POOL_ID = PoolId.from(1, 1).raw.toString()
const HUB_REGISTRY = '0x1111111111111111111111111111111111111111' as const
const SPOKE_REGISTRY = '0x2222222222222222222222222222222222222222' as const
const POLICY_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const POLICY_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MANAGER = '0x3333333333333333333333333333333333333333' as const
const OTHER_MANAGER = '0x4444444444444444444444444444444444444444' as const
const SAME_TIMESTAMP = '2026-11-01T12:00:00.000Z'
const EXPIRY = 100n
const VALID_AFTER = 1_000n

const SET_POLICY = 'HUB_REGISTRY_SET_POLICY'
const SCHEDULED = 'HUB_REGISTRY_AUTHORIZATION_SCHEDULED'
const CANCELED = 'HUB_REGISTRY_AUTHORIZATION_CANCELED'
const CONSUMED = 'HUB_REGISTRY_AUTHORIZATION_CONSUMED'

type EventTableRow = PoolAuthorizationEventRow
type HubPolicyTableRow = HubPolicyRow

type At = { block: number; logIndex: number }

const authId = (label: string) => keccak256(toHex(label))
const txHash = (block: number, logIndex: number) => keccak256(toHex(`tx:${block}:${logIndex}`))

const updateHubManager = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateHubManager',
  args: [PoolId.from(1, 1).raw, MANAGER, true],
})

function eventRow(eventKind: string, at: At, overrides: Partial<EventTableRow> = {}): EventTableRow {
  return {
    centrifugeId: HUB_CENTRIFUGE_ID,
    poolId: POOL_ID,
    eventKind,
    sourceAddress: HUB_REGISTRY,
    targetCentrifugeId: null,
    policy: null,
    caller: MANAGER,
    authId: authId('a'),
    calldata: null,
    validAfter: null,
    createdAt: SAME_TIMESTAMP,
    createdAtBlock: at.block,
    createdAtTxHash: txHash(at.block, at.logIndex),
    createdAtLogIndex: at.logIndex,
    ...overrides,
  }
}

const install = (at: At, policy = POLICY_A, overrides: Partial<EventTableRow> = {}) =>
  eventRow(SET_POLICY, at, { policy, caller: null, authId: null, ...overrides })
const scheduled = (at: At, overrides: Partial<EventTableRow> = {}) =>
  eventRow(SCHEDULED, at, { calldata: updateHubManager, validAfter: VALID_AFTER.toString(), ...overrides })
const canceled = (at: At, overrides: Partial<EventTableRow> = {}) => eventRow(CANCELED, at, overrides)
const consumed = (at: At, overrides: Partial<EventTableRow> = {}) => eventRow(CONSUMED, at, overrides)

/** The `hub_policy` row of the `SetPolicy` log at `at`: same chain, pool, policy and position. */
function parameters(at: At, overrides: Partial<HubPolicyTableRow> = {}): HubPolicyTableRow {
  return {
    centrifugeId: HUB_CENTRIFUGE_ID,
    poolId: POOL_ID,
    policy: POLICY_A,
    delay: '86400',
    expiry: EXPIRY.toString(),
    escalation: '172800',
    maxAbsolutePriceDelta: '0',
    thresholdPerSecond: '0',
    maxBrmPriceDeviation: '340282366920938463463374607431768211455',
    isRestrictionUpdateInstant: false,
    onchainAccounting: true,
    createdAt: SAME_TIMESTAMP,
    createdAtBlock: at.block,
    createdAtTxHash: txHash(at.block, at.logIndex),
    createdAtLogIndex: at.logIndex,
    ...overrides,
  }
}

const FIRST_INSTALL_AT: At = { block: 10, logIndex: 0 }
const firstInstall = install(FIRST_INSTALL_AT)
const firstParameters = parameters(FIRST_INSTALL_AT)
const withoutExpiry = { expiry: null }

function fold(
  input: {
    events?: EventTableRow[]
    /** `SetPolicy` rows put in front of `events`; pass `[]` where the test lists them itself. */
    installs?: EventTableRow[]
    parameters?: HubPolicyTableRow[]
    now?: bigint
    contractExpiries?: ReadonlyMap<string, bigint>
  } = {}
) {
  return foldAuthorizations({
    events: [...(input.installs ?? [firstInstall]), ...(input.events ?? [])],
    policyParameters: input.parameters ?? [firstParameters],
    hubAbi: ABIS_V3_3.Hub,
    now: input.now ?? 0n,
    contractExpiries: input.contractExpiries,
  })
}

const items = (input: Parameters<typeof fold>[0] = {}) => fold(input).items

function statusAt(now: bigint, events = [scheduled({ block: 20, logIndex: 0 })]) {
  return items({ events, now })[0]?.status
}

describe('foldAuthorizations', () => {
  it('returns no items and nothing skipped for a pool with no rows', () => {
    expect(fold({ events: [], installs: [], parameters: [] })).to.deep.equal({ items: [], skipped: [] })
  })

  describe('a scheduled row that is still current', () => {
    it('is scheduled before validAfter', () => {
      expect(statusAt(VALID_AFTER - 1n)).to.equal('scheduled')
    })

    it('is matured from validAfter on', () => {
      expect(statusAt(VALID_AFTER)).to.equal('matured')
    })

    it('is still matured on the last second of the expiry window', () => {
      expect(statusAt(VALID_AFTER + EXPIRY)).to.equal('matured')
    })

    it('is expired one second after the expiry window', () => {
      expect(statusAt(VALID_AFTER + EXPIRY + 1n)).to.equal('expired')
    })

    it('maps every field of the scheduling row', () => {
      const events = [scheduled({ block: 20, logIndex: 3 })]

      expect(items({ events, now: VALID_AFTER })).to.deep.equal([
        {
          runId: `${txHash(20, 3)}:3`,
          authId: authId('a'),
          data: updateHubManager,
          functionName: 'updateHubManager',
          args: { poolId: PoolId.from(1, 1).raw, who: getAddress(MANAGER), canManage: true },
          caller: MANAGER,
          scheduledAt: 1793534400n,
          validAfter: VALID_AFTER,
          expiresAt: VALID_AFTER + EXPIRY,
          status: 'matured',
          txHash: txHash(20, 3),
          executedAt: null,
          executedTxHash: null,
          canceledAt: null,
          canceledTxHash: null,
        },
      ])
    })

    it('keeps validAfter and expiresAt exact for an expiry of the uint48 maximum', () => {
      const uint48Max = 2n ** 48n - 1n
      const parameterRows = [parameters(FIRST_INSTALL_AT, { expiry: uint48Max.toString() })]

      const [item] = items({
        events: [scheduled({ block: 20, logIndex: 0 })],
        parameters: parameterRows,
        now: VALID_AFTER + 5n,
      })

      expect(item?.status).to.equal('matured')
      expect(item?.expiresAt).to.equal(VALID_AFTER + uint48Max)
    })
  })

  describe('when it was scheduled', () => {
    const scheduledAt = (createdAt: string | null | undefined) =>
      items({ events: [scheduled({ block: 20, logIndex: 0 }, { createdAt: createdAt as string })] })[0]?.scheduledAt

    it('is the block time of the scheduling row in unix seconds, as a bigint', () => {
      expect(scheduledAt('2026-11-01T12:00:00.000Z')).to.equal(1793534400n)
    })

    it('rounds a timestamp with microseconds down to the second', () => {
      expect(scheduledAt('2026-11-02T08:30:45.999999+00:00')).to.equal(1793608245n)
    })

    it('reads the offset of a timestamp', () => {
      expect(scheduledAt('2026-11-01T12:00:00+02:00')).to.equal(1793527200n)
    })

    it('throws, like any column the fold needs, when the row carries no timestamp', () => {
      for (const missing of [null, undefined]) {
        expect(() => scheduledAt(missing)).to.throw(AuthorizationFoldError, 'createdAt is missing')
      }
    })

    it('throws for a timestamp that is not ISO-8601 with an offset: the row is broken, not incomplete', () => {
      for (const broken of [
        'yesterday',
        '1793534400',
        '1793534400000',
        '2026-11-01T12:00:00',
        '2026-13-45T00:00:00Z',
      ]) {
        expect(() => scheduledAt(broken), broken).to.throw(AuthorizationFoldError, 'createdAt is not an ISO-8601')
      }
    })

    it('reads the six fraction digits and the offset the live API writes', () => {
      expect(scheduledAt('2026-01-30T12:27:00.000000+00:00')).to.equal(1769776020n)
    })

    it('is the time of the scheduling row, not of the cancel or consumption that came later', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { createdAt: '2026-11-01T12:00:00.000Z' }),
        canceled({ block: 21, logIndex: 0 }, { createdAt: '2026-11-03T12:00:00.000Z' }),
      ]

      expect(items({ events })[0]).to.include({ status: 'canceled', scheduledAt: 1793534400n })
    })

    it('is each run’s own when the same calldata is scheduled again', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { createdAt: '2026-11-01T12:00:00.000Z' }),
        canceled({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 0 }, { createdAt: '2026-11-02T12:00:00.000Z' }),
      ]

      expect(items({ events }).map((item) => item.scheduledAt)).to.deep.equal([1793534400n, 1793620800n])
    })
  })

  describe('a scheduled row that ended', () => {
    it('is canceled, whatever the clock says, and keeps the data of the row it canceled', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }, { caller: OTHER_MANAGER }),
      ]

      const [item] = items({ events, now: VALID_AFTER + EXPIRY + 50n })

      expect(item?.status).to.equal('canceled')
      expect(item?.data).to.equal(updateHubManager)
      expect(item?.caller).to.equal(MANAGER)
      expect(item?.txHash).to.equal(txHash(20, 0))
    })

    it('is consumed, whatever the clock says', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }), consumed({ block: 22, logIndex: 4 })]

      expect(items({ events, now: VALID_AFTER + EXPIRY + 50n }).map((item) => item.status)).to.deep.equal(['consumed'])
    })
  })

  describe('when it was executed', () => {
    const consumedAt = (createdAt: string) => [
      scheduled({ block: 20, logIndex: 0 }),
      consumed({ block: 22, logIndex: 4 }, { createdAt }),
    ]

    it('is the block time of the consuming row in unix seconds, as a bigint, with its transaction hash', () => {
      const [item] = items({ events: consumedAt('2026-11-03T12:00:00.000Z') })

      expect(item).to.include({ status: 'consumed', executedAt: 1793707200n, executedTxHash: txHash(22, 4) })
    })

    it('rounds a timestamp with microseconds down to the second', () => {
      const [item] = items({ events: consumedAt('2026-11-03T12:00:00.999999+00:00') })

      expect(item?.executedAt).to.equal(1793707200n)
    })

    it('is not the time or the hash of the scheduling row', () => {
      const [item] = items({ events: consumedAt('2026-11-03T12:00:00.000Z') })

      expect(item?.scheduledAt).to.not.equal(item?.executedAt)
      expect(item?.txHash).to.not.equal(item?.executedTxHash)
    })

    it('is null for every status but consumed', () => {
      const secondInstallAt = { block: 30, logIndex: 0 }
      const cases: [string, Parameters<typeof items>[0]][] = [
        ['scheduled', { events: [scheduled({ block: 20, logIndex: 0 })], now: 0n }],
        ['matured', { events: [scheduled({ block: 20, logIndex: 0 })], now: VALID_AFTER }],
        ['expired', { events: [scheduled({ block: 20, logIndex: 0 })], now: VALID_AFTER + EXPIRY + 1n }],
        [
          'undetermined',
          {
            events: [scheduled({ block: 20, logIndex: 0 })],
            parameters: [parameters(FIRST_INSTALL_AT, withoutExpiry)],
            now: VALID_AFTER,
          },
        ],
        ['canceled', { events: [scheduled({ block: 20, logIndex: 0 }), canceled({ block: 21, logIndex: 0 })] }],
        [
          'orphaned',
          { events: [scheduled({ block: 20, logIndex: 0 }), install(secondInstallAt, POLICY_B)], now: VALID_AFTER },
        ],
      ]

      for (const [status, input] of cases) {
        const [item] = items(input)
        expect(item?.status, status).to.equal(status)
        expect([status, item?.executedAt, item?.executedTxHash]).to.deep.equal([status, null, null])
      }
    })

    it('belongs to the run the row consumed: a canceled run and a consumed run of one id', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }, { createdAt: '2026-11-02T12:00:00.000Z' }),
        scheduled({ block: 22, logIndex: 0 }),
        consumed({ block: 23, logIndex: 0 }, { createdAt: '2026-11-03T12:00:00.000Z' }),
      ]

      expect(items({ events }).map((item) => [item.status, item.executedAt, item.executedTxHash])).to.deep.equal([
        ['canceled', null, null],
        ['consumed', 1793707200n, txHash(23, 0)],
      ])
    })

    it('is each run’s own when two runs of one id were consumed', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        consumed({ block: 21, logIndex: 0 }, { createdAt: '2026-11-02T12:00:00.000Z' }),
        scheduled({ block: 22, logIndex: 0 }),
        consumed({ block: 23, logIndex: 0 }, { createdAt: '2026-11-03T12:00:00.000Z' }),
      ]

      expect(items({ events }).map((item) => [item.executedAt, item.executedTxHash])).to.deep.equal([
        [1793620800n, txHash(21, 0)],
        [1793707200n, txHash(23, 0)],
      ])
    })

    it('throws, like any column the fold needs, when the consuming row carries no timestamp', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        consumed({ block: 21, logIndex: 0 }, { createdAt: null as unknown as string }),
      ]

      expect(() => items({ events })).to.throw(AuthorizationFoldError, /createdAt is missing/)
    })
  })

  describe('when it was canceled', () => {
    const canceledAt = (createdAt: string) => [
      scheduled({ block: 20, logIndex: 0 }),
      canceled({ block: 21, logIndex: 2 }, { createdAt }),
    ]

    it('is the block time of the canceling row in unix seconds, as a bigint, with its transaction hash', () => {
      const [item] = items({ events: canceledAt('2026-11-02T12:00:00.000Z') })

      expect(item).to.include({
        status: 'canceled',
        canceledAt: 1793620800n,
        canceledTxHash: txHash(21, 2),
        executedAt: null,
        executedTxHash: null,
      })
    })

    it('rounds a timestamp with microseconds down to the second', () => {
      const [item] = items({ events: canceledAt('2026-11-02T12:00:00.999999+00:00') })

      expect(item?.canceledAt).to.equal(1793620800n)
    })

    it('is null for every status but canceled', () => {
      const secondInstallAt = { block: 30, logIndex: 0 }
      const cases: [string, Parameters<typeof items>[0]][] = [
        ['scheduled', { events: [scheduled({ block: 20, logIndex: 0 })], now: 0n }],
        ['matured', { events: [scheduled({ block: 20, logIndex: 0 })], now: VALID_AFTER }],
        ['expired', { events: [scheduled({ block: 20, logIndex: 0 })], now: VALID_AFTER + EXPIRY + 1n }],
        [
          'undetermined',
          {
            events: [scheduled({ block: 20, logIndex: 0 })],
            parameters: [parameters(FIRST_INSTALL_AT, withoutExpiry)],
            now: VALID_AFTER,
          },
        ],
        ['consumed', { events: [scheduled({ block: 20, logIndex: 0 }), consumed({ block: 21, logIndex: 0 })] }],
        [
          'orphaned',
          { events: [scheduled({ block: 20, logIndex: 0 }), install(secondInstallAt, POLICY_B)], now: VALID_AFTER },
        ],
      ]

      for (const [status, input] of cases) {
        const [item] = items(input)
        expect(item?.status, status).to.equal(status)
        expect([status, item?.canceledAt, item?.canceledTxHash]).to.deep.equal([status, null, null])
      }
    })

    it('belongs to the run the row canceled: a canceled run and a consumed run of one id', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }, { createdAt: '2026-11-02T12:00:00.000Z' }),
        scheduled({ block: 22, logIndex: 0 }),
        consumed({ block: 23, logIndex: 0 }, { createdAt: '2026-11-03T12:00:00.000Z' }),
      ]

      expect(items({ events }).map((item) => [item.status, item.canceledAt, item.canceledTxHash])).to.deep.equal([
        ['canceled', 1793620800n, txHash(21, 0)],
        ['consumed', null, null],
      ])
    })

    it('throws, like any column the fold needs, when the canceling row carries no timestamp', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }, { createdAt: null as unknown as string }),
      ]

      expect(() => items({ events })).to.throw(AuthorizationFoldError, /createdAt is missing/)
    })

    it('throws for a canceling row whose timestamp is not ISO-8601 with an offset', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }, { createdAt: 'not a timestamp' }),
      ]

      expect(() => items({ events })).to.throw(AuthorizationFoldError, /createdAt is not an ISO-8601 timestamp/)
    })
  })

  describe('installs, their order and their number come from the event rows', () => {
    const reinstall = (policy: string) => install({ block: 30, logIndex: 0 }, policy)

    it('is orphaned while its time says scheduled', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      expect(items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, now: 0n })[0]?.status).to.equal(
        'orphaned'
      )
    })

    it('is orphaned while its time says matured', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      expect(
        items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, now: VALID_AFTER })[0]?.status
      ).to.equal('orphaned')
    })

    it('is orphaned while its time says expired', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      expect(
        items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, now: VALID_AFTER + EXPIRY + 1n })[0]?.status
      ).to.equal('orphaned')
    })

    it('is orphaned while its time says undetermined', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      expect(
        items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, parameters: [], now: VALID_AFTER })[0]
          ?.status
      ).to.equal('orphaned')
    })

    it('is orphaned when the same policy address is installed again, because the nonce moved', () => {
      const installs = [firstInstall, reinstall(POLICY_A)]

      expect(items({ events: [scheduled({ block: 20, logIndex: 0 })], installs })[0]?.status).to.equal('orphaned')
    })

    it('is orphaned when the policy was cleared to the zero address', () => {
      const installs = [firstInstall, reinstall(ZERO_ADDRESS)]

      expect(items({ events: [scheduled({ block: 20, logIndex: 0 })], installs })[0]?.status).to.equal('orphaned')
    })

    it('is orphaned by the install rows alone, with no parameter row at all', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      expect(items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, parameters: [] })[0]?.status).to.equal(
        'orphaned'
      )
    })

    it('stays canceled when the install came after the cancel', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }), canceled({ block: 21, logIndex: 0 })]

      expect(items({ events, installs: [firstInstall, reinstall(POLICY_B)] })[0]?.status).to.equal('canceled')
    })

    it('stays consumed when the install came after the consumption', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }), consumed({ block: 21, logIndex: 0 })]

      expect(items({ events, installs: [firstInstall, reinstall(POLICY_B)] })[0]?.status).to.equal('consumed')
    })

    it('stays current when it was scheduled under the latest install, after an earlier one', () => {
      const installs = [firstInstall, reinstall(POLICY_B)]

      const [item] = items({
        events: [scheduled({ block: 40, logIndex: 0 })],
        installs,
        parameters: [firstParameters, parameters({ block: 30, logIndex: 0 }, { policy: POLICY_B })],
        now: VALID_AFTER,
      })

      expect(item?.status).to.equal('matured')
    })

    it('counts only the pool’s HubRegistry installs: a spoke or Hub spoke-policy row does not orphan', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        eventRow(
          'SPOKE_REGISTRY_SET_POLICY',
          { block: 21, logIndex: 0 },
          { centrifugeId: SPOKE_CENTRIFUGE_ID, policy: POLICY_B }
        ),
        eventRow('HUB_SET_SPOKE_POLICY', { block: 22, logIndex: 0 }, { policy: POLICY_B }),
      ]

      expect(items({ events })[0]?.status).to.equal('scheduled')
    })

    it('takes its expiry from the install in force when it was scheduled, not from the latest', () => {
      const installs = [firstInstall, install({ block: 30, logIndex: 0 }, POLICY_B)]
      const parameterRows = [
        parameters(FIRST_INSTALL_AT, { expiry: '100' }),
        parameters({ block: 30, logIndex: 0 }, { policy: POLICY_B, expiry: '5000' }),
      ]

      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 })], installs, parameters: parameterRows })

      expect(item?.status).to.equal('orphaned')
      expect(item?.expiresAt).to.equal(VALID_AFTER + 100n)
    })
  })

  describe('scheduling the same calldata again', () => {
    it('lists schedule, cancel, schedule as two runs: the canceled one stays, the new one starts over', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { validAfter: '1000' }),
        canceled({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 0 }, { validAfter: '5000' }),
      ]

      const result = items({ events, now: 2_000n })

      expect(result.map((item) => [item.status, item.validAfter, item.txHash])).to.deep.equal([
        ['canceled', 1_000n, txHash(20, 0)],
        ['scheduled', 5_000n, txHash(22, 0)],
      ])
      expect(result[1]?.expiresAt).to.equal(5_000n + EXPIRY)
    })

    it('lists a schedule after a consumption as a new run, the consumed one staying', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        consumed({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 0 }, { validAfter: '7000' }),
      ]

      const result = items({ events, now: 7_050n })

      expect(result.map((item) => [item.status, item.validAfter])).to.deep.equal([
        ['consumed', VALID_AFTER],
        ['matured', 7_000n],
      ])
    })

    it('shares the authorization id between runs and gives each run its own runId', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 4 }),
      ]

      const result = items({ events })

      expect(result.map((item) => item.authId)).to.deep.equal([authId('a'), authId('a')])
      expect(result.map((item) => item.runId)).to.deep.equal([`${txHash(20, 0)}:0`, `${txHash(22, 4)}:4`])
    })

    it('builds the runId from the lowercased hash of the scheduling transaction and the log index', () => {
      const upper = `0x${'AB'.repeat(32)}` as `0x${string}`
      const events = [scheduled({ block: 20, logIndex: 7 }, { createdAtTxHash: upper })]

      expect(items({ events })[0]?.runId).to.equal(`0x${'ab'.repeat(32)}:7`)
    })

    it('gives two runs scheduled in one transaction different runIds by log index', () => {
      const sameTx = txHash(20, 0)
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('a'), createdAtTxHash: sameTx }),
        scheduled({ block: 20, logIndex: 1 }, { authId: authId('b'), createdAtTxHash: sameTx }),
      ]

      expect(items({ events }).map((item) => item.runId)).to.deep.equal([`${sameTx}:0`, `${sameTx}:1`])
    })

    it('lists the calls scheduled in one transaction in log order under one txHash, apart from the calls of another', () => {
      const sameTx = txHash(20, 0)
      const second = encodeFunctionData({
        abi: ABIS_V3_3.Hub,
        functionName: 'updateHubManager',
        args: [PoolId.from(1, 1).raw, MANAGER, false],
      })
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('a'), createdAtTxHash: sameTx }),
        scheduled({ block: 20, logIndex: 1 }, { authId: authId('b'), createdAtTxHash: sameTx, calldata: second }),
        scheduled({ block: 21, logIndex: 0 }, { authId: authId('c') }),
      ]

      const result = items({ events })

      expect(result.map((item) => item.txHash)).to.deep.equal([sameTx, sameTx, txHash(21, 0)])
      expect(result.filter((item) => item.txHash === sameTx).map((item) => item.data)).to.deep.equal([
        updateHubManager,
        second,
      ])
    })

    it('ends a run at the next cancel or consumption of its id, and no earlier run’s end is borrowed', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 0 }),
        consumed({ block: 23, logIndex: 0 }),
        scheduled({ block: 24, logIndex: 0 }),
      ]

      expect(items({ events, now: 0n }).map((item) => item.status)).to.deep.equal(['canceled', 'consumed', 'scheduled'])
    })

    it('judges a run after a later install orphaned while an earlier canceled run of the same id stays canceled', () => {
      const reinstall = install({ block: 30, logIndex: 0 }, POLICY_B)
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }),
        scheduled({ block: 22, logIndex: 0 }),
        reinstall,
      ]

      expect(items({ events, now: 0n }).map((item) => item.status)).to.deep.equal(['canceled', 'orphaned'])
    })

    it('judges each run under the install in force when it was scheduled', () => {
      const secondInstallAt = { block: 30, logIndex: 0 }
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        canceled({ block: 21, logIndex: 0 }),
        install(secondInstallAt, POLICY_B),
        scheduled({ block: 40, logIndex: 0 }, { authId: authId('b') }),
      ]
      const parameterRows = [firstParameters, parameters(secondInstallAt, { policy: POLICY_B, expiry: '7' })]

      const result = items({ events, installs: [firstInstall], parameters: parameterRows, now: VALID_AFTER })

      expect(result.map((item) => [item.status, item.expiresAt])).to.deep.equal([
        ['canceled', VALID_AFTER + EXPIRY],
        ['matured', VALID_AFTER + 7n],
      ])
    })

    it('keeps two authorizations with different ids as two items', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('a') }),
        scheduled({ block: 20, logIndex: 1 }, { authId: authId('b') }),
        canceled({ block: 21, logIndex: 0 }, { authId: authId('b') }),
      ]

      expect(items({ events }).map((item) => [item.authId, item.status])).to.deep.equal([
        [authId('a'), 'scheduled'],
        [authId('b'), 'canceled'],
      ])
    })

    it('matches ids across rows whatever their hex casing', () => {
      const upper = authId('a').toUpperCase().replace('0X', '0x') as `0x${string}`
      const events = [scheduled({ block: 20, logIndex: 0 }), canceled({ block: 21, logIndex: 0 }, { authId: upper })]

      expect(items({ events }).map((item) => item.status)).to.deep.equal(['canceled'])
    })

    describe('the Sepolia sequence of pool 281474976730760', () => {
      const pad = (prefix: string) => `${prefix}${'00'.repeat(32 - (prefix.length - 2) / 2)}` as `0x${string}`
      const sepoliaPool = '281474976730760'
      const id = pad('0xa4de46d6c9')
      const sepolia = (
        kind: (at: At, overrides: Partial<EventTableRow>) => EventTableRow,
        at: At,
        tx: string,
        time: string
      ) => kind(at, { poolId: sepoliaPool, authId: id, createdAtTxHash: pad(tx), createdAt: time })
      const rows = [
        sepolia(scheduled, { block: 30, logIndex: 2 }, '0x79e52738', '2026-11-10T09:00:00.000000+00:00'),
        sepolia(canceled, { block: 31, logIndex: 1 }, '0x6ce2572c', '2026-11-10T10:00:00.000000+00:00'),
        sepolia(scheduled, { block: 32, logIndex: 5 }, '0xc67986c2', '2026-11-10T11:00:00.000000+00:00'),
        sepolia(consumed, { block: 33, logIndex: 0 }, '0xd48254f8', '2026-11-12T11:00:00.000000+00:00'),
      ]

      it('lists a canceled run and a consumed run, each with its own times and hashes', () => {
        const result = items({
          events: rows,
          installs: [install(FIRST_INSTALL_AT, POLICY_A, { poolId: sepoliaPool })],
          parameters: [parameters(FIRST_INSTALL_AT, { poolId: sepoliaPool })],
          now: 5_000n,
        })

        expect(result.map((item) => [item.status, item.scheduledAt, item.txHash, item.runId])).to.deep.equal([
          ['canceled', 1794301200n, pad('0x79e52738'), `${pad('0x79e52738')}:2`],
          ['consumed', 1794308400n, pad('0xc67986c2'), `${pad('0xc67986c2')}:5`],
        ])
        expect(result.map((item) => item.authId)).to.deep.equal([id, id])
        expect(result.map((item) => [item.executedAt, item.executedTxHash])).to.deep.equal([
          [null, null],
          [1794481200n, pad('0xd48254f8')],
        ])
        expect(result.map((item) => [item.canceledAt, item.canceledTxHash])).to.deep.equal([
          [1794304800n, pad('0x6ce2572c')],
          [null, null],
        ])
      })
    })
  })

  describe('ordering', () => {
    it('orders rows by block and log index even when every timestamp is equal and the input is shuffled', () => {
      const events = [
        canceled({ block: 21, logIndex: 5 }),
        scheduled({ block: 21, logIndex: 2 }, { validAfter: '1000' }),
        consumed({ block: 20, logIndex: 9 }),
        scheduled({ block: 20, logIndex: 1 }, { validAfter: '900' }),
      ]

      const result = items({ events })

      // scheduled(20,1) -> consumed(20,9) -> scheduled(21,2) -> canceled(21,5)
      expect(result.map((item) => [item.status, item.validAfter, item.txHash])).to.deep.equal([
        ['consumed', 900n, txHash(20, 1)],
        ['canceled', 1_000n, txHash(21, 2)],
      ])
    })

    it('reads a log index tie-break inside one block as chain order', () => {
      const events = [canceled({ block: 21, logIndex: 1 }), scheduled({ block: 21, logIndex: 0 })]

      expect(items({ events })[0]?.status).to.equal('canceled')

      const reversed = [canceled({ block: 21, logIndex: 0 }), scheduled({ block: 21, logIndex: 1 })]

      expect(items({ events: reversed, now: 0n })[0]?.status).to.equal('scheduled')
    })

    it('attributes an install by block and log index when the install and the schedule share a block', () => {
      const secondInstallAt = { block: 20, logIndex: 5 }
      const installs = [firstInstall, install(secondInstallAt, POLICY_B)]
      const parameterRows = [firstParameters, parameters(secondInstallAt, { policy: POLICY_B, expiry: '7' })]
      const before = scheduled({ block: 20, logIndex: 4 })
      const after = scheduled({ block: 20, logIndex: 6 }, { authId: authId('b') })

      const result = items({ events: [after, before], installs, parameters: parameterRows, now: 0n })

      expect(result.map((item) => [item.authId, item.status, item.expiresAt])).to.deep.equal([
        [authId('a'), 'orphaned', VALID_AFTER + EXPIRY],
        [authId('b'), 'scheduled', VALID_AFTER + 7n],
      ])
    })

    it('numbers installs by position, whatever order the rows arrive in', () => {
      const secondInstallAt = { block: 30, logIndex: 0 }
      const events = [install(secondInstallAt, POLICY_B), scheduled({ block: 40, logIndex: 0 }), firstInstall]

      expect(items({ events, installs: [], now: 0n })[0]?.status).to.equal('scheduled')
    })

    it('lists items oldest scheduling row first', () => {
      const events = [
        scheduled({ block: 30, logIndex: 0 }, { authId: authId('late') }),
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('early') }),
      ]

      expect(items({ events }).map((item) => item.authId)).to.deep.equal([authId('early'), authId('late')])
    })
  })

  describe('rows that are not hub authorizations', () => {
    it('ignores a spoke registry consumption that reuses an authorization id', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        consumed(
          { block: 21, logIndex: 0 },
          {
            eventKind: 'SPOKE_REGISTRY_AUTHORIZATION_CONSUMED',
            centrifugeId: SPOKE_CENTRIFUGE_ID,
            sourceAddress: SPOKE_REGISTRY,
          }
        ),
      ]

      expect(items({ events })[0]?.status).to.equal('scheduled')
    })

    it('ignores every kind outside the four hub kinds, whatever its name', () => {
      const other = (eventKind: string, logIndex: number, overrides: Partial<EventTableRow> = {}) =>
        eventRow(eventKind, { block: 21, logIndex }, overrides)
      // A Hub spoke-call event carries no auth_id and no caller, and the table stores them null.
      const hubSpokeCall = {
        authId: null,
        caller: null,
        targetCentrifugeId: SPOKE_CENTRIFUGE_ID,
        calldata: '0x',
      } as const
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        other('HUB_AUTHORIZE_SPOKE_CALL', 0, hubSpokeCall),
        other('HUB_UNAUTHORIZE_SPOKE_CALL', 1, hubSpokeCall),
        other('SPOKE_REGISTRY_AUTHORIZATION_GRANTED', 2, { centrifugeId: SPOKE_CENTRIFUGE_ID }),
        other('SPOKE_REGISTRY_AUTHORIZATION_REVOKED', 3, { centrifugeId: SPOKE_CENTRIFUGE_ID }),
        other('AuthorizationCanceled', 4),
      ]

      expect(items({ events }).map((item) => item.status)).to.deep.equal(['scheduled'])
    })

    it('lists a pool whose log holds Hub spoke-call and spoke-policy rows with no authId, without throwing', () => {
      const noAuthId = { authId: null, caller: null } as const
      const events = [
        scheduled({ block: 20, logIndex: 0 }),
        eventRow('HUB_SET_SPOKE_POLICY', { block: 21, logIndex: 0 }, { ...noAuthId, policy: `0x${'ab'.repeat(32)}` }),
        eventRow('HUB_AUTHORIZE_SPOKE_CALL', { block: 21, logIndex: 1 }, noAuthId),
        eventRow('HUB_UNAUTHORIZE_SPOKE_CALL', { block: 21, logIndex: 2 }, noAuthId),
      ]

      const result = fold({ events })

      expect(result.items.map((item) => item.status)).to.deep.equal(['scheduled'])
      expect(result.skipped).to.deep.equal([])
    })

    it('does not read a hub kind by its source address, which the kind already names', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }, { sourceAddress: SPOKE_REGISTRY })]

      expect(items({ events })).to.have.length(1)
    })
  })

  describe('arguments', () => {
    const notifyPool = encodeFunctionData({
      abi: ABIS_V3_3.Hub,
      functionName: 'notifyPool',
      args: [PoolId.from(1, 1).raw, 2, MANAGER],
    })

    it('names every argument of the call, a refund address included, as viem decodes it', () => {
      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: notifyPool })] })

      expect(item?.functionName).to.equal('notifyPool')
      expect(item?.args).to.deep.equal({ poolId: PoolId.from(1, 1).raw, centrifugeId: 2, refund: getAddress(MANAGER) })
    })

    it('tells an overload from the other by its selector', () => {
      const threeArguments = encodeFunctionData({
        abi: ABIS_V3_3.Hub,
        functionName: 'updateSharePrice',
        args: [PoolId.from(1, 1).raw, `0x${'11'.repeat(16)}`, 10n ** 18n],
      })
      const fourArguments = encodeFunctionData({
        abi: ABIS_V3_3.Hub,
        functionName: 'updateSharePrice',
        args: [PoolId.from(1, 1).raw, `0x${'11'.repeat(16)}`, 10n ** 18n, 1_700_000_000n],
      })

      const result = items({
        events: [
          scheduled({ block: 20, logIndex: 0 }, { calldata: threeArguments, authId: authId('three') }),
          scheduled({ block: 20, logIndex: 1 }, { calldata: fourArguments, authId: authId('four') }),
        ],
      })

      expect(result.map((item) => Object.keys(item.args ?? {}))).to.deep.equal([
        ['poolId', 'scId', 'pricePoolPerShare'],
        ['poolId', 'scId', 'pricePoolPerShare', 'computedAt'],
      ])
    })

    it('is null for a selector the Hub ABI does not carry', () => {
      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: '0xdeadbeef' })] })

      expect(item).to.include({ functionName: null, args: null })
    })

    it('is null when the arguments are cut short, while the function is still named', () => {
      const truncated = notifyPool.slice(0, 10 + 64) as `0x${string}`

      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: truncated })] })

      expect(item).to.include({ functionName: 'notifyPool', args: null })
    })

    it('is null for calldata that is only a selector', () => {
      const [item] = items({
        events: [scheduled({ block: 20, logIndex: 0 }, { calldata: notifyPool.slice(0, 10) as `0x${string}` })],
      })

      expect(item).to.include({ functionName: 'notifyPool', args: null })
    })
  })

  describe('function names', () => {
    it('names the Hub function by selector without decoding the arguments', () => {
      const truncated = updateHubManager.slice(0, 10 + 64) as `0x${string}`

      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: truncated })] })

      expect(item?.functionName).to.equal('updateHubManager')
    })

    it('is null for a selector the Hub ABI does not carry', () => {
      const [item] = items({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: '0xdeadbeef' })] })

      expect(item?.functionName).to.equal(null)
    })
  })

  describe('the expiry of an install', () => {
    const parametersWithoutExpiry = [parameters(FIRST_INSTALL_AT, withoutExpiry)]
    const live = [scheduled({ block: 20, logIndex: 0 })]

    it('is read from the contract when the parameter row carries none', () => {
      const [item] = items({
        events: live,
        parameters: parametersWithoutExpiry,
        now: VALID_AFTER + 301n,
        contractExpiries: new Map([[POLICY_A, 300n]]),
      })

      expect(item).to.include({ status: 'expired', expiresAt: VALID_AFTER + 300n })
    })

    it('is read from the contract when there is no parameter row at all', () => {
      const [item] = items({
        events: live,
        parameters: [],
        now: VALID_AFTER,
        contractExpiries: new Map([[POLICY_A, 300n]]),
      })

      expect(item).to.include({ status: 'matured', expiresAt: VALID_AFTER + 300n })
    })

    it('is read from a contract map keyed by a checksummed address', () => {
      const contractExpiries = new Map([['0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa', 300n]])

      const [item] = items({ events: live, parameters: parametersWithoutExpiry, now: VALID_AFTER, contractExpiries })

      expect(item?.expiresAt).to.equal(VALID_AFTER + 300n)
    })

    it('prefers the parameter row to the contract', () => {
      const [item] = items({ events: live, now: VALID_AFTER, contractExpiries: new Map([[POLICY_A, 300n]]) })

      expect(item?.expiresAt).to.equal(VALID_AFTER + EXPIRY)
    })

    it('belongs to the install of the same log: the same address installed twice keeps two expiries', () => {
      const secondInstallAt = { block: 30, logIndex: 0 }
      const installs = [firstInstall, install(secondInstallAt, POLICY_A)]
      const parameterRows = [
        parameters(FIRST_INSTALL_AT, { expiry: '100' }),
        parameters(secondInstallAt, { expiry: '5000' }),
      ]

      const result = items({
        events: [scheduled({ block: 20, logIndex: 0 }), scheduled({ block: 40, logIndex: 0 }, { authId: authId('b') })],
        installs,
        parameters: parameterRows,
      })

      expect(result.map((item) => item.expiresAt)).to.deep.equal([VALID_AFTER + 100n, VALID_AFTER + 5000n])
    })

    it('keeps two installs of one transaction apart by log index, each with its own parameter row', () => {
      const sameTx = txHash(30, 0)
      const first = { block: 30, logIndex: 0 }
      const second = { block: 30, logIndex: 1 }
      const installs = [
        firstInstall,
        install(first, POLICY_B, { createdAtTxHash: sameTx }),
        install(second, POLICY_A, { createdAtTxHash: sameTx }),
      ]
      const parameterRows = [
        firstParameters,
        parameters(first, { policy: POLICY_B, createdAtTxHash: sameTx, expiry: '111' }),
        parameters(second, { policy: POLICY_A, createdAtTxHash: sameTx, expiry: '222' }),
      ]

      const result = items({
        events: [
          scheduled({ block: 31, logIndex: 0 }, { authId: authId('late') }),
          scheduled({ block: 20, logIndex: 0 }, { authId: authId('early') }),
        ],
        installs,
        parameters: parameterRows,
      })

      // `late` follows both installs and is judged under the second (expiry 222); `early` under the first install.
      expect(result.map((item) => [item.authId, item.status, item.expiresAt])).to.deep.equal([
        [authId('early'), 'orphaned', VALID_AFTER + EXPIRY],
        [authId('late'), 'scheduled', VALID_AFTER + 222n],
      ])
      expect(hubInstallsOf(installs, parameterRows).map((i) => i.parameters?.expiry)).to.deep.equal([
        '100',
        '111',
        '222',
      ])
    })

    it('is not taken from a parameter row of another log, even at the install’s block and log index', () => {
      const otherLog = parameters(FIRST_INSTALL_AT, { createdAtTxHash: txHash(99, 99) })
      const otherPosition = parameters({ block: 11, logIndex: 0 })

      for (const row of [otherLog, otherPosition]) {
        const [item] = items({ events: live, parameters: [row], now: VALID_AFTER })

        expect(item).to.include({ status: 'undetermined', expiresAt: null })
      }
    })

    it('matches a parameter row to its install by primary key, whatever the hash casing', () => {
      const upper = txHash(10, 0).toUpperCase().replace('0X', '0x') as `0x${string}`
      const row = parameters(FIRST_INSTALL_AT, { createdAtTxHash: upper, expiry: '250' })

      const [item] = items({ events: live, parameters: [row], now: VALID_AFTER })

      expect(item?.expiresAt).to.equal(VALID_AFTER + 250n)
    })

    it('ignores a parameter row whose install is not in the events', () => {
      const [item] = items({
        events: live,
        parameters: [firstParameters, parameters({ block: 50, logIndex: 0 }, { policy: POLICY_B, expiry: '1' })],
        now: VALID_AFTER,
      })

      expect(item).to.include({ status: 'matured', expiresAt: VALID_AFTER + EXPIRY })
    })
  })

  describe('an install whose expiry is unknown', () => {
    const live = [scheduled({ block: 20, logIndex: 0 })]
    const cases = {
      'no parameter row': { parameters: [] },
      'a parameter row with a null expiry': { parameters: [parameters(FIRST_INSTALL_AT, withoutExpiry)] },
    }

    for (const [name, input] of Object.entries(cases)) {
      it(`leaves expiresAt null and stays scheduled before validAfter, with ${name}`, () => {
        const [item] = items({ events: live, ...input, now: VALID_AFTER - 1n })

        expect(item).to.include({ status: 'scheduled', expiresAt: null })
      })

      it(`is undetermined from validAfter on, never matured or expired, with ${name}`, () => {
        for (const now of [VALID_AFTER, VALID_AFTER + 1n, VALID_AFTER + 10_000_000n]) {
          const [item] = items({ events: live, ...input, now })

          expect(item, `now ${now}`).to.include({ status: 'undetermined', expiresAt: null })
        }
      })
    }

    it('counts an install row without a policy address as an install, whose expiry is unknown', () => {
      const noAddress = install({ block: 30, logIndex: 0 }, POLICY_B, { policy: null })
      const contractExpiries = new Map([[POLICY_B, 300n]])

      const result = items({
        events: [scheduled({ block: 20, logIndex: 0 }), scheduled({ block: 40, logIndex: 0 }, { authId: authId('b') })],
        installs: [firstInstall, noAddress],
        now: VALID_AFTER,
        contractExpiries,
      })

      // The earlier authorization is orphaned by the install; the later one has no address to look an expiry up by.
      expect(result.map((item) => [item.status, item.expiresAt])).to.deep.equal([
        ['orphaned', VALID_AFTER + EXPIRY],
        ['undetermined', null],
      ])
    })

    it('does not fail the list: the other items keep their status', () => {
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('open') }),
        scheduled({ block: 20, logIndex: 1 }, { authId: authId('gone') }),
        canceled({ block: 21, logIndex: 0 }, { authId: authId('gone') }),
      ]

      const result = items({ events, parameters: [], now: VALID_AFTER + 10_000n })

      expect(result.map((item) => [item.authId, item.status])).to.deep.equal([
        [authId('open'), 'undetermined'],
        [authId('gone'), 'canceled'],
      ])
    })

    it('does not need an expiry for an orphaned, canceled or consumed row', () => {
      const installs = [firstInstall, install({ block: 30, logIndex: 0 }, POLICY_B)]
      const events = [
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('orphan') }),
        scheduled({ block: 20, logIndex: 1 }, { authId: authId('gone') }),
        canceled({ block: 21, logIndex: 0 }, { authId: authId('gone') }),
      ]

      const result = items({ events, installs, parameters: [], now: VALID_AFTER + 10_000n })

      expect(result.map((item) => [item.status, item.expiresAt])).to.deep.equal([
        ['orphaned', null],
        ['canceled', null],
      ])
    })
  })

  describe('rows the fold leaves out and reports', () => {
    it('leaves out a live scheduling row with no install before it and names it', () => {
      const events = [
        scheduled({ block: 5, logIndex: 0 }, { authId: authId('early') }),
        scheduled({ block: 20, logIndex: 0 }, { authId: authId('fine') }),
      ]

      const result = fold({ events })

      expect(result.items.map((item) => item.authId)).to.deep.equal([authId('fine')])
      expect(result.skipped).to.deep.equal([{ authId: authId('early'), reason: 'installMissing' }])
    })

    it('leaves out a live scheduling row when the pool has no install row at all', () => {
      const result = fold({ events: [scheduled({ block: 20, logIndex: 0 })], installs: [], parameters: [] })

      expect(result.items).to.deep.equal([])
      expect(result.skipped).to.deep.equal([{ authId: authId('a'), reason: 'installMissing' }])
    })

    it('does not throw for it', () => {
      expect(() => fold({ events: [scheduled({ block: 5, logIndex: 0 })] })).to.not.throw()
    })

    it('still lists an ended authorization whose scheduling row has no install before it', () => {
      const events = [scheduled({ block: 5, logIndex: 0 }), canceled({ block: 6, logIndex: 0 })]

      const result = fold({ events })

      expect(result.items.map((item) => [item.status, item.expiresAt])).to.deep.equal([['canceled', null]])
      expect(result.skipped).to.deep.equal([])
    })

    it('leaves out a cancellation or consumption whose scheduling row is not in the rows and names it', () => {
      const result = fold({ events: [canceled({ block: 21, logIndex: 0 })] })

      expect(result.items).to.deep.equal([])
      expect(result.skipped).to.deep.equal([{ authId: authId('a'), reason: 'schedulingRowMissing' }])
    })

    it('counts a cancel or consumption with no open run before it, once per row', () => {
      const events = [
        canceled({ block: 21, logIndex: 0 }),
        consumed({ block: 22, logIndex: 0 }),
        scheduled({ block: 23, logIndex: 0 }),
        canceled({ block: 24, logIndex: 0 }),
        canceled({ block: 25, logIndex: 0 }),
      ]

      const result = fold({ events })

      expect(result.items.map((item) => item.status)).to.deep.equal(['canceled'])
      expect(result.skipped).to.deep.equal([
        { authId: authId('a'), reason: 'schedulingRowMissing' },
        { authId: authId('a'), reason: 'schedulingRowMissing' },
        { authId: authId('a'), reason: 'schedulingRowMissing' },
      ])
    })

    describe('a second scheduling row of an id whose run is still open', () => {
      it('keeps the first run and names the second row as endingRowMissing', () => {
        const events = [
          scheduled({ block: 20, logIndex: 0 }, { validAfter: '1000' }),
          scheduled({ block: 21, logIndex: 0 }, { validAfter: '5000' }),
        ]

        const result = fold({ events, now: 1_050n })

        expect(result.items.map((item) => [item.status, item.validAfter, item.txHash])).to.deep.equal([
          ['matured', 1_000n, txHash(20, 0)],
        ])
        expect(result.skipped).to.deep.equal([{ authId: authId('a'), reason: 'endingRowMissing' }])
      })

      it('ends the first run at the next cancel, so no run stays live', () => {
        const events = [
          scheduled({ block: 20, logIndex: 0 }),
          scheduled({ block: 21, logIndex: 0 }),
          canceled({ block: 22, logIndex: 0 }),
        ]

        const result = fold({ events })

        expect(result.items.map((item) => [item.status, item.txHash])).to.deep.equal([['canceled', txHash(20, 0)]])
        expect(result.skipped).to.deep.equal([{ authId: authId('a'), reason: 'endingRowMissing' }])
      })

      it('counts every such row, in chain order, next to the rows with no run to end', () => {
        const events = [
          canceled({ block: 19, logIndex: 0 }),
          scheduled({ block: 20, logIndex: 0 }),
          scheduled({ block: 21, logIndex: 0 }),
          scheduled({ block: 22, logIndex: 0 }),
        ]

        const result = fold({ events })

        expect(result.items.map((item) => item.txHash)).to.deep.equal([txHash(20, 0)])
        expect(result.skipped.map((entry) => entry.reason)).to.deep.equal([
          'schedulingRowMissing',
          'endingRowMissing',
          'endingRowMissing',
        ])
      })

      it('still starts a new run for an id whose earlier run was ended', () => {
        const events = [
          scheduled({ block: 20, logIndex: 0 }),
          canceled({ block: 21, logIndex: 0 }),
          scheduled({ block: 22, logIndex: 0 }),
        ]

        const result = fold({ events, now: VALID_AFTER })

        expect(result.items.map((item) => item.status)).to.deep.equal(['canceled', 'matured'])
        expect(result.skipped).to.deep.equal([])
      })

      it('does not hide another id’s scheduling row', () => {
        const events = [
          scheduled({ block: 20, logIndex: 0 }, { authId: authId('a') }),
          scheduled({ block: 21, logIndex: 0 }, { authId: authId('b') }),
        ]

        const result = fold({ events })

        expect(result.items.map((item) => item.authId)).to.deep.equal([authId('a'), authId('b')])
        expect(result.skipped).to.deep.equal([])
      })
    })

    it('names an installMissing run without hiding the ended run of the same id', () => {
      const events = [
        scheduled({ block: 5, logIndex: 0 }),
        canceled({ block: 6, logIndex: 0 }),
        scheduled({ block: 7, logIndex: 0 }),
      ]

      const result = fold({ events })

      expect(result.items.map((item) => item.status)).to.deep.equal(['canceled'])
      expect(result.skipped).to.deep.equal([{ authId: authId('a'), reason: 'installMissing' }])
    })

    it('reports nothing for complete rows', () => {
      expect(fold({ events: [scheduled({ block: 20, logIndex: 0 })] }).skipped).to.deep.equal([])
    })
  })

  describe('rows that are broken, not incomplete', () => {
    it('refuses rows of two pools', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }, { poolId: '999' })]

      expect(() => fold({ events })).to.throw(AuthorizationFoldError, 'one pool')
    })

    it('refuses a parameter row of another pool', () => {
      const parameterRows = [firstParameters, parameters({ block: 11, logIndex: 0 }, { poolId: '999' })]

      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 })], parameters: parameterRows })).to.throw(
        AuthorizationFoldError,
        'one pool'
      )
    })

    it('refuses a hub scheduling row of another chain than the pool’s hub chain', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }, { centrifugeId: SPOKE_CENTRIFUGE_ID })]

      expect(() => fold({ events })).to.throw(AuthorizationFoldError, 'hub chain')
    })

    it('refuses an install row of another chain than the pool’s hub chain', () => {
      const installs = [
        firstInstall,
        install({ block: 12, logIndex: 0 }, POLICY_B, { centrifugeId: SPOKE_CENTRIFUGE_ID }),
      ]

      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 })], installs })).to.throw(
        AuthorizationFoldError,
        'hub chain'
      )
    })

    it('refuses a parameter row of another chain than the pool’s hub chain', () => {
      const parameterRows = [
        firstParameters,
        parameters({ block: 11, logIndex: 0 }, { centrifugeId: SPOKE_CENTRIFUGE_ID }),
      ]

      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 })], parameters: parameterRows })).to.throw(
        AuthorizationFoldError,
        'hub chain'
      )
    })

    it('refuses a pool id that is not a whole number', () => {
      const events = [scheduled({ block: 20, logIndex: 0 }, { poolId: 'pool-1' })]

      expect(() => fold({ events, installs: [], parameters: [] })).to.throw(AuthorizationFoldError, 'poolId')
    })

    it('refuses a hub lifecycle row that lacks its authorization id', () => {
      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 }, { authId: null })] })).to.throw(
        AuthorizationFoldError,
        'authId'
      )
    })

    it('refuses a scheduling row that lacks its calldata or validAfter', () => {
      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 }, { calldata: null })] })).to.throw(
        AuthorizationFoldError,
        'calldata'
      )
      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 }, { validAfter: null })] })).to.throw(
        AuthorizationFoldError,
        'validAfter'
      )
    })

    it('refuses a numeric column that is not a whole decimal number', () => {
      expect(() => fold({ events: [scheduled({ block: 20, logIndex: 0 }, { validAfter: '12.5' })] })).to.throw(
        AuthorizationFoldError,
        'validAfter'
      )
      expect(() =>
        fold({
          events: [scheduled({ block: 20, logIndex: 0 })],
          parameters: [parameters(FIRST_INSTALL_AT, { expiry: '1e3' })],
        })
      ).to.throw(AuthorizationFoldError, 'expiry')
    })
  })

  describe('hubInstallsOf', () => {
    it('lists the HubRegistry installs in chain order, numbered from 1, each with the parameter row of its log', () => {
      const secondAt = { block: 30, logIndex: 4 }
      const installs = hubInstallsOf(
        [install(secondAt, POLICY_B), eventRow(SCHEDULED, { block: 20, logIndex: 0 }), firstInstall],
        [parameters(secondAt, { policy: POLICY_B }), firstParameters]
      )

      expect(installs.map((i) => [i.installNumber, i.policy, i.createdAtBlock, i.createdAtLogIndex])).to.deep.equal([
        [1, POLICY_A, 10, 0],
        [2, POLICY_B, 30, 4],
      ])
      expect(installs[0]?.parameters).to.equal(firstParameters)
    })

    it('has no parameters for an install whose hub_policy row is missing, and keeps a null policy null', () => {
      const [first, second] = hubInstallsOf(
        [firstInstall, install({ block: 30, logIndex: 0 }, POLICY_B, { policy: null })],
        []
      )

      expect(first?.parameters).to.equal(undefined)
      expect(second?.policy).to.equal(null)
    })

    it('lowercases the policy address', () => {
      const [first] = hubInstallsOf([install(FIRST_INSTALL_AT, '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa')], [])

      expect(first?.policy).to.equal(POLICY_A)
    })

    it('refuses rows of another pool or another chain, as the fold does', () => {
      expect(() => hubInstallsOf([firstInstall], [parameters(FIRST_INSTALL_AT, { poolId: '999' })])).to.throw(
        AuthorizationFoldError,
        'one pool'
      )
      expect(() =>
        hubInstallsOf([install(FIRST_INSTALL_AT, POLICY_A, { centrifugeId: SPOKE_CENTRIFUGE_ID })], [])
      ).to.throw(AuthorizationFoldError, 'hub chain')
    })
  })

  describe('policyNeedingExpiry', () => {
    const installsOf = (events: EventTableRow[], rows: HubPolicyTableRow[]) => hubInstallsOf(events, rows)
    const second = { block: 30, logIndex: 0 }

    it('names the latest install’s policy when its parameter row is missing or carries no expiry', () => {
      const events = [firstInstall, install(second, POLICY_B)]

      expect(policyNeedingExpiry(installsOf(events, []))).to.equal(POLICY_B)
      expect(
        policyNeedingExpiry(installsOf(events, [parameters(second, { policy: POLICY_B, expiry: null })]))
      ).to.equal(POLICY_B)
    })

    it('ignores an earlier install: a live authorization is judged under the latest', () => {
      const events = [firstInstall, install(second, POLICY_B)]
      const rows = [parameters(second, { policy: POLICY_B, expiry: '5' })]

      expect(policyNeedingExpiry(installsOf(events, rows))).to.equal(null)
    })

    it('is null when the parameter row gives the expiry, for the zero address, for an install with no address and for no install', () => {
      expect(policyNeedingExpiry(installsOf([firstInstall], [firstParameters]))).to.equal(null)
      expect(policyNeedingExpiry(installsOf([firstInstall, install(second, ZERO_ADDRESS)], []))).to.equal(null)
      expect(policyNeedingExpiry(installsOf([firstInstall, install(second, POLICY_B, { policy: null })], []))).to.equal(
        null
      )
      expect(policyNeedingExpiry(installsOf([], []))).to.equal(null)
    })
  })
})
