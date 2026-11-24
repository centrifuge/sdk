import { MIGRATION_STEP } from '@centrifuge/protocol'
import { expect } from 'chai'
import type { HexString } from '../types/index.js'
import type { CentrifugeId } from '../utils/types.js'
import {
  openSteps,
  openStepsReason,
  PHASE_STEPS,
  spokeStepsBlock,
  stepsInFlight,
  stepsOfSpoke,
  stepsSinceLastFreeze,
  underpaidStepsReason,
  unindexedRelaysReason,
  unmatchedStepsReason,
  type MigrationStep,
  type PoolMigration,
} from './PoolMigration.js'

const SPOKE = 2 as CentrifugeId
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString

const step = (
  ordinal: number,
  landing: MigrationStep['landing'],
  over: Partial<MigrationStep> = {}
): MigrationStep => ({
  step: ordinal,
  stepName: null,
  centrifugeId: SPOKE,
  transactionHash: addr(0x1),
  logIndex: 0,
  createdAtBlock: 1,
  createdAt: new Date(0),
  payloadHash: addr(ordinal),
  gatewayMessageHash: addr(0x2),
  isSameChainStep: false,
  landing,
  messageId: null,
  messageIndex: null,
  failReason: landing === 'parked' ? 'WrongSpokePhase' : null,
  executedAtTxHash: null,
  ...over,
})

const migration = (steps: MigrationStep[], centrifugeId = SPOKE): PoolMigration =>
  ({ spokes: [{ centrifugeId, steps }] }) as unknown as PoolMigration

