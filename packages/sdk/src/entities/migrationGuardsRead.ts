import {
  HUB_PHASE,
  resolveMigrationChain,
  SPOKE_PHASE,
  type HubPhaseName,
  type SpokePhaseName,
} from '@centrifuge/protocol'
import { firstValueFrom } from 'rxjs'
import { type Abi, type PublicClient } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { CentrifugeId } from '../utils/types.js'
import {
  entryLanding,
  guardRows,
  type GuardRow,
  type GuardSnapshot,
  type GuardSpokeSnapshot,
} from './MigrationGuards.js'
import { deriveMigrationSpokeInputs } from './migrationInputsRead.js'
import type { MigrationPlan } from './MigrationPlan.js'
import { rampRegistrationsOf, unindexedRelaysOf } from './migrationPlanRead.js'
import type { Pool } from './Pool.js'
import type { PoolMigration } from './PoolMigration.js'

export type MigrationGuardsOptions = {
  /** The account that will sign the entry; omitted, the operator and hub-manager guards cannot pass. */
  signer?: HexString
  /** The plan's `ignoreStepsInFlight`: a step still in flight for the indexer, or a relay it has not written yet, is an informational row instead of a refusal. A parked step still refuses. */
  ignoreStepsInFlight?: boolean
  sentWith?: readonly number[]
}

const HUB_PHASES = Object.entries(HUB_PHASE) as [HubPhaseName, number][]
const SPOKE_PHASES = Object.entries(SPOKE_PHASE) as [SpokePhaseName, number][]
const hubPhaseName = (value: number): HubPhaseName => HUB_PHASES.find(([, v]) => v === value)?.[0] ?? 'none'
const spokePhaseName = (value: number): SpokePhaseName => SPOKE_PHASES.find(([, v]) => v === value)?.[0] ?? 'none'

async function facadeReads(
  client: PublicClient,
  migration: HexString,
  abi: Abi,
  calls: { functionName: string; args?: readonly unknown[] }[]
) {
  const results = (await client.multicall({
    contracts: calls.map((call) => ({
      address: migration,
      abi,
      functionName: call.functionName,
      args: call.args ?? [],
    })) as any,
    allowFailure: false,
  })) as unknown[]
  return results
}

/** @internal */
export async function readGuardSnapshot(
  root: Centrifuge,
  pool: Pool,
  plan: MigrationPlan,
  index: number,
  options: MigrationGuardsOptions,
  migration: PoolMigration | null
): Promise<GuardSnapshot> {
  const entry = plan.entries[index]
  if (!entry) throw new Error(`plan has no entry #${index}`)
  const hub = pool.centrifugeId
  const hubChain = resolveMigrationChain(hub, { environment: root.config.environment })
  const [hubClient, ctx32] = await Promise.all([
    firstValueFrom(root.getClient(hub)) as Promise<PublicClient>,
    firstValueFrom(root.protocolContext(pool.id)),
  ])
  const hubAbi = hubChain.abi as unknown as Abi
  const hubBlock = await hubClient.getBlockNumber()
  const [hubPhase, hubLocked, operator, armedRaw] = await facadeReads(
    hubClient,
    hubChain.migration as HexString,
    hubAbi,
    [
      { functionName: 'hubPhase', args: [pool.id.raw] },
      { functionName: 'locked' },
      { functionName: 'operator', args: [pool.id.raw] },
      { functionName: 'armedSpokes', args: [pool.id.raw] },
    ]
  )
  const armedSpokes = (armedRaw as readonly number[]).map((cid) => cid as CentrifugeId)
  const signer = options.signer ?? null
  let signerIsHubManager: boolean | null = null
  if (signer) {
    const hubRegistry = (ctx32 as unknown as { hubRegistry?: HexString }).hubRegistry
    if (hubRegistry) {
      signerIsHubManager = Boolean(
        await hubClient.readContract({
          address: hubRegistry,
          abi: ctx32.contractAbis.HubRegistry,
          functionName: 'manager',
          args: [pool.id.raw, signer],
        })
      )
    }
  }
  const concerned = new Set<CentrifugeId>([entry.concerns, ...entry.destinations, ...armedSpokes, hub])
  for (let k = 0; k < index; k++) concerned.add(plan.entries[k]!.executeOn)
  const spokes: Partial<Record<CentrifugeId, GuardSpokeSnapshot>> = {}
  for (const cid of concerned) {
    const chain = cid === hub ? hubChain : resolveMigrationChain(cid, { environment: root.config.environment })
    const client = cid === hub ? hubClient : ((await firstValueFrom(root.getClient(cid))) as PublicClient)
    const abi = chain.abi as unknown as Abi
    const block = cid === hub ? hubBlock : await client.getBlockNumber()
    const [phase, frozenGeneration, locked, installed] = await facadeReads(client, chain.migration as HexString, abi, [
      { functionName: 'spokePhase', args: [pool.id.raw] },
      { functionName: 'frozenGeneration', args: [pool.id.raw] },
      { functionName: 'locked' },
      { functionName: 'poolAdaptersInstalled', args: [pool.id.raw, hub] },
    ])
    const [hubFreezeGeneration] = await facadeReads(hubClient, hubChain.migration as HexString, hubAbi, [
      { functionName: 'freezeGeneration', args: [pool.id.raw, cid] },
    ])
    spokes[cid] = {
      phase: spokePhaseName(Number(phase)),
      frozenGeneration: Number(frozenGeneration),
      hubFreezeGeneration: Number(hubFreezeGeneration),
      locked: Boolean(locked),
      installedTowardHub: Boolean(installed),
      block,
    }
  }
  const rampIdsPending: Partial<Record<CentrifugeId, number>> = {}
  for (const destination of entry.destinations) {
    const owes = plan.entries
      .slice(0, index)
      .some((earlier) => earlier.operation === null && earlier.executeOn === destination)
    if (!owes || destination === hub) continue
    const inputs = await deriveMigrationSpokeInputs(root, pool.id, destination)
    rampIdsPending[destination] = (await rampRegistrationsOf(root, pool.id, destination, inputs)).tokenIds.length
  }
  const unindexedRelays: Partial<Record<CentrifugeId, string>> = {}
  if (entry.concerns !== hub) {
    const reason = await unindexedRelaysOf(root, pool.id, migration, entry.concerns, hubClient)
    if (reason) unindexedRelays[entry.concerns] = reason
  }
  return {
    hubPhase: hubPhaseName(Number(hubPhase)),
    hubLocked: Boolean(hubLocked),
    hubBlock,
    operator: operator as HexString,
    armedSpokes,
    signer,
    signerIsHubManager,
    spokes,
    rampIdsPending,
    unindexedRelays,
  }
}

/** The hub block the plan was derived at: relays before it belong to earlier generations or slices. */
export function planBlock(plan: MigrationPlan): number | null {
  const hub = plan.chains.find((chain) => chain.centrifugeId === plan.hubCentrifugeId)
  return hub ? Number(hub.block) : null
}

/** @internal */
export async function deriveMigrationGuards(
  root: Centrifuge,
  pool: Pool,
  plan: MigrationPlan,
  index: number,
  options: MigrationGuardsOptions = {}
): Promise<GuardRow[]> {
  const migration = await firstValueFrom(pool.migration())
  const snapshot = await readGuardSnapshot(root, pool, plan, index, options, migration)
  const sinceBlock = planBlock(plan)
  return guardRows(
    plan,
    index,
    snapshot,
    migration,
    (k) => entryLanding(plan.entries[k]!, migration, sinceBlock).state,
    { ignoreStepsInFlight: options.ignoreStepsInFlight, sentWith: options.sentWith }
  )
}
