import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  isAddressEqual,
  parseAbi,
  type PublicClient,
} from 'viem'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import { AdapterVersionMismatchError, type AdapterMismatch } from '../errors.js'
import type { HexString, ProtocolContracts } from '../types/index.js'
import type { CentrifugeId, PoolId } from './types.js'

/**
 * Every adapter since v3.1 is bound at deployment to one MultiAdapter and exposes it as `entrypoint()`. No
 * version's ABI set carries an adapter ABI, and the getter is the same in all of them, so it is declared here.
 */
const ADAPTER_ENTRYPOINT_ABI = parseAbi(['function entrypoint() view returns (address)'])

/**
 * The adapter addresses a protocol context lists. `layerZeroAdapter` is in every deployment; the others are
 * `undefined` where the registry lists none, which includes bridges it does not ship, such as v3.2's Wormhole, and
 * `hyperlaneAdapter` before v3.3.
 * @internal
 */
export function deployedAdapterAddresses({
  axelarAdapter,
  wormholeAdapter,
  layerZeroAdapter,
  chainlinkAdapter,
  hyperlaneAdapter,
}: ProtocolContracts) {
  return { axelarAdapter, wormholeAdapter, layerZeroAdapter, chainlinkAdapter, hyperlaneAdapter }
}

type AdapterUpdate = { centrifugeId: CentrifugeId; localAdapters: HexString[]; remoteAdapters: HexString[] }

/** What a chain answers for one address: no contract, a contract without an entrypoint, or the entrypoint. */
type EntrypointAnswer = { reason: 'noCode' | 'noEntrypoint' } | { entrypoint: HexString }

/**
 * Refuses an adapter set that names an adapter of another protocol version than the pool's: each local adapter's
 * `entrypoint()` must be the pool's version's MultiAdapter on the hub, and each remote adapter's the MultiAdapter of
 * the hub's version on the target, whatever the target's migration phase: the hub's `SetPoolAdapters` lands there.
 * The MultiAdapter accepts any address in `setAdapters`, but an adapter only sends for its own entrypoint,
 * so a mismatch reverts every message of the pool on that route with `NotEntrypoint`. Reading the entrypoint, not
 * the registry, also accepts adapters the registry does not list, such as v3.2's Wormhole adapter.
 *
 * Each chain is read once: its code first, so an address with no contract is told apart from a contract that is not
 * an adapter, then the entrypoint. The verdicts are only as current as each chain's RPC. A failed read is thrown as
 * it is, and so are a target without a client and a target where the hub's version is not deployed
 * (`ProtocolVersionResolutionError`). Every refused adapter is reported in one `AdapterVersionMismatchError`.
 * @internal
 */
