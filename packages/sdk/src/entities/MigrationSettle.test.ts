import { ABIS_V3_3, MessageTypeV3_3, MIGRATION_STEP, V33_MIGRATION_ABI_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { concatHex, encodeAbiParameters, keccak256, toHex, type Abi } from 'viem'
import type { HexString } from '../types/index.js'
import { PoolId, type CentrifugeId } from '../utils/types.js'
import {
  classify,
  classifyMessage,
  describeSettleRevert,
  dormantLeft,
  errorSelectors,
  messageLength,
  messagePoolId,
  relayedGap,
  replanRefusal,
  scopeBatches,
  settled,
  settleRun,
  splitBatch,
  unwrapExecutePayload,
  type SettleBatch,
  type SettleContext,
  type SettleDriver,
  type SettlePark,
} from './MigrationSettle.js'
import { batchOf } from './migrationSettleRead.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB = 1 as CentrifugeId
const SPOKE = 2 as CentrifugeId
const POOL = PoolId.from(HUB, 7)
const OTHER = PoolId.from(HUB, 8)
const MIGRATION = addr(0x33)
const ACCOUNTING = addr(0xac)
const GATEWAY = addr(0x9a)

const ctx: SettleContext = {
  poolId: POOL,
  hubCentrifugeId: HUB,
  spokeCentrifugeId: SPOKE,
  gateway: GATEWAY,
  migration: MIGRATION,
  accountingToken: ACCOUNTING,
}

const FACADE = V33_MIGRATION_ABI_V3_3 as unknown as Abi
const REGISTRY = ABIS_V3_3.SpokeRegistry as unknown as Abi
const sel = (abi: Abi, name: string) => errorSelectors(abi, [name])[0]!
const facade = (name: string) => sel(FACADE, name)

const byte = (n: number) => toHex(n, { size: 1 })
const poolWord = (pool: PoolId) => toHex(pool.raw, { size: 8 })
const bytes32Address = (address: HexString) => `${address}${'0'.repeat(24)}` as HexString

/** A `ManagerCallFromHub` toward `target` carrying `payload`. */
function managerCall(target: HexString, payload: HexString, pool = POOL): HexString {
  const length = toHex((payload.length - 2) / 2, { size: 2 })
  return concatHex([
    byte(MessageTypeV3_3.ManagerCallFromHub),
    poolWord(pool),
    bytes32Address(target),
    toHex(0n, { size: 16 }),
    length,
    payload,
  ])
}

const stepPayload = (step: number, generation = 1) =>
  encodeAbiParameters([{ type: 'uint8' }, { type: 'uint32' }], [step, generation])
const step = (ordinal: number, generation = 1, pool = POOL) =>
  managerCall(MIGRATION, stepPayload(ordinal, generation), pool)
const notifyPool = (pool = POOL) => concatHex([byte(MessageTypeV3_3.NotifyPool), poolWord(pool)])
const updateManager = (pool = POOL) =>
  concatHex([byte(MessageTypeV3_3.UpdateManager), poolWord(pool), toHex(0n, { size: 34 })])
const updateVault = (kind: number, pool = POOL) =>
  concatHex([
    byte(MessageTypeV3_3.UpdateVault),
    poolWord(pool),
    toHex(0n, { size: 16 + 16 + 32 }),
    byte(kind),
    toHex(0n, { size: 16 }),
    toHex(0, { size: 2 }),
  ])
const pricePerShare = (pool = POOL) =>
  concatHex([byte(MessageTypeV3_3.NotifyPricePoolPerShare), poolWord(pool), toHex(0n, { size: 40 })])

const batch = (...messages: HexString[]): SettleBatch => ({ payload: concatHex(messages), blockNumber: null })

const ARM = step(MIGRATION_STEP.arm)
const FREEZE = step(MIGRATION_STEP.freeze, 1)
const ABORT = step(MIGRATION_STEP.abort, 1)
const UNLINK = step(MIGRATION_STEP.unlinkVaults, 1)
const ROTATE = step(MIGRATION_STEP.rotateAssets, 1)
const FINALIZE = step(MIGRATION_STEP.finalizeOffboard, 1)
const RESTORE = step(MIGRATION_STEP.restoreMaxReserves)

type Script = {
  failed?: Record<string, number>
  retry?: (message: HexString, after: readonly HexString[]) => { ok: boolean; revert: HexString }
  phase?: number
  generation?: number
  paused?: boolean
}

function driver(script: Script): SettleDriver & { retries: { message: HexString; after: HexString[] }[] } {
  const retries: { message: HexString; after: HexString[] }[] = []
  return {
    retries,
    paused: async () => script.paused ?? false,
    failedMessages: async (hash) => script.failed?.[hash.toLowerCase()] ?? 0,
    spokePhase: async () => script.phase ?? 2,
    frozenGeneration: async () => script.generation ?? 1,
    retry: async (message, after) => {
      retries.push({ message, after: [...after] })
      return script.retry ? script.retry(message, after) : { ok: true, revert: '0x' }
    },
  }
}

const hashOf = (message: HexString) => keccak256(message).toLowerCase()
const park = (
  message: HexString,
  refusal: HexString,
  extra: Partial<SettlePark> = {}
): Pick<SettlePark, 'message' | 'refusal' | 'wouldLand'> => ({
  message: { ...classifyMessage(ctx, message, true), batch: 0, index: 0 },
  refusal,
  wouldLand: false,
  ...extra,
})

describe('MigrationSettle messages', () => {
  it('splits a batch by the v3.3 length table, payload-carrying messages included', () => {
    const messages = splitBatch(concatHex([notifyPool(), FREEZE, updateVault(1), updateManager(), pricePerShare()]))
    expect(messages).to.have.length(5)
    expect(messages[0]).to.equal(notifyPool())
    expect(messages[1]).to.equal(FREEZE)
    expect(messages[2]).to.equal(updateVault(1))
    expect(messageLength(updateVault(1))).to.equal(92)
    expect(messageLength(notifyPool())).to.equal(9)
    expect(messagePoolId(notifyPool(OTHER))).to.equal(OTHER.raw)
    expect(unwrapExecutePayload(concatHex([toHex(7, { size: 2 }), notifyPool()]))).to.equal(notifyPool())
    expect(() => splitBatch(concatHex([byte(0), poolWord(POOL)]))).to.throw(/unknown message type 0/)
  })

  it('classifies a step, a ramp grant, a ramp config, a hook-manager grant and a plain manager update', () => {
    expect(classifyMessage(ctx, FREEZE, true)).to.include({
      kind: 'Freeze',
      isStep: true,
      step: MIGRATION_STEP.freeze,
      stepName: 'freeze',
    })
    expect(classifyMessage(ctx, managerCall(ACCOUNTING, '0x1234'), true).kind).to.equal('RampGrant')
    expect(
      classifyMessage(ctx, managerCall(addr(0x77), encodeAbiParameters([{ type: 'uint8' }], [1])), true).kind
    ).to.equal('RampConfig')
    expect(
      classifyMessage(
        ctx,
        managerCall(addr(0x77), encodeAbiParameters([{ type: 'bytes16' }], [`0x${'ab'.repeat(16)}`])),
        true
      ).kind
    ).to.equal('UpdateHookManager')
    expect(classifyMessage(ctx, updateManager(), true).kind).to.equal('RampGrant')
    expect(classifyMessage(ctx, updateManager(), false).kind).to.equal('UpdateManager')
    expect(classifyMessage(ctx, managerCall(addr(0x77), '0x'), true).kind).to.equal('Other')
  })
})

describe('batchOf', () => {
  it('takes the form that splits, strips a session prefix, and refuses a payload that splits both ways', () => {
    expect(batchOf(notifyPool())).to.deep.equal({ payload: notifyPool(), blockNumber: null })
    expect(batchOf(concatHex([toHex(1, { size: 2 }), notifyPool()]))).to.deep.equal({
      payload: notifyPool(),
      blockNumber: null,
    })
    expect(batchOf('0x')).to.equal(null)
    expect(batchOf(undefined)).to.equal(null)
    expect(batchOf('0x00ff')).to.equal(null)
    const cid5 = PoolId.from(5 as CentrifugeId, 7)
    const ambiguous = concatHex([byte(MessageTypeV3_3.UnauthorizeSpokeCall), poolWord(cid5), toHex(0, { size: 2 })])
    expect(() => batchOf(ambiguous)).to.throw(/splits both as filed and without a session prefix/)
  })
})

describe('MigrationSettle scope', () => {
  it("keeps the pool's batches through the activate batch and refuses a scope without the Arm", () => {
    const found = [
      batch(notifyPool(OTHER)),
      batch(updateManager()),
      batch(ARM),
      batch(FREEZE),
      batch(RESTORE),
      batch(UNLINK),
    ]
    const kept = scopeBatches(ctx, found, 'test')
    expect(kept).to.have.length(3)
    expect(kept[0]!.payload).to.equal(ARM)
    expect(kept[2]!.payload).to.equal(RESTORE)
    expect(() => scopeBatches(ctx, [batch(FREEZE)], 'test')).to.throw(/no batch carrying pool .* Arm step/)
  })

  it("skips the pool's unreadable v3.2 payloads before the Arm, and refuses one after it", () => {
    const kept = scopeBatches(ctx, [null, null, batch(ARM), batch(FREEZE)], 'test')
    expect(kept.map((b) => b.payload)).to.deep.equal([ARM, FREEZE])
    expect(() => scopeBatches(ctx, [null, batch(ARM), null, batch(FREEZE)], 'test')).to.throw(
      /\[GAP\] 1 executed payload\(s\) toward cid 2 after the Arm carry no batch/
    )
    expect(scopeBatches(ctx, [batch(ARM), batch(RESTORE), null], 'test')).to.have.length(2)
  })

  it('holds the scope to the hub relayed records, copy for copy', () => {
    const batches = [batch(ARM), batch(FREEZE), batch(FREEZE)]
    const armHash = keccak256(stepPayload(MIGRATION_STEP.arm)) as HexString
    const freezeHash = keccak256(stepPayload(MIGRATION_STEP.freeze, 1)) as HexString
    expect(relayedGap(ctx, batches, [armHash, freezeHash, freezeHash], 'test')).to.equal(null)
    expect(relayedGap(ctx, batches, [armHash, freezeHash, freezeHash, freezeHash], 'test')).to.match(
      /relayed 1 step\(s\).*re-sent copy of a step that executed, still in flight/
    )
    expect(
      relayedGap(
        ctx,
        batches,
        [armHash, freezeHash, freezeHash, keccak256(stepPayload(MIGRATION_STEP.unlinkVaults)) as HexString],
        'test'
      )
    ).to.match(/a batch still in flight/)
    expect(relayedGap(ctx, batches, [armHash], 'test')).to.match(
      /2 step\(s\) executed in test are not in the hub's StepRelayed records/
    )
  })
})

describe('MigrationSettle classification', () => {
  it('reads a step refusal by phase, generation and the one-shot and early tables', () => {
    expect(classify(park(ARM, facade('WrongSpokePhase')), 1, 0, [])).to.equal('dead')
    expect(classify(park(ARM, facade('WrongSpokePhase')), 0, 0, [])).to.equal('waiting')
    expect(classify(park(UNLINK, facade('WrongSpokePhase')), 1, 1, [])).to.equal('dead')
    expect(classify(park(UNLINK, facade('WrongSpokePhase')), 1, 0, [])).to.equal('waiting')
    expect(classify(park(UNLINK, facade('WrongSpokePhase')), 3, 1, [])).to.equal('dead')
    expect(classify(park(FREEZE, facade('WrongSpokePhase')), 2, 1, [])).to.equal('dead')
    expect(classify(park(FREEZE, facade('WrongSpokePhase')), 2, 0, [0])).to.equal('waiting')
    expect(classify(park(FINALIZE, facade('CountersIncomplete')), 2, 1, [])).to.equal('waiting')
    expect(classify(park(FINALIZE, facade('StaleFreezeGeneration')), 2, 1, [])).to.equal('dead')
    expect(classify(park(step(MIGRATION_STEP.linkTokens), facade('TokenAlreadyLinked')), 3, 1, [])).to.equal('dead')
    expect(classify(park(step(MIGRATION_STEP.linkTokens), facade('WrongSpokePhase')), 4, 1, [])).to.equal('dead')
    expect(classify(park(step(MIGRATION_STEP.linkTokens), '0xdeadbeef'), 3, 1, [])).to.equal('blocking')
    expect(classify(park(FINALIZE, '0x'), 2, 1, [])).to.equal('waiting')
  })

  it('reads a non-step refusal: a duplicate link and an older price are dead, an unknown one dormant', () => {
    expect(classify(park(updateVault(1), sel(REGISTRY, 'AlreadyLinkedVault')), 4, 1, [])).to.equal('dead')
    expect(classify(park(updateVault(2), sel(REGISTRY, 'AlreadyLinkedVault')), 4, 1, [])).to.equal('dormant')
    expect(classify(park(pricePerShare(), sel(REGISTRY, 'CannotSetOlderPrice')), 4, 1, [])).to.equal('dead')
    expect(classify(park(updateVault(1), sel(REGISTRY, 'UnknownVault')), 4, 1, [])).to.equal('waiting')
    expect(classify(park(updateManager(), '0xdeadbeef'), 4, 1, [])).to.equal('dormant')
  })

  it('reads an Abort as dormant while it can land and dead once its generation is past', () => {
    expect(classify(park(ABORT, '0x', { wouldLand: true }), 2, 1, [])).to.equal('dormant')
    expect(classify(park(ABORT, facade('StaleFreezeGeneration')), 2, 2, [])).to.equal('dead')
    expect(classify(park(ABORT, facade('WrongSpokePhase')), 3, 1, [])).to.equal('dead')
    expect(classify(park(ABORT, '0xdeadbeef'), 2, 1, [])).to.equal('dormant')
  })

  it('names the facade, registry and gateway errors behind a refusal', () => {
    expect(describeSettleRevert(facade('CountersIncomplete'))).to.match(/^V33Migration\.CountersIncomplete, raw/)
    expect(describeSettleRevert(sel(REGISTRY, 'UnknownVault'))).to.match(/^SpokeRegistry\.UnknownVault/)
    expect(describeSettleRevert(sel(ABIS_V3_3.Gateway as unknown as Abi, 'NotFailedMessage'))).to.match(
      /^IGateway\.NotFailedMessage/
    )
    expect(describeSettleRevert('0x')).to.match(/empty revert/)
    expect(describeSettleRevert('0xdeadbeef')).to.match(/revert 0xdeadbeef/)
  })
})

describe('settleRun', () => {
  it('counts parks per hash, retries them in send order and keeps a retry that needs its predecessor for the pass after it', async () => {
    const d = driver({
      failed: { [hashOf(UNLINK)]: 1, [hashOf(ROTATE)]: 1, [hashOf(FINALIZE)]: 1 },
      retry: (message, after) => {
        if (message === UNLINK) return { ok: true, revert: '0x' }
        if (message === ROTATE)
          return after.includes(UNLINK)
            ? { ok: true, revert: '0x' }
            : { ok: false, revert: facade('CountersIncomplete') }
        return { ok: false, revert: facade('CountersIncomplete') }
      },
    })
    const report = await settleRun(ctx, [batch(ARM), batch(FREEZE), batch(FINALIZE, ROTATE, UNLINK)], d)
    expect(report.messages).to.equal(5)
    expect(report.parks.map((p) => p.message.kind)).to.deep.equal(['UnlinkVaults', 'RotateAssets', 'FinalizeOffboard'])
    expect(report.retries.map((k) => report.parks[k]!.message.kind)).to.deep.equal(['UnlinkVaults', 'RotateAssets'])
    expect(report.passes).to.equal(2)
    expect(report.waiting).to.equal(3)
    expect(report.parks[2]!.class).to.equal('waiting')
    expect(report.parks[2]!.action).to.match(/wait: settle again once its predecessor has landed/)
    expect(report.parks[0]!.action).to.equal('retry #1, lands in pass 1')
    expect(d.retries.find((r) => r.message === ROTATE && r.after.length === 1)).to.not.equal(undefined)
    expect(settled(report)).to.equal(false)
    expect(replanRefusal(report)).to.match(/3 waiting and 0 dormant/)
  })

  it('never retries an Abort that can land, holds the steps of its generation behind it and leaves them dormant', async () => {
    const d = driver({
      failed: { [hashOf(ABORT)]: 1, [hashOf(FREEZE)]: 1, [hashOf(UNLINK)]: 1 },
      retry: (message) =>
        message === ABORT ? { ok: true, revert: '0x' } : { ok: false, revert: facade('WrongSpokePhase') },
    })
    const report = await settleRun(ctx, [batch(ARM), batch(FREEZE), batch(ABORT), batch(UNLINK)], d)
    const byKind = Object.fromEntries(report.parks.map((p) => [p.message.kind, p]))
    expect(byKind.Abort!.class).to.equal('dormant')
    expect(byKind.Abort!.wouldLand).to.equal(true)
    expect(byKind.Abort!.action).to.match(/not retried: retry it to abort/)
    expect(byKind.Freeze!.held).to.equal(true)
    expect(byKind.Freeze!.class).to.equal('dormant')
    expect(byKind.UnlinkVaults!.held).to.equal(true)
    expect(byKind.UnlinkVaults!.action).to.match(/held behind a live Abort/)
    expect(d.retries.filter((r) => r.message !== ABORT)).to.deep.equal([])
    expect(report.retries).to.deep.equal([])
    expect(report.dormant).to.equal(3)
    expect(dormantLeft(report, [keccak256(FREEZE) as HexString])).to.equal(3)
    expect(settled(report, [keccak256(FREEZE) as HexString])).to.equal(false)
  })

  it('accepts a named dormant park, classes a duplicate link dead and refuses a paused gateway', async () => {
    const link = updateVault(1)
    const grant = updateManager()
    const d = driver({
      failed: { [hashOf(link)]: 1, [hashOf(grant)]: 1 },
      retry: (message) => ({
        ok: false,
        revert: message === link ? sel(REGISTRY, 'AlreadyLinkedVault') : '0xdeadbeef',
      }),
      phase: 4,
    })
    const report = await settleRun(
      ctx,
      [batch(ARM), batch(notifyPool(), grant), batch(step(MIGRATION_STEP.linkTokens), link)],
      d
    )
    const byKind = Object.fromEntries(report.parks.map((p) => [p.message.kind, p]))
    expect(report.onboardHubSent).to.equal(true)
    expect(byKind.UpdateVault!.duplicate).to.equal(true)
    expect(byKind.UpdateVault!.class).to.equal('dead')
    expect(byKind.UpdateManager!.class).to.equal('dormant')
    expect(settled(report)).to.equal(false)
    expect(settled(report, [keccak256(grant) as HexString])).to.equal(true)
    expect(replanRefusal(report, [keccak256(grant) as HexString])).to.equal('')
    let refused = ''
    try {
      await settleRun(ctx, [batch(ARM)], driver({ paused: true }))
    } catch (error) {
      refused = (error as Error).message
    }
    expect(refused).to.match(/gateway is paused/)
    const pausedRetry = driver({
      failed: { [hashOf(UNLINK)]: 1 },
      retry: () => ({ ok: false, revert: sel(ABIS_V3_3.Gateway as unknown as Abi, 'Paused') }),
    })
    let refusedRetry = ''
    try {
      await settleRun(ctx, [batch(ARM), batch(UNLINK)], pausedRetry)
    } catch (error) {
      refusedRetry = (error as Error).message
    }
    expect(refusedRetry).to.match(/gateway is paused/)
  })
})