describe('spoke steps', () => {
  it('finds the steps of one spoke, none for a missing spoke or a pool that never armed', () => {
    const steps = [step(MIGRATION_STEP.arm, 'landed')]
    expect(stepsOfSpoke(migration(steps), SPOKE)).to.deep.equal(steps)
    expect(stepsOfSpoke(migration(steps), 3 as CentrifugeId)).to.deep.equal([])
    expect(stepsOfSpoke(null, SPOKE)).to.deep.equal([])
  })

  it('keeps the steps from the last freeze on, so an aborted generation never blocks the next', () => {
    const steps = [
      step(MIGRATION_STEP.arm, 'landed'),
      step(MIGRATION_STEP.freeze, 'landed'),
      step(MIGRATION_STEP.unlinkVaults, 'inFlight'),
      step(MIGRATION_STEP.abort, 'landed'),
      step(MIGRATION_STEP.freeze, 'landed'),
      step(MIGRATION_STEP.unlinkVaults, 'landed'),
    ]
    expect(stepsSinceLastFreeze(steps).map((s) => s.landing)).to.deep.equal(['landed', 'landed'])
    expect(stepsSinceLastFreeze(steps.slice(0, 1))).to.deep.equal(steps.slice(0, 1))
  })

  it('counts a step open while it is in flight or unmatched, never once landed, parked, dropped or same-chain', () => {
    const steps = [
      step(MIGRATION_STEP.unlinkVaults, 'inFlight'),
      step(MIGRATION_STEP.rotateAssets, 'unmatched'),
      step(MIGRATION_STEP.removeManagers, 'landed'),
      step(MIGRATION_STEP.finalizeOffboard, 'parked'),
      step(MIGRATION_STEP.unlinkVaults, 'dropped'),
      step(MIGRATION_STEP.unlinkVaults, 'inFlight', { isSameChainStep: true }),
      step(MIGRATION_STEP.linkTokens, 'inFlight'),
    ]
    expect(openSteps(steps, PHASE_STEPS.offboard).map((s) => s.landing)).to.deep.equal(['inFlight', 'unmatched'])
    expect(openSteps(steps, PHASE_STEPS.onboardSpokes)).to.have.length(1)
    expect(openSteps(steps, PHASE_STEPS.freeze)).to.have.length(0)
  })

  it('explains the steps in flight and the unmatched ones apart, and names the manual-delivery case', () => {
    const open = [
      step(MIGRATION_STEP.unlinkVaults, 'inFlight', { stepName: 'unlinkVaults', transactionHash: addr(0xaa) }),
      step(MIGRATION_STEP.rotateAssets, 'unmatched'),
    ]
    const inFlight = openStepsReason(open)
    expect(inFlight).to.match(/^unlinkVaults relayed in 0x0+aa is still in flight\. The spoke reads unchanged/)
    expect(inFlight).to.match(/deliver it by hand if it was a manual-delivery batch, then re-plan$/)
    expect(inFlight).to.not.match(/gateway message/)
    const unmatched = unmatchedStepsReason(open)
    expect(unmatched).to.match(
      /^step 4 relayed in .* has no gateway message matched to it\. Whether it landed is unknown/
    )
    expect(unmatched).to.match(/check the spoke chain before signing the same step again$/)
    expect(openStepsReason([open[1]!])).to.equal('')
    expect(unmatchedStepsReason([open[0]!])).to.equal('')
  })

  it('stops on a park or a step in flight of the phase since the last freeze, warns on an unmatched one', () => {
    const none = { stop: '', warning: '', parked: false, underpaid: false }
    const parked = migration([
      step(MIGRATION_STEP.unlinkVaults, 'parked'),
      step(MIGRATION_STEP.rotateAssets, 'inFlight'),
    ])
    expect(spokeStepsBlock(parked, SPOKE, 'offboard').stop).to.match(
      /^step 3 parked: WrongSpokePhase\. A parked step is retried/
    )
    expect(spokeStepsBlock(parked, SPOKE, 'offboard').parked).to.equal(true)
    expect(spokeStepsBlock(parked, SPOKE, 'freeze')).to.deep.equal(none)
    expect(spokeStepsBlock(parked, SPOKE, 'onboardSpokes')).to.deep.equal(none)
    const parkedBeforeFreeze = migration([
      step(MIGRATION_STEP.unlinkVaults, 'parked'),
      step(MIGRATION_STEP.freeze, 'landed'),
    ])
    expect(spokeStepsBlock(parkedBeforeFreeze, SPOKE, 'offboard')).to.deep.equal(none)
    const abortParked = migration([step(MIGRATION_STEP.abort, 'parked')])
    expect(spokeStepsBlock(abortParked, SPOKE, 'freeze').stop).to.match(/^step 2 parked/)
    const open = migration([step(MIGRATION_STEP.freeze, 'landed'), step(MIGRATION_STEP.unlinkVaults, 'inFlight')])
    expect(spokeStepsBlock(open, SPOKE, 'offboard').stop).to.match(/still in flight/)
    expect(spokeStepsBlock(open, SPOKE, 'offboard').warning).to.equal('')
    expect(spokeStepsBlock(open, SPOKE, 'offboard').parked).to.equal(false)
    expect(spokeStepsBlock(open, SPOKE, 'onboardSpokes')).to.deep.equal(none)
    expect(spokeStepsBlock(open, 3 as CentrifugeId, 'offboard')).to.deep.equal(none)
    expect(spokeStepsBlock(null, SPOKE, 'offboard')).to.deep.equal(none)
    const unmatched = migration([step(MIGRATION_STEP.freeze, 'landed'), step(MIGRATION_STEP.unlinkVaults, 'unmatched')])
    expect(spokeStepsBlock(unmatched, SPOKE, 'offboard').stop).to.equal('')
    expect(spokeStepsBlock(unmatched, SPOKE, 'offboard').warning).to.match(/no gateway message matched/)
    const armOpen = migration([step(MIGRATION_STEP.arm, 'inFlight'), step(MIGRATION_STEP.freeze, 'unmatched')])
    expect(spokeStepsBlock(armOpen, SPOKE, 'freeze')).to.deep.equal(none)
    const landed = migration([step(MIGRATION_STEP.freeze, 'landed'), step(MIGRATION_STEP.unlinkVaults, 'landed')])
    expect(spokeStepsBlock(landed, SPOKE, 'offboard')).to.deep.equal(none)
  })

  it('stops on a step held in an underpaid batch, names repay, and never counts it as in flight', () => {
    const held = migration([
      step(MIGRATION_STEP.freeze, 'landed'),
      step(MIGRATION_STEP.unlinkVaults, 'underpaid', { stepName: 'unlinkVaults', transactionHash: addr(0xab) }),
      step(MIGRATION_STEP.rotateAssets, 'inFlight'),
    ])
    const open = openSteps(held.spokes[0]!.steps, PHASE_STEPS.offboard)
    expect(open.map((s) => s.landing)).to.deep.equal(['underpaid', 'inFlight'])
    const reason = underpaidStepsReason(open)
    expect(reason).to.match(/^unlinkVaults relayed in 0x0+ab sits in a batch the hub Gateway holds underpaid\./)
    expect(reason).to.match(/repay it with centrifuge\.repayBatch/)
    expect(reason).to.match(/a second repay is refused before signing$/)
    expect(underpaidStepsReason([open[1]!])).to.equal('')
    const block = spokeStepsBlock(held, SPOKE, 'offboard')
    expect(block.stop).to.equal(reason)
    expect(block).to.include({ parked: false, underpaid: true })
    expect(stepsInFlight(held)).to.deep.equal([{ centrifugeId: SPOKE, stepName: 'step 4' }])
    expect(spokeStepsBlock(held, SPOKE, 'onboardSpokes')).to.deep.equal({
      stop: '',
      warning: '',
      parked: false,
      underpaid: false,
    })
    const parkedToo = migration([
      step(MIGRATION_STEP.freeze, 'landed'),
      step(MIGRATION_STEP.unlinkVaults, 'parked'),
      step(MIGRATION_STEP.rotateAssets, 'underpaid', { stepName: 'rotateAssets', transactionHash: addr(0xac) }),
    ])
    const both = spokeStepsBlock(parkedToo, SPOKE, 'offboard')
    expect(both.stop).to.match(
      /^step 3 parked: WrongSpokePhase\. A parked step is retried.*\. rotateAssets relayed in 0x0+ac sits in a batch the hub Gateway holds underpaid/
    )
    expect(both).to.include({ parked: true, underpaid: true })
  })

  it('names the steps in flight for the next action, same-chain ones apart', () => {
    const steps = [
      step(MIGRATION_STEP.unlinkVaults, 'inFlight', { stepName: 'unlinkVaults' }),
      step(MIGRATION_STEP.rotateAssets, 'inFlight', { isSameChainStep: true }),
      step(MIGRATION_STEP.removeManagers, 'unmatched'),
    ]
    expect(stepsInFlight(migration(steps))).to.deep.equal([{ centrifugeId: SPOKE, stepName: 'unlinkVaults' }])
    expect(stepsInFlight(null)).to.deep.equal([])
  })

  it('names a hub relay the indexer has not written yet, and nothing when every relay is indexed', () => {
    const indexed = [step(MIGRATION_STEP.unlinkVaults, 'landed', { transactionHash: addr(0xaa), logIndex: 3 })]
    const relays = [
      { step: MIGRATION_STEP.unlinkVaults, transactionHash: addr(0xaa), logIndex: 3, blockNumber: 10 },
      { step: MIGRATION_STEP.rotateAssets, transactionHash: addr(0xbb), logIndex: 1, blockNumber: 12 },
    ]
    const reason = unindexedRelaysReason(relays, indexed)
    expect(reason).to.match(/^rotateAssets relayed in 0x0+bb at hub block 12 is not in the indexer yet/)
    expect(reason).to.match(/Wait for the indexer to catch up, then re-plan$/)
    expect(unindexedRelaysReason(relays.slice(0, 1), indexed)).to.equal('')
    expect(unindexedRelaysReason([], [])).to.equal('')
  })
})