export async function assertPoolVersionAdapters(
  root: Centrifuge,
  hubCtx: SdkProtocolContext,
  poolId: PoolId,
  updates: readonly AdapterUpdate[]
) {
  const addressesByChain = new Map<CentrifugeId, Set<HexString>>()
  const add = (centrifugeId: CentrifugeId, adapters: readonly HexString[]) => {
    const set = addressesByChain.get(centrifugeId) ?? new Set<HexString>()
    for (const adapter of adapters) set.add(adapter.toLowerCase() as HexString)
    addressesByChain.set(centrifugeId, set)
  }
  for (const { centrifugeId, localAdapters, remoteAdapters } of updates) {
    add(poolId.centrifugeId, localAdapters)
    add(centrifugeId, remoteAdapters)
  }

  const chains = new Map(
    await Promise.all(
      [...addressesByChain].map(async ([centrifugeId, addresses]) => {
        const [ctx, client] = await Promise.all([
          centrifugeId === poolId.centrifugeId ? hubCtx : root._poolContextAtHubVersion(poolId, centrifugeId),
          root.getClient(centrifugeId),
        ])
        const answers = await Promise.all(
          [...addresses].map(async (address) => [address, await readEntrypoint(client, address)] as const)
        )
        return [centrifugeId, { multiAdapter: ctx.multiAdapter, answers: new Map(answers) }] as const
      })
    )
  )

  const mismatches: AdapterMismatch[] = []
  for (const { centrifugeId: target, localAdapters, remoteAdapters } of updates) {
    for (const [side, centrifugeId, adapters] of [
      ['local', poolId.centrifugeId, localAdapters],
      ['remote', target, remoteAdapters],
    ] as const) {
      const { multiAdapter, answers } = chains.get(centrifugeId)!
      for (const adapter of adapters) {
        const answer = answers.get(adapter.toLowerCase() as HexString)!
        if ('entrypoint' in answer && isAddressEqual(answer.entrypoint, multiAdapter)) continue
        const base = { targetCentrifugeId: target, centrifugeId, side, adapter, multiAdapter }
        if (!('entrypoint' in answer)) {
          mismatches.push({ ...base, reason: answer.reason, entrypoint: null, adapterProtocolVersion: null })
          continue
        }
        const adapterProtocolVersion = await versionOfMultiAdapter(root, centrifugeId, answer.entrypoint)
        mismatches.push({
          ...base,
          reason: adapterProtocolVersion ? 'otherVersion' : 'unknownEntrypoint',
          entrypoint: answer.entrypoint,
          adapterProtocolVersion,
        })
      }
    }
  }
  const [first, ...rest] = mismatches
  if (!first) return

  throw new AdapterVersionMismatchError(
    `Pool ${poolId} runs protocol version ${hubCtx.protocolVersion}, and ${mismatches.length === 1 ? 'an adapter' : `${mismatches.length} adapters`} ` +
      `cannot carry its messages: ${mismatches.map((m) => describe(m, poolId)).join('; ')}.`,
    { poolId: poolId.toString(), protocolVersion: hubCtx.protocolVersion, mismatches: [first, ...rest] }
  )
}

async function readEntrypoint(
  client: { getCode: PublicClient['getCode']; readContract: PublicClient['readContract'] },
  address: HexString
): Promise<EntrypointAnswer> {
  const code = await client.getCode({ address })
  if (!code || code === '0x') return { reason: 'noCode' }
  try {
    return {
      entrypoint: await client.readContract({ address, abi: ADAPTER_ENTRYPOINT_ABI, functionName: 'entrypoint' }),
    }
  } catch (error) {
    if (error instanceof BaseError && error.walk((e) => isNoAnswer(e)) !== null) return { reason: 'noEntrypoint' }
    throw error
  }
}

function describe(m: AdapterMismatch, poolId: PoolId) {
  const why = {
    noCode: `the RPC of centrifugeId ${m.centrifugeId} finds no contract there`,
    noEntrypoint: `the contract answers no entrypoint(), so it is not an adapter`,
    otherVersion: `it belongs to protocol version ${m.adapterProtocolVersion} (its entrypoint is that version's MultiAdapter ${m.entrypoint})`,
    unknownEntrypoint: `it sends for MultiAdapter ${m.entrypoint}, which no protocol version in the address book deploys there`,
  }[m.reason]
  const read =
    m.side === 'local'
      ? `pool.globalAdapters(${m.targetCentrifugeId})`
      : `pool.remoteGlobalAdapters(${m.targetCentrifugeId})`
  return (
    `${m.side} adapter ${m.adapter} on centrifugeId ${m.centrifugeId} for the route to centrifugeId ` +
    `${m.targetCentrifugeId}: ${why}; the pool's MultiAdapter there is ${m.multiAdapter}, and ${read} lists the ` +
    `${m.side} adapters pool ${poolId} may use`
  )
}

/** A call that reverted or returned no data: the contract answers no `entrypoint()`. */
function isNoAnswer(error: unknown) {
  return error instanceof ContractFunctionRevertedError || error instanceof ContractFunctionZeroDataError
}

/**
 * The version whose MultiAdapter on the chain is `multiAdapter`. A mismatch's entrypoint is never the pool's own
 * MultiAdapter, and no two versions in the address book share one on a chain, so at most one version matches.
 */
async function versionOfMultiAdapter(root: Centrifuge, centrifugeId: CentrifugeId, multiAdapter: HexString) {
  const { registry } = await root._addressBook()
  const { environment } = root.config
  return (
    registry.versionsForChain(environment, centrifugeId).find((version) => {
      const own = registry.getDeployment(environment, version, centrifugeId).contracts.multiAdapter
      return own !== undefined && isAddressEqual(own, multiAdapter)
    }) ?? null
  )
}
