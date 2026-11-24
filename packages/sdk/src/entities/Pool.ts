import {
  catchError,
  combineLatest,
  concat,
  defer,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  switchMap,
  takeWhile,
  timeout,
} from 'rxjs'
import { encodeFunctionData, fromHex, getContract, keccak256, toHex } from 'viem'
import {
  ABIS_V3_3,
  assertDeployedContractVersion,
  builders,
  encodeOracleValuationFeederPayload,
  ProtocolVersionResolutionError,
  UnsupportedForProtocolVersionError,
  type ContractAbis,
  type MigrationAction,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import type {
  CrosschainMessageRow,
  PoolAdapterRow,
  PoolManagerRow,
  PoolMigrationRow,
  PoolMigrationStepRow,
} from '@centrifuge/queries/core'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { PoolMetadataInput, ShareClassInput } from '../types/poolInput.js'
import { isLegacyPoolMetadata, PoolMetadata, PoolMetadataV2, WorkflowPolicyEntry } from '../types/poolMetadata.js'
import type { Query } from '../types/query.js'
import {
  MessageType,
  MessageTypeV3_3,
  MessageTypeWithSubType,
  messageV3_3,
  type OperationOutOfPolicyStatus,
  Transaction,
  TransactionContext,
} from '../types/transaction.js'
import { assertPoolVersionAdapters, deployedAdapterAddresses } from '../utils/adapters.js'
import {
  assertAuthorizationCalldata,
  assertDistinctCalldata,
  encodeInitiateAuthorization,
} from '../utils/authorizationCalldata.js'
import type { PoolAuthorizationList } from '../utils/authorizationFold.js'
import { NATIONAL_CURRENCY_METADATA } from '../utils/currencies.js'
import { migratePoolMetadataToV2, parsePoolMetadataV2 } from '../utils/poolMetadataMigration.js'
import {
  addMessageForEnabledTarget,
  filterCrosschainEnabledTargets,
  isCrosschainMessagingDisabled,
} from '../utils/crosschainHotfix.js'
import { peekHubCall } from '../utils/hubCallMessages.js'
import { isSetAdapters } from '../utils/hubExecutionRules.js'
import { settlesOrders } from '../utils/orderSettlements.js'
import { addressToBytes32, generateShareClassSalt } from '../utils/index.js'
import { builderContext, encodeHubManagerCall, isV3_3, poolEscrowAt } from '../utils/protocolVersion.js'
import { repeatOnEvents } from '../utils/rx.js'
import {
  assertNotBatching,
  outOfPolicyStatus,
  sendCallsInOrder,
  valueWithMessageFees,
  wrapTransaction,
} from '../utils/transaction.js'
import { AssetId, CentrifugeId, PoolId, ShareClassId } from '../utils/types.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import type { PoolActionName } from '../tx/TxStrategy.js'
import type { MigrationGateAnswer } from '../utils/migrationGate.js'
import {
  computeWorkflowGroupScriptHashes,
  resolveWorkflowShareClassId,
  type PolicyEntryInput,
} from '../utils/workflowExecute.js'
import { Basin } from './Basin.js'
import { Entity } from './Entity.js'
import { CLAIMS_METHOD, noSettlementError, planClaims } from './claimsAfterExecution.js'
import { describeGroup, parseGroup, planGroup } from './hubExecution.js'
import { parseSchedule, planSchedule } from './hubScheduling.js'
import {
  readAuthorizations,
  readHubExecutionPolicy,
  refreshHubPolicyReads,
  type HubExecutionPolicy,
} from './hubPolicyRead.js'
import {
  assembleMigration,
  buildMigrationOperation,
  drainItemsOf,
  encodeMigrationBundle,
  messageIdsOf,
  migrationFingerprint,
  migrationOperationChain,
  migrationOperationMessages,
  migrationRelayTargets,
  migrationRecordName,
  MigrationSimulationError,
  readFacadeFlags,
  hubPhaseOfRow,
  spokeIdsOf,
  stepsInFlight,
  type MigrationDrainItem,
  type MigrationOperation,
  type MigrationRecord,
  type MigrationSendOptions,
  type PoolMigration,
} from './PoolMigration.js'
import { deriveMigrationHubInputs, deriveMigrationSpokeInputs } from './migrationInputsRead.js'
import { activeSpokesOf, migrationSpokeCandidates, type MigrationSpokeCandidates } from './migrationSpokes.js'
import { deriveMigrationPlan, migrationPlanKey, rampIdsOf, type MigrationPlanOptions } from './migrationPlanRead.js'
import type { MigrationRampId } from './migrationLanes.js'
import {
  deriveMigrationClaimables,
  deriveMigrationPreCheck,
  migrationPreCheckKey,
  type MigrationPreCheckOptions,
} from './migrationPreCheckRead.js'
import type { MigrationClaimables, PreCheckReport } from './MigrationPreCheck.js'
import { deriveMigrationGuards, type MigrationGuardsOptions } from './migrationGuardsRead.js'
import { describeSettleRevert, MigrationSettleError } from './MigrationSettle.js'
import { entryLanding, type EntryLanding, type GuardRow } from './MigrationGuards.js'
import {
  deriveMigrationSettle,
  migrationSettleKey,
  routerBridgerState,
  type MigrationSettleOperation,
  type MigrationSettleOptions,
  type MigrationSettleReport,
  type RouterBridgerSpoke,
} from './migrationSettleRead.js'
import { nextActionOf, type MigrationNextAction, type MigrationPlan, type MigrationPlanEntry } from './MigrationPlan.js'
import { migrationInputsKey, type MigrationHubInputs, type MigrationInputsOptions, type MigrationSpokeInputs } from './MigrationInputs.js'
import { PoolNetwork } from './PoolNetwork.js'
import { PoolReports } from './Reports/PoolReports.js'
import { ShareClass } from './ShareClass.js'
import {
  queryCrosschainMessage,
  queryCrosschainMessages,
  type CrosschainMessageIncludes,
  type CrosschainMessagesFilter,
} from './crosschainMessages.js'

/**
 * HubRegistry declares three same-arity `decimals` overloads (`uint128` asset id, `uint256` asset,
 * `uint64` pool id), each with its own selector. viem does resolve a `bigint` argument to the
 * `uint64` overload today — it picks the narrowest matching numeric type, and throws rather than
 * widening once a value exceeds it — but that is an implicit, value-range-dependent choice for a
 * call whose selector must not move. Narrow the registered ABI to the pool-id overload instead, so
 * the selection is explicit and the signature still has one source of truth.
 */
const poolDecimalsAbi = (abis: ContractAbis) =>
  abis.HubRegistry.filter(
    (item) => item.type === 'function' && item.name === 'decimals' && item.inputs[0]?.type === 'uint64'
  )

/**
 * In-flight state of a cross-chain adapter change. `'Enabled'` / `'Disabled'`
 * is the target state of a change triggered on the hub but not yet confirmed on
 * the spoke; `null` means the adapter is settled (no change in transit).
 */
export type AdapterProgress = 'Enabled' | 'Disabled' | null

/**
 * In-flight state of a cross-chain balance sheet manager grant/revoke.
 * `'CanManage'` / `'CanNotManage'` is the target state triggered on the hub but
 * not yet confirmed on the spoke; `null` means settled (no change in transit).
 */
export type ManagerProgress = 'CanManage' | 'CanNotManage' | null

/** Per-manager live + in-flight state for a pool, as returned by {@link Pool.balanceSheetManagerStatus}. */
export type BalanceSheetManagerStatus = {
  address: HexString
  centrifugeId: number
  type: 'AsyncRequestManager' | 'SyncManager' | 'Custom'
  /** The live, confirmed state on the spoke chain. */
  isBalancesheetManager: boolean
  crosschainInProgress: ManagerProgress
}

/** Per-deployed-address live + in-flight balance sheet manager state, as returned by {@link PoolNetwork.onOfframpManagerStatus}. */
export type OnOfframpManagerStatus = {
  address: HexString
  centrifugeId: number
  /** The live, confirmed state on the spoke chain. */
  isBalancesheetManager: boolean
  crosschainInProgress: ManagerProgress
}

/** A network's `ShareManager` and its balance sheet grant, as returned by {@link PoolNetwork.shareManagerStatus}. */
export type ShareManagerStatus = {
  address: HexString
  /** The grant is confirmed live on the spoke chain. */
  isBalancesheetManager: boolean
  crosschainInProgress: ManagerProgress
}

/** Per-adapter live + in-flight state for a pool, as returned by {@link Pool.adapterStatus}. */
export type AdapterStatus = {
  address: HexString
  /** Indexer adapter name, e.g. `chainlink`, `layerZero`, `axelar`, `wormhole`. */
  name: string
  /** The live, confirmed state on the queried (spoke) chain. */
  isEnabled: boolean
  crosschainInProgress: AdapterProgress
}

/**
 * Reject a catalog entry that no longer matches what a policy entry pinned when it was whitelisted.
 *
 * A policy entry stores a name (`workflowRef`) plus the artifact it was approved against
 * (`workflowId`, `version`, `catalogCid`). The catalog is republished with regenerated ids, so
 * resolving by name alone let an unrelated add or remove silently re-sign a strategist's root over
 * a *different* script than the one that was reviewed — the operator sees "remove workflow B" and
 * signs a root that also re-authorizes a changed workflow A. Re-pinning has to be a deliberate act
 * ("update workflow"), not a side effect of editing a neighbour.
 *
 * Entries written before these fields existed carry no pin and are resolved by name as before.
 */
const ZERO_ROOT = `0x${'0'.repeat(64)}` as HexString

/**
 * Describes how the catalog's current definition of an entry differs from the one it was whitelisted
 * against, or null when they agree.
 *
 * `workflowId` is the catalog's hash of the definition *before* a pool's configurable values are
 * pinned in, so it identifies the definition rather than the leaf. If it has moved, the script the
 * catalog would build today is not the script the policy's root was built from.
 */
function pinnedArtifactDrift(entry: WorkflowPolicyEntry, workflow: MarketplaceWorkflow): string | null {
  if (entry.workflowId && workflow.workflowId && entry.workflowId.toLowerCase() !== workflow.workflowId.toLowerCase()) {
    return (
      `Workflow "${entry.workflowRef}" changed in the catalog since it was whitelisted ` +
      `(pinned workflowId ${entry.workflowId}, catalog has ${workflow.workflowId}).`
    )
  }

  if (entry.version != null && workflow.version != null && entry.version !== workflow.version) {
    return (
      `Workflow "${entry.workflowRef}" is pinned to catalog version ${entry.version} but the ` +
      `catalog now serves version ${workflow.version}.`
    )
  }

  return null
}

function assertPinnedArtifact(entry: WorkflowPolicyEntry, workflow: MarketplaceWorkflow): void {
  const drift = pinnedArtifactDrift(entry, workflow)
  if (drift) {
    throw new Error(`${drift} Re-pin it explicitly with an update before changing this policy.`)
  }
}

export class Pool extends Entity {
  id: PoolId

  constructor(_root: Centrifuge, id: string | bigint | PoolId) {
    super(_root, ['pool', String(id)])
    this.id = id instanceof PoolId ? id : new PoolId(id)
  }

  get centrifugeId(): CentrifugeId {
    return this.id.centrifugeId
  }

  get reports() {
    return new PoolReports(this._root, this)
  }

  /** The protocol version the pool lives on, as the indexer projects it. */
  protocolVersion() {
    return this._query(['protocolVersion'], () =>
      this._root._poolRows().pipe(
        map((rows): ProtocolVersion => {
          const row = rows.find((candidate) => this.id.equals(new PoolId(candidate.id)))
          if (!row) throw new ProtocolVersionResolutionError(`pool ${this.id}`, 'the catalogue does not list it')
          if (row.protocolVersion === null) {
            throw new ProtocolVersionResolutionError(
              `pool ${this.id}`,
              'this transport projects no protocolVersion; the public-api target does'
            )
          }
          return row.protocolVersion
        })
      )
    )
  }

  /** Where the pool stands in a protocol-version migration window; null on a transport that projects none. */
  migrationStatus() {
    return this._query(['migrationStatus'], () => this._root._poolRow(this.id).pipe(map((row) => row.migrationStatus)))
  }

  /**
   * Query the details of the pool.
   * @returns The pool metadata, id, shareClasses and currency.
   */
  details() {
    return this._query(['poolDetails', this.id.toString()], () =>
      combineLatest([this.metadata(), this.shareClasses(), this.shareClassesDetails(), this.currency()]).pipe(
        map(([metadata, shareClasses, shareClassesDetails, currency]) => {
          return {
            id: this.id,
            currency,
            metadata,
            shareClasses: shareClasses.map((sc) => ({
              shareClass: sc,
              details: shareClassesDetails.find((scDetails) => scDetails.id.equals(sc.id))!,
            })),
          }
        })
      )
    )
  }

  /**
   * The pool's metadata pointer as stored on-chain, or `null` when unset.
   *
   * This is the raw URI held in `HubRegistry.metadata` (an `ipfs://` pointer in
   * practice) with its zero padding stripped -- the same value {@link metadata}
   * resolves before fetching the document. Exposed separately for callers that
   * need to render or link the pointer itself rather than the pool metadata it
   * addresses.
   *
   * Read from the chain, not the indexer, so it cannot disagree with what
   * {@link metadata} fetched; it re-emits on `SetMetadata` like `metadata` does.
   */
  metadataUri() {
    return this._query(['metadataUri', this.id.toString()], () =>
      this.#metadataUriFromChain().pipe(
        catchError((error) => {
          console.error('Error fetching metadata URI', error)
          return of(null)
        })
      )
    )
  }

  /**
   * Shared on-chain read behind {@link metadata} and {@link metadataUri}: the
   * `HubRegistry.metadata` pointer, unpadded, `null` when empty, re-emitting on
   * `SetMetadata`. Kept private so the two public methods cannot drift into
   * reading the pointer two different ways.
   */
  #metadataUriFromChain() {
    return combineLatest([this._root.protocolContext(this.id), this._root.getClient(this.centrifugeId)]).pipe(
      switchMap(([{ hubRegistry, contractAbis: ABI, protocolVersion }, client]) =>
        defer(() => {
          return client.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'metadata',
            args: [this.id.raw],
          })
        }).pipe(
          map((hash) => {
            const ipfsUri = fromHex(hash, 'string').replace(/\0/g, '').trim()
            return ipfsUri || null
          }),
          repeatOnEvents(
            this._root,
            {
              address: hubRegistry,
              eventName: 'SetMetadata',
              filter: (events) => {
                return events.some((event) => {
                  return event.args.poolId === this.id.raw
                })
              },
            },
            this.centrifugeId,
            protocolVersion
          )
        )
      )
    )
  }

  metadata() {
    return this._query(['metadata', this.id.toString()], () =>
      this.#metadataUriFromChain().pipe(
        switchMap((ipfsUri) => {
          if (!ipfsUri) return of(null)
          return this._root._queryIPFS<PoolMetadata>(ipfsUri)
        }),
        catchError((error) => {
          console.error('Error fetching metadata', error)
          return of(null)
        })
      )
    )
  }

  shareClasses() {
    return this._query(['shareClasses'], () =>
      this._shareClassIds().pipe(map((scIds) => scIds.map((scId) => new ShareClass(this._root, this, scId.raw))))
    )
  }

  /**
   * The Grove/Basin deployment backing this pool, if it has one.
   *
   * `chainId`, `basinAddress` and `tokenId` are static deployment constants
   * the caller supplies — the projection cannot be asked which basin a pool
   * has, because nothing on the wire carries that mapping. See
   * {@link Basin} for why the reads are basin-keyed rather than pool-keyed.
   */
  basin(chainId: number, basinAddress: HexString, tokenId: string) {
    return new Basin(this._root, this, chainId, basinAddress, tokenId)
  }

  shareClass(scId: ShareClassId) {
    return this._query(['shareClass', scId.toString()], () =>
      this.shareClasses().pipe(
        map((shareClasses) => {
          const shareClass = shareClasses.find((sc) => sc.id.equals(scId))
          if (!shareClass) throw new Error(`Share class ${scId} not found`)
          return shareClass
        })
      )
    )
  }

  shareClassesDetails() {
    return this._query(['shareClassesDetails', this.id.toString()], () => {
      return this.shareClasses().pipe(
        switchMap((shareClasses) => {
          if (shareClasses.length === 0) return of([])
          return combineLatest(shareClasses.map((sc) => sc.details()))
        })
      )
    })
  }

  /**
   * Get the managers on the Hub.
   * These managers that can manage the pool, approve deposits, update prices, etc.
   */
  poolManagers() {
    return this._query(['poolManagers', this.id.toString()], () => {
      return this._managers().pipe(
        map((managers) => {
          return managers
            .filter((manager) => manager.isHubManager)
            .map((manager) => {
              return {
                address: manager.address,
              }
            })
        })
      )
    })
  }

  /**
   * Get the managers on the Balance Sheet.
   * These managers can transfer funds to and from the balance sheet.
   */
  balanceSheetManagers() {
    // Uncached on purpose: this is the set authorization checks read (`isBalanceSheetManager`), and a
    // grant or revoke lands here between a manager acting and the UI reflecting it. A stale cached
    // answer would either hide a live manager or vouch for a revoked one, so each subscriber reads
    // through. The underlying `_managers()` indexer query is itself cached, so this is not a chain
    // fetch per subscriber.
    return this._query(null, () => {
      return combineLatest([this._managers(), this._root.protocolContext(this.id)]).pipe(
        map(([managers, { asyncRequestManager, syncManager }]) => {
          return managers
            .filter((manager) => manager.isBalancesheetManager)
            .map((manager) => {
              let type = 'Custom'
              if (manager.address.toLowerCase() === asyncRequestManager.toLowerCase()) {
                type = 'AsyncRequestManager'
              } else if (manager.address.toLowerCase() === syncManager.toLowerCase()) {
                type = 'SyncManager'
              }

              return {
                address: manager.address,
                centrifugeId: manager.centrifugeId,
                type,
              }
            })
        })
      )
    })
  }

  /**
   * Check if an address is a manager of the pool.
   * @param address - The address to check
   *
   * ## What this is, and what it is not
   *
   * A READ, in both modes, and never an authorization decision the protocol or
   * the backend relies on. It filters the `poolManagers` catalogue entry, which
   * is routed onto `GET /pools/:poolId/managers` — so in backend mode the
   * answer comes from the same projection the backend's own guards read, and in
   * public mode from public-api. Its purpose is display: enabling a button,
   * showing a badge.
   *
   * It is deliberately NOT used as a pre-flight on any backend-routed write.
   * Neither the balance-sheet writes nor the manager writes carry a local
   * `isBalanceSheetManager` pre-flight, for that reason: on the backend route
   * authorization belongs to `PoolRolesGuard` and the policy engine, and
   * a client-side check ahead of them is either redundant (it agrees) or
   * misleading (it disagrees, and the caller believes the client). The local
   * `_transact` paths keep the pre-flights they have always had, because there
   * is no guard on that route at all.
   *
   * In backend mode a pool the caller cannot read THROWS rather than answering
   * `false`, which is the safe direction. Measured against the real backend:
   * 403 for a pool the caller holds no role on — including any unknown pool,
   * since `PoolRolesGuard` runs before existence is checked and there is
   * deliberately no validity oracle ahead of authorization — and 404
   * `POOL_NOT_FOUND` for a pool the caller MAY read that `chain_v1` has no row
   * for. A confident `false` in either case is exactly the plausible wrong
   * value a missing projection must never be answered with: it is
   * indistinguishable from "this address is not a manager of this pool".
   */
  isPoolManager(address: HexString) {
    const addr = address.toLowerCase()
    return this._query(['isPoolManager', this.id.toString(), addr], () => {
      return this.poolManagers().pipe(
        map((managers) => {
          return managers.some((manager) => manager.address === addr)
        })
      )
    })
  }

  /**
   * Check if an address is a Balance Sheet manager of the pool.
   * @param centrifugeId - The centrifuge ID of the network to check
   * @param address - The address to check
   *
   * Same standing as {@link isPoolManager} in backend mode — a display read
   * over the `poolManagers` catalogue entry, never a pre-flight on a
   * backend-routed write. It reads only the CONFIRMED `isBalancesheetManager`
   * flag and ignores `crosschainInProgress`: a grant the hub has signalled but
   * the spoke has not acknowledged is explicitly not yet authority, and
   * counting it would report a manager the spoke would reject.
   */
  isBalanceSheetManager(centrifugeId: CentrifugeId, address: HexString) {
    const addr = address.toLowerCase()
    return this._query(['isBalanceSheetManager', centrifugeId, this.id.toString(), addr], () => {
      return this.balanceSheetManagers().pipe(
        map((managers) => {
          return managers.some((manager) => manager.centrifugeId === centrifugeId && manager.address === addr)
        })
      )
    })
  }

  /**
   * Get all networks where a pool can potentially be deployed.
   */
  networks() {
    return this._query(['poolNetworks', this.id.toString()], () => {
      // The chain directory comes from the bundled @centrifuge/protocol
      // registry, not from an indexer read: it is version-independent
      // and must not depend on a live indexer response — same source
      // `_idToChain`/`_chainToId` use.
      return this._root
        ._chains()
        .pipe(
          map((chains) => chains.map((chain) => new PoolNetwork(this._root, this, chain.centrifugeId as CentrifugeId)))
        )
    })
  }

  /**
   * Get a specific network where a pool can potentially be deployed.
   * @param centrifugeId - The centrifuge ID of the network
   */
  network(centrifugeId: CentrifugeId) {
    return this._query(['poolNetwork', centrifugeId, this.id.toString()], () => {
      return this.networks().pipe(
        map((networks) => {
          const network = networks.find((network) => network.centrifugeId === centrifugeId)
          if (!network) throw new Error(`Network with centrifuge ID ${centrifugeId} not found`)
          return network
        })
      )
    })
  }

  /**
   * Deploy share classes to several networks from the hub.
   *
   * Signs a single transaction on protocol v3.2, and on v3.3 when every target is already wired to
   * the pool (its adapters set and delivered, as the indexer reports). On v3.3 a target that is not
   * wired needs `Hub.setAdapters`, which cannot run inside a Hub batch (see {@link PoolNetwork.deploy}),
   * so the deployments then run one network at a time. With several targets this cannot be batched
   * or built; build each network's `deploy` instead.
   * @param deployments - A list of target networks with share classes to deploy
   */
  deployToNetworks(
    deployments: {
      centrifugeId: CentrifugeId
      shareClasses: { id: ShareClassId; hook: HexString }[]
    }[]
  ) {
    if (!deployments.length) {
      throw new Error('No share classes to deploy')
    }

    const targets = deployments.filter((d) => d.shareClasses.length > 0)
    if (targets.length === 0) {
      throw new Error('No share classes to deploy')
    }

    const network = (centrifugeId: CentrifugeId) => new PoolNetwork(this._root, this, centrifugeId)
    const deploys = () => targets.map((t) => network(t.centrifugeId).deploy(t.shareClasses, []))

    if (targets.length === 1) {
      return deploys()[0]!
    }

    const self = this
    return this._root._transact((ctx) => {
      if (ctx.isBatching) {
        throw new Error(
          `Deploying pool "${self.id}" to several networks cannot be batched or built as one transaction: on ` +
            `protocol v3.3 a network that is not wired yet needs Hub.setAdapters, which cannot run inside a Hub ` +
            `batch. Batch or build each network's deploy() separately.`
        )
      }
      // The decision resolves first and the transaction is returned from the operator, in two stages: a Transaction is
      // thenable, so an async factory that returned one would await it and hand `switchMap` its final status.
      return defer(async () => {
        const hubCtx = await self._root.protocolContext(self.id)
        const wired = isV3_3(hubCtx)
          ? await Promise.all(targets.map((t) => network(t.centrifugeId)._hasPoolAdapters()))
          : []
        return wired.every(Boolean)
      }).pipe(
        switchMap((allWired) =>
          allWired
            ? self._root.batchTransactions('Deploy share classes and vaults', deploys())
            : // A network whose deploy ends out of policy stops the rest, which are never subscribed.
              concat(...deploys()).pipe(takeWhile((status) => status.type !== 'OutOfPolicy', true))
        )
      )
    }, this.centrifugeId)
  }

  /**
   * Get the networks where a pool is active. It doesn't mean that any vaults are deployed there necessarily.
   */
  activeNetworks() {
    return this._query(['poolActiveNetworks', this.id.toString()], () => {
      return this.networks().pipe(
        switchMap((networks) => {
          if (networks.length === 0) return of([])

          return combineLatest(
            networks.map((network) =>
              network.isActive().pipe(
                // Because this is fetching from multiple networks and we're waiting on all of them before returning a value,
                // we want a timeout in case one of the endpoints is too slow
                timeout({ first: 5000 }),
                catchError(() => {
                  return of(false)
                })
              )
            )
          ).pipe(map((isActive) => networks.filter((_, index) => isActive[index])))
        })
      )
    })
  }

  /**
   * Resolve a strategist's whitelisted workflows (pool policy metadata joined with the
   * marketplace catalog), grouped per chain. Chain is derived from each workflow's catalog
   * `chainId`. Each group carries the full `policy` (the Merkle proof tree for that chain).
   * @internal
   */
  async _resolveStrategistWorkflows(
    strategist: HexString,
    options?: {
      /**
       * Collect catalog drift instead of throwing on it. Only verification may do this: reporting
       * that a definition moved is its job, where for an edit the same fact must abort the rebuild
       * (the proof tree would no longer be the whitelisted one).
       */
      collectDrift?: boolean
    }
  ): Promise<{ centrifugeId: number; network: PoolNetwork; policy: PolicyEntryInput[]; drifted: string[] }[]> {
    const meta = await firstValueFrom(this.metadata())
    const group = (meta?.workflowPolicies ?? []).find(
      (policy) => policy.strategistAddress.toLowerCase() === strategist.toLowerCase()
    )
    if (!group) return []

    const catalog = await firstValueFrom(this._root.workflowMarketplace())
    const byRef = new Map<string, MarketplaceWorkflow>(catalog.map((w) => [w.workflowRef, w]))
    const networks = await firstValueFrom(this.activeNetworks())

    const byChain = new Map<
      number,
      { centrifugeId: number; network: PoolNetwork; policy: PolicyEntryInput[]; drifted: string[] }
    >()
    const idCache = new Map<number, number>()
    for (const entry of group.workflows) {
      const workflow = byRef.get(entry.workflowRef)
      if (!workflow) continue
      // The proof tree this builds has to be the whitelisted one, or a generated proof simply
      // won't verify against the on-chain root — better to say why than to fail at execution.
      const drift = options?.collectDrift ? pinnedArtifactDrift(entry, workflow) : null
      if (!options?.collectDrift) assertPinnedArtifact(entry, workflow)
      let centrifugeId = idCache.get(workflow.chainId)
      if (centrifugeId == null) {
        centrifugeId = await firstValueFrom(this._root.id(workflow.chainId))
        idCache.set(workflow.chainId, centrifugeId)
      }
      const network = networks.find((n) => n.centrifugeId === centrifugeId)
      if (!network) continue
      let bucket = byChain.get(centrifugeId)
      if (!bucket) {
        bucket = { centrifugeId, network, policy: [], drifted: [] }
        byChain.set(centrifugeId, bucket)
      }
      if (drift) bucket.drifted.push(drift)
      bucket.policy.push({
        workflow,
        configurableValues: (entry.configurableValues ?? {}) as Record<string, HexString>,
        excludedActions: entry.excludedActions ?? [],
        scId: entry.scId,
        scriptHash: entry.scriptHash,
        poolContext: entry.poolContext,
        builtWith: entry.builtWith,
      })
    }
    return [...byChain.values()]
  }

  /**
   * Check a strategist's recorded policy against the root each chain's OnchainPM enforces.
   *
   * The metadata lists what a strategist was whitelisted for; the contract holds only a Merkle root.
   * So the list proves nothing on its own — this rebuilds the root and compares, which is the only
   * way to answer "is the displayed policy the one being enforced?".
   *
   * Leaves come from recompiling each entry when that is possible. When it isn't — the catalog no
   * longer carries a ref, or `$onchainPM` cannot be resolved because a chain's deployment record has
   * no factory address, which is the case on Ethereum mainnet today — recorded `scriptHash` values
   * are used instead, and `leafSource` says so. That is safe *here* and nowhere else: a recorded
   * leaf either reproduces the on-chain root or it does not, and the root is the authority. Root
   * *construction* for signing never uses them (see `computeWorkflowGroupScriptHashes` via
   * `OnchainPM.updatePolicy`), because there a metadata-supplied leaf would become an authorization —
   * the defect #526 removed.
   *
   * Deliberately a one-shot `Promise` rather than a `this._query()` observable: the answer is a
   * point-in-time audit of what a chain enforces *right now*, and a cached or replayed verdict is
   * worse than no verdict. Callers wanting a live view should re-invoke.
   *
   * @param strategist - The strategist whose policy to check
   * @param options.onchainPM - OnchainPM address per centrifugeId, for chains where the SDK cannot
   *   derive it from the factory. Without it those chains report `no-manager`.
   */
  async verifyWorkflowPolicy(
    strategist: HexString,
    options?: { onchainPM?: Record<number, HexString> }
  ): Promise<
    {
      centrifugeId: number
      onchainPM: HexString | null
      /** `bytes32(0)` means the strategist has no policy on that chain. */
      onchainRoot: HexString | null
      computedRoot: HexString | null
      /**
       * `recomputed` — leaves rebuilt from the catalog and freshly resolved context.
       * `recomputed-with-recorded-context` — rebuilt from the catalog, using the magic values
       *   recorded at whitelist time, so the leaf is reproducible even though an address has moved.
       * `recorded` — the leaves themselves came from metadata; the comparison is all that stands
       *   behind them.
       */
      leafSource: 'recomputed' | 'recomputed-with-recorded-context' | 'recorded' | null
      /**
       * The compilers the recorded leaves were built with, when the writer named them. Compare
       * against the SDK doing the verifying: on a `mismatch`, a version difference is a candidate
       * explanation that is not tampering, and only the caller knows its own version.
       */
      builtWith: string[]
      verdict: 'match' | 'mismatch' | 'not-set' | 'no-manager' | 'unverifiable'
      note?: string
    }[]
  > {
    const { buildPolicyUpdate } = await import('./OnchainPM.js')
    // Drift is collected rather than thrown: a definition that moved since whitelisting is a finding
    // this method exists to report, where for an edit it must abort the rebuild.
    const groups = await this._resolveStrategistWorkflows(strategist, { collectDrift: true })
    const results: Awaited<ReturnType<Pool['verifyWorkflowPolicy']>> = []

    for (const group of groups) {
      const override = options?.onchainPM?.[group.centrifugeId]
      const onchainPM =
        override ?? (await firstValueFrom(group.network.onchainPM().pipe(catchError(() => of(null)))))?.address ?? null

      if (!onchainPM) {
        results.push({
          centrifugeId: group.centrifugeId,
          onchainPM: null,
          onchainRoot: null,
          computedRoot: null,
          leafSource: null,
          builtWith: [],
          verdict: 'no-manager',
          note: 'No OnchainPM resolved for this chain, so no policy is enforced and nothing recorded here is executable.',
        })
        continue
      }

      const client = await firstValueFrom(this._root.getClient(group.centrifugeId))
      const { contractAbis: ABI } = await firstValueFrom(
        this._root.protocolContext({ poolId: this.id, centrifugeId: group.centrifugeId })
      )
      const onchainRoot = (await getContract({ address: onchainPM, abi: ABI.OnchainPM, client }).read.policy([
        strategist,
      ])) as HexString

      let leaves: HexString[] | null = null
      let leafSource: 'recomputed' | 'recomputed-with-recorded-context' | 'recorded' | null = null
      let note: string | undefined

      try {
        // A drifted entry's leaf cannot be reproduced: the catalog no longer publishes the definition
        // the policy was built from. Recomputing anyway yields a root that cannot match, and
        // reporting *that* as a mismatch accuses a policy nobody touched — so this falls into the
        // recorded-leaf path below, the only honest way left to check such a policy.
        if (group.drifted.length) {
          throw new Error(
            `${group.drifted.length} of ${group.policy.length} entries were redefined in the catalog since they were whitelisted: ${group.drifted.join(' ')}`
          )
        }
        const scId = await resolveWorkflowShareClassId(group.network, group.policy[0]?.scId)
        leaves = await computeWorkflowGroupScriptHashes({
          centrifuge: this._root,
          network: group.network,
          policy: group.policy,
          strategist,
          scId,
          // The escrow the network's OnchainPM builds its leaves from, which `execute` and
          // `updatePolicy` read on the same chain.
          poolEscrowAddress: await firstValueFrom(this._escrow(group.network.centrifugeId)),
          // Recorded magic values are honoured here and only here: the chain's root is the
          // authority, so a wrong one fails to match rather than authorizing anything.
          allowRecordedContext: true,
        })
        leafSource = group.policy.some((entry) => entry.poolContext) ? 'recomputed-with-recorded-context' : 'recomputed'
      } catch (error) {
        const recorded = group.policy.map((entry) => entry.scriptHash).filter(Boolean) as HexString[]
        if (recorded.length === group.policy.length && recorded.length > 0) {
          leaves = recorded
          leafSource = 'recorded'
          note = `Scripts could not be rebuilt (${(error as Error).message}), so the leaves recorded at whitelist time were used. They reproduce the enforced root or they do not — the comparison is what makes them meaningful.`
        } else {
          note = `Scripts could not be rebuilt and no leaves were recorded: ${(error as Error).message}`
        }
      }

      const hasRoot = !!onchainRoot && onchainRoot !== ZERO_ROOT
      let computedRoot: HexString | null = null
      if (leaves?.length) {
        const hubContext = await firstValueFrom(this._root.protocolContext(this.id))
        const { root } = await buildPolicyUpdate({
          hub: hubContext.hub,
          abis: hubContext.contractAbis,
          protocolVersion: hubContext.protocolVersion,
          poolId: this.id.raw,
          scId: await resolveWorkflowShareClassId(group.network, group.policy[0]?.scId),
          centrifugeId: group.centrifugeId,
          onchainPM,
          strategist,
          scriptHashes: leaves,
        })
        computedRoot = root
      }

      const builtWith = [...new Set(group.policy.map((entry) => entry.builtWith).filter(Boolean) as string[])]
      const verdict = !computedRoot
        ? 'unverifiable'
        : !hasRoot
          ? 'not-set'
          : computedRoot.toLowerCase() === onchainRoot.toLowerCase()
            ? 'match'
            : 'mismatch'

      // A rebuilt leaf depends on the builder as well as the data: `buildScript`'s slot
      // canonicalization has changed in this repo before. Naming the writer's version turns an
      // otherwise indistinguishable mismatch into a question the caller can answer.
      if (verdict === 'mismatch' && leafSource !== 'recorded' && builtWith.length) {
        note = [
          note,
          `Leaves were recorded as built with ${builtWith.join(', ')}; if that differs from the version verifying here, compiler drift is a candidate explanation.`,
        ]
          .filter(Boolean)
          .join(' ')
      }

      results.push({
        centrifugeId: group.centrifugeId,
        onchainPM,
        onchainRoot: onchainRoot ?? null,
        computedRoot,
        leafSource,
        builtWith,
        verdict,
        note,
      })
    }

    return results
  }

  /** List the workflows whitelisted for a strategist, across chains. */
  async listWorkflows(opts: { strategist: HexString }): Promise<
    {
      workflowRef: string
      name: string
      group?: string
      chainId: number
      centrifugeId: number
      runtimeVariables: string[]
    }[]
  > {
    const groups = await this._resolveStrategistWorkflows(opts.strategist)
    return groups.flatMap((g) =>
      g.policy.map((entry) => ({
        workflowRef: entry.workflow.workflowRef,
        name: entry.workflow.name,
        group: entry.workflow.group,
        chainId: entry.workflow.chainId,
        centrifugeId: g.centrifugeId,
        runtimeVariables: entry.workflow.runtimeVariables ?? [],
      }))
    )
  }

  /**
   * Run one whitelisted workflow by `workflowRef`. Resolves the chain + OnchainPM and the
   * proof tree from the strategist's policy, then submits via the OnchainPM. Awaiting the
   * returned promise executes the transaction (or simulates it when `simulate` is set).
   */
  async executeWorkflow(
    input: {
      strategist: HexString
      workflowRef: string
      runtimeValues?: Record<string, HexString>
      scId?: HexString
    },
    options: { simulate?: boolean } = {}
  ) {
    const groups = await this._resolveStrategistWorkflows(input.strategist)
    for (const g of groups) {
      const run = g.policy.findIndex((entry) => entry.workflow.workflowRef === input.workflowRef)
      if (run < 0) continue
      const onchainPM = await firstValueFrom(g.network.onchainPM())
      if (!onchainPM) throw new Error(`OnchainPM is not deployed for workflow "${input.workflowRef}"`)
      return onchainPM.executeWorkflow(
        { policy: g.policy, run, strategist: input.strategist, scId: input.scId, runtimeValues: input.runtimeValues },
        options
      )
    }
    throw new Error(`Workflow "${input.workflowRef}" is not whitelisted for strategist ${input.strategist}`)
  }

  /**
   * Plan an accounting update: every `account`-group workflow whitelisted for the strategist,
   * grouped per chain. Returns one handle per chain whose `execute()`/`simulate()` build and
   * submit that chain's atomic multicall. Multi-chain pools yield multiple handles.
   */
  async planAccountingUpdate(opts: {
    strategist: HexString
  }): Promise<{ centrifugeId: number; workflowRefs: string[]; execute: () => unknown; simulate: () => unknown }[]> {
    const groups = await this._resolveStrategistWorkflows(opts.strategist)
    const plans: { centrifugeId: number; workflowRefs: string[]; execute: () => unknown; simulate: () => unknown }[] =
      []
    for (const g of groups) {
      const run = g.policy.flatMap((entry, index) => (entry.workflow.group === 'account' ? [index] : []))
      if (run.length === 0) continue
      const onchainPM = await firstValueFrom(g.network.onchainPM())
      if (!onchainPM) continue
      const batch = { policy: g.policy, run, strategist: opts.strategist }
      plans.push({
        centrifugeId: g.centrifugeId,
        workflowRefs: run.map((index) => g.policy[index]!.workflow.workflowRef),
        execute: () => onchainPM.executeAccountingBatch(batch),
        simulate: () => onchainPM.executeAccountingBatch(batch, { simulate: true }),
      })
    }
    return plans
  }

  /**
   * Whitelist a workflow for a strategist. Reads the current policy from the pool metadata,
   * appends (or replaces) the entry, and updates both the metadata and the OnchainPM Merkle
   * root for the workflow's chain in one transaction. Awaiting the result submits it.
   */
  async addToPolicy(input: {
    strategist: HexString
    workflowRef: string
    configurableValues?: Record<string, HexString>
    excludedActions?: number[]
    scId?: HexString
  }) {
    return this._applyPolicyChange(input.strategist, input.scId, input.workflowRef, (entries) => [
      ...entries.filter((entry) => entry.workflowRef !== input.workflowRef),
      {
        workflowRef: input.workflowRef,
        configurableValues: input.configurableValues ?? {},
        excludedActions: input.excludedActions,
        addedAt: new Date().toISOString(),
      },
    ])
  }

  /** Remove a whitelisted workflow from a strategist's policy (metadata + on-chain root). */
  async removeFromPolicy(input: { strategist: HexString; workflowRef: string; scId?: HexString }) {
    return this._applyPolicyChange(input.strategist, input.scId, input.workflowRef, (entries) =>
      entries.filter((entry) => entry.workflowRef !== input.workflowRef)
    )
  }

  /** @internal Shared add/remove flow: mutate the strategist's entries, then update metadata + root. */
  private async _applyPolicyChange(
    strategist: HexString,
    scIdInput: HexString | undefined,
    affectedWorkflowRef: string,
    mutate: (entries: WorkflowPolicyEntry[]) => WorkflowPolicyEntry[]
  ) {
    const metadata = await firstValueFrom(this.metadata())
    const catalog = await firstValueFrom(this._root.workflowMarketplace())
    const byRef = new Map<string, MarketplaceWorkflow>(catalog.map((w) => [w.workflowRef, w]))

    const affected = byRef.get(affectedWorkflowRef)
    if (!affected) throw new Error(`Workflow "${affectedWorkflowRef}" is not in the marketplace catalog`)

    const centrifugeId = await firstValueFrom(this._root.id(affected.chainId))
    const networks = await firstValueFrom(this.activeNetworks())
    const network = networks.find((n) => n.centrifugeId === centrifugeId)
    if (!network) throw new Error(`Pool has no active network for chain ${affected.chainId}`)
    const onchainPM = await firstValueFrom(network.onchainPM())
    if (!onchainPM) throw new Error('OnchainPM is not deployed on this network')
    const scId = await resolveWorkflowShareClassId(network, scIdInput)

    const policies = (metadata?.workflowPolicies ?? []).map((policy) => ({ ...policy }))
    let group = policies.find((policy) => policy.strategistAddress.toLowerCase() === strategist.toLowerCase())
    if (!group) {
      group = {
        id: crypto.randomUUID(),
        strategistAddress: strategist,
        workflows: [],
        createdAt: new Date().toISOString(),
      }
      policies.push(group)
    }
    group.workflows = mutate(group.workflows)
    group.updatedAt = new Date().toISOString()

    const newMetadata = { ...(metadata ?? {}), workflowPolicies: policies } as PoolMetadata

    // Rebuild the affected chain's full policy (catalog-joined) for the new Merkle root.
    const idCache = new Map<number, number>([[affected.chainId, centrifugeId]])
    const chainPolicy: PolicyEntryInput[] = []
    for (const entry of group.workflows) {
      const workflow = byRef.get(entry.workflowRef)
      if (!workflow) continue
      // Every *other* entry has to still be the artifact it was approved as: this root re-signs
      // them all, and only `affectedWorkflowRef` is the one the operator is deliberately changing.
      if (entry.workflowRef !== affectedWorkflowRef) assertPinnedArtifact(entry, workflow)
      let cid = idCache.get(workflow.chainId)
      if (cid == null) {
        cid = await firstValueFrom(this._root.id(workflow.chainId))
        idCache.set(workflow.chainId, cid)
      }
      if (cid !== centrifugeId) continue
      chainPolicy.push({
        workflow,
        configurableValues: (entry.configurableValues ?? {}) as Record<string, HexString>,
        excludedActions: entry.excludedActions ?? [],
        // The entry's own share class, so this rebuild re-hashes nothing it wasn't asked to change.
        scId: entry.scId,
      })
    }

    return this._root.batchTransactions('Update workflow policy', [
      this.updateMetadata(newMetadata),
      onchainPM.updatePolicy({ scId, strategist, policy: chainPolicy }),
    ])
  }

  /**
   * Get a specific vault for a given network, share class, and asset.
   * @param centrifugeId - The centrifuge ID of the network
   * @param scId - The share class ID
   * @param asset - The asset address or ID
   */
  vault(centrifugeId: CentrifugeId, scId: ShareClassId, asset: HexString | AssetId) {
    return this._query(['vault', centrifugeId, scId.toString(), asset.toString().toLowerCase()], () =>
      this.network(centrifugeId).pipe(switchMap((network) => network.vault(scId, asset)))
    )
  }

  /**
   * Get the currency of the pool.
   */
  currency() {
    return this._query(['currency', this.id.toString()], () => {
      return combineLatest([this._root.protocolContext(this.id), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ hubRegistry, contractAbis: ABI }, client]) => {
          return client.readContract({
            address: hubRegistry,
            abi: ABI.HubRegistry,
            functionName: 'currency',
            args: [this.id.raw],
          })
        }),
        switchMap((rawCurrency: bigint) => {
          // TODO: Remove this once v3.1 testnet and mainnet data are properly synced
          // Handle case where currency is not set (returns 0)
          // Return a placeholder currency to allow the pool to load
          if (rawCurrency === 0n) {
            return of({
              name: 'Unknown',
              symbol: '???',
              decimals: 18,
            })
          }

          const assetId = new AssetId(rawCurrency)
          const countryCode = assetId.nationalCurrencyCode

          // Check isNationalCurrency to handle country code 0 edge case
          if (!assetId.isNationalCurrency || !countryCode) {
            return this._root.assetCurrency(assetId)
          }

          const currency = NATIONAL_CURRENCY_METADATA[countryCode!]

          if (!currency) {
            throw new Error(`No currency found for country code ${countryCode}`)
          }

          return of({
            name: currency.name,
            symbol: currency.symbol,
            decimals: 18,
          })
        })
      )
    })
  }

  /**
   * Get the decimals of the pool, which is the precision of the share class tokens
   * and pool-denominated balances. May differ from the pool currency decimals.
   */
  decimals() {
    return this._query(['decimals', this.id.toString()], () =>
      combineLatest([this._root.protocolContext(this.id), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ hubRegistry, contractAbis: ABI }, client]) =>
          defer(() =>
            client.readContract({
              address: hubRegistry,
              abi: poolDecimalsAbi(ABI),
              functionName: 'decimals',
              args: [this.id.raw],
            })
          )
        )
      )
    )
  }

  /**
   * Update pool metadata. Only v2 metadata can be written; legacy (v1) documents are rejected.
   * Migrate a legacy pool with {@link migrateMetadata} first.
   *
   * The legacy-rejection is eager (synchronous) so passing a v1 document fails fast at the call
   * site rather than only once the transaction is awaited.
   */
  updateMetadata(metadata: PoolMetadata) {
    if (isLegacyPoolMetadata(metadata)) {
      throw new Error('Cannot write legacy (v1) pool metadata. Call pool.migrateMetadata() first.')
    }
    const self = this
    return this._transact(async function* (ctx) {
      yield* self.#setPoolMetadata(ctx, metadata as PoolMetadataV2)
    }, this.centrifugeId)
  }

  /**
   * Read the current (legacy or v2) metadata, migrate it forward to v2, and write it back. Throws
   * if the pool has no metadata yet. The migrated document is the seed for the v2 factsheet and is
   * ops-editable afterwards.
   */
  migrateMetadata() {
    const self = this
    return this._transact(async function* (ctx) {
      const current = await firstValueFrom(self.metadata())
      if (!current) throw new Error('No pool metadata found to migrate')
      yield* self.#setPoolMetadata(ctx, migratePoolMetadataToV2(current))
    }, this.centrifugeId)
  }

  /** Shared pin + encode + send path for v2 metadata writes. Validates before pinning. */
  async *#setPoolMetadata(ctx: TransactionContext, metadata: PoolMetadataV2) {
    parsePoolMetadataV2(metadata)
    const cid = await this._root.config.pinJson(metadata)

    // Calldata comes from the pure @centrifuge/protocol builder over a
    // pool-resolved ProtocolContext (version through the Reader, never a
    // hard-wired address set), so this path and the backend's emit the same
    // bytes. `protocolContext.test.ts` pins that against a direct
    // encodeFunctionData over the SDK's own Hub ABI.
    const { context } = await this._root.protocolContext(this.id)
    if (!context) throw new Error('No protocol context resolved for pool')
    const built = builders.setPoolMetadata(context, { poolId: this.id.raw.toString(), cid })
    yield* wrapTransaction('Update metadata', ctx, {
      contract: built.to,
      policy: { poolId: this.id },
      data: built.data,
    })
  }

  update(
    metadataInput: Partial<PoolMetadataInput> | null = null,
    updatedShareClasses: ({ id: ShareClassId } & ShareClassInput)[],
    addedShareClasses: ShareClassInput[] = []
  ) {
    const self = this

    return this._transact(async function* (ctx) {
      const hubCtx = await self._root.protocolContext(self.id)
      const { hub, contractAbis: ABI } = hubCtx

      const existingPool = await self._root.pool(self.id)

      const [poolDetails, poolMetadata, activeNetworks] = await Promise.all([
        existingPool.details(),
        existingPool.metadata(),
        existingPool.activeNetworks(),
      ])
      const networksDetails = await Promise.all(
        activeNetworks.map((network) => {
          return network.details()
        })
      )

      if (!poolDetails) {
        throw new Error('Pool details not found')
      }

      const existingShareClassesCount = poolDetails.shareClasses.length
      const scIds = Array.from({ length: addedShareClasses.length }, (_, index) =>
        ShareClassId.from(poolDetails.id, existingShareClassesCount + index + 1)
      )

      // Determine if we need to re-pin metadata. A share-class rename (tokenName/symbolName) is
      // on-chain only (updateShareClassMetadata) and is NOT part of the pinned JSON, so it must not
      // trigger a re-pin on its own. Only re-pin when metadata content actually changes: pool-level
      // input, a new share class, or a share-class metadata field (minInvestment/apyPercentage/apy/
      // defaultAccounts) is provided on an updated share class.
      const hasMetadataInput = metadataInput !== null && Object.keys(metadataInput).length > 0
      const hasNewShareClasses = addedShareClasses.length > 0
      const hasUpdatedShareClassMetadata = updatedShareClasses.some(
        (sc) =>
          sc.minInvestment !== undefined ||
          sc.apyPercentage !== undefined ||
          sc.apy !== undefined ||
          sc.defaultAccounts !== undefined
      )
      const shouldUpdateMetadata = hasMetadataInput || hasNewShareClasses || hasUpdatedShareClassMetadata

      let cid: string | null = null

      if (shouldUpdateMetadata) {
        // Read metadata is migrated forward so the write path always emits v2.
        const baseMetadata: PoolMetadataV2 =
          poolMetadata && poolMetadata.pool
            ? migratePoolMetadataToV2(poolMetadata)
            : {
                version: 2,
                pool: {
                  name: '',
                  icon: null,
                  asset: { class: 'Private credit', subClass: '' },
                  issuer: {
                    name: '',
                    email: '',
                    logo: null,
                  },
                  poolStructure: '',
                  investorType: '',
                  links: {
                    executiveSummary: null,
                    forum: undefined,
                    website: undefined,
                  },
                  status: 'upcoming',
                  listed: false,
                  poolRatings: [],
                },
                shareClasses: {},
              }

        const newShareClassesById: PoolMetadata['shareClasses'] = {}
        addedShareClasses.forEach((sc, index) => {
          newShareClassesById[scIds[index]!.raw] = {
            minInitialInvestment: sc.minInvestment,
            apyPercentage: sc.apyPercentage,
            apy: sc.apy,
            defaultAccounts: sc.defaultAccounts,
          }
        })

        const poolStatus =
          metadataInput?.poolType === undefined
            ? baseMetadata.pool.status
            : metadataInput.poolType === 'open'
              ? 'open'
              : 'upcoming'

        const formattedMetadata: PoolMetadataV2 = {
          ...baseMetadata,
          version: 2,
          pool: {
            ...baseMetadata.pool,
            name: metadataInput?.poolName ?? baseMetadata.pool.name,
            icon: metadataInput?.poolIcon ?? baseMetadata.pool.icon,
            asset: {
              ...baseMetadata.pool.asset,
              class: metadataInput?.assetClass ?? baseMetadata.pool.asset.class,
              subClass: metadataInput?.subAssetClass ?? baseMetadata.pool.asset.subClass,
            },
            issuer: {
              ...baseMetadata.pool.issuer,
              name: metadataInput?.issuerName ?? baseMetadata.pool.issuer.name,
              email: metadataInput?.email ?? baseMetadata.pool.issuer.email,
              logo: metadataInput?.issuerLogo ?? baseMetadata.pool.issuer.logo,
            },
            poolStructure: metadataInput?.poolStructure ?? baseMetadata.pool.poolStructure,
            investorType: metadataInput?.investorType ?? baseMetadata.pool.investorType,
            links: {
              ...baseMetadata.pool.links,
              executiveSummary: metadataInput?.executiveSummary ?? baseMetadata.pool.links?.executiveSummary,
              forum: metadataInput?.forum ?? baseMetadata.pool.links?.forum,
              website: metadataInput?.website ?? baseMetadata.pool.links?.website,
              documents: metadataInput?.linkDocuments ?? baseMetadata.pool.links?.documents,
            },
            status: poolStatus,
            listed: metadataInput?.listed ?? baseMetadata.pool.listed,
            poolRatings: metadataInput?.poolRatings ?? baseMetadata.pool.poolRatings,
            factsheet: metadataInput?.factsheet ?? baseMetadata.pool.factsheet,
          },
          shareClasses: { ...baseMetadata.shareClasses, ...newShareClassesById },
        }

        // Partial merge: only override keys that were actually provided, so omitting a field
        // preserves the stored value instead of dropping it (callers need not echo existing values).
        updatedShareClasses.forEach((sc) => {
          const id = sc.id.toString()

          formattedMetadata.shareClasses[id] = {
            ...formattedMetadata.shareClasses[id],
            ...(sc.minInvestment !== undefined ? { minInitialInvestment: sc.minInvestment } : {}),
            ...(sc.apyPercentage !== undefined ? { apyPercentage: sc.apyPercentage } : {}),
            ...(sc.apy !== undefined ? { apy: sc.apy } : {}),
            ...(sc.defaultAccounts !== undefined ? { defaultAccounts: sc.defaultAccounts } : {}),
          }
        })

        parsePoolMetadataV2(formattedMetadata)
        cid = await self._root.config.pinJson(formattedMetadata)
      }

      const shareClassesToBeUpdated = updatedShareClasses.filter((sc) => {
        const shareClass = poolDetails.shareClasses.find((scDetails) => scDetails.details.id.equals(sc.id))

        if (!shareClass) {
          throw new Error(`Share class ${sc.id} not found in pool details`)
        }

        if (sc.symbolName !== shareClass.details.symbol || sc.tokenName !== shareClass.details.name) {
          return true
        }
      })

      const shareClassesToBeUpdatedIds = new Set(shareClassesToBeUpdated.map((sc) => sc.id.toString()))

      const shareClassesToBeUpdatedPerNetwork = new Map<number, ShareClass[]>()
      networksDetails.forEach((details, index) => {
        const activeShareClasses = details.activeShareClasses || []
        const shareClassesToUpdate = activeShareClasses.filter((asc) =>
          shareClassesToBeUpdatedIds.has(asc.id.toString())
        )
        if (shareClassesToUpdate.length > 0) {
          const poolNetwork = activeNetworks[index]
          if (!poolNetwork) {
            return
          }
          shareClassesToBeUpdatedPerNetwork.set(
            poolNetwork.centrifugeId,
            shareClassesToUpdate.map((sc) => sc.shareClass)
          )
        }
      })

      const existingShareClassesMetadata = poolMetadata?.shareClasses ?? {}
      const accountIsDebitNormal = new Map<number, boolean>()
      const exsitingAccounts = new Set(
        poolDetails.shareClasses.flatMap((sc) =>
          Object.entries(existingShareClassesMetadata[sc.details.id.toString()]?.defaultAccounts ?? {})
            .filter(([k, v]) => {
              if (!v) return false

              if (['asset', 'expense'].includes(k)) {
                if (accountIsDebitNormal.get(v) === false)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, true)
              } else {
                if (accountIsDebitNormal.get(v) === true)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, false)
              }

              return true
            })
            .map(([, v]) => v)
        )
      )

      const updatedShareClassesMetadata = [
        ...updatedShareClasses.map((sc) => sc.defaultAccounts),
        ...addedShareClasses.map((sc) => sc.defaultAccounts),
      ].filter(Boolean)

      const updatedAccounts = new Set(
        updatedShareClassesMetadata.flatMap((defaultAccounts) =>
          Object.entries(defaultAccounts ?? {})
            .filter(([k, v]) => {
              if (!v) return false

              if (['asset', 'expense'].includes(k)) {
                if (accountIsDebitNormal.get(v) === false)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, true)
              } else {
                if (accountIsDebitNormal.get(v) === true)
                  throw new Error(`Account "${v}" is set as both credit normal and debit normal.`)
                accountIsDebitNormal.set(v, false)
              }

              return true
            })
            .map(([, v]) => v)
        )
      )

      const newAccounts = [...updatedAccounts].filter((account) => !exsitingAccounts.has(account))

      const batch: HexString[] = []
      const messages: Record<number, MessageTypeWithSubType[]> = {}

      // Only add metadata update if we have a CID
      if (cid) {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'setPoolMetadata',
            args: [self.id.raw, toHex(cid)],
          })
        )
      }

      addedShareClasses.forEach((sc) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'addShareClass',
            args: [
              self.id.raw,
              sc.tokenName,
              sc.symbolName,
              sc.salt?.startsWith('0x') ? (sc.salt as HexString) : generateShareClassSalt(self.id.raw),
            ],
          })
        )
      })

      shareClassesToBeUpdated.forEach((sc) => {
        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'updateShareClassMetadata',
            args: [self.id.raw, sc.id.raw, sc.tokenName, sc.symbolName],
          })
        )
      })

      for (const [centId, shareClasses] of shareClassesToBeUpdatedPerNetwork) {
        if (isCrosschainMessagingDisabled(centId)) continue

        if (shareClasses.length > 0) {
          await Promise.all(
            shareClasses.map(async (sc: ShareClass) => {
              batch.push(
                isV3_3(hubCtx)
                  ? encodeFunctionData({
                      abi: ABIS_V3_3.Hub,
                      functionName: 'notifyShareMetadata',
                      args: [self.id.raw, sc.id.raw, centId, 0n, ctx.signingAddress],
                    })
                  : encodeFunctionData({
                      abi: ABI.Hub,
                      functionName: 'notifyShareMetadata',
                      args: [self.id.raw, sc.id.raw, centId, ctx.signingAddress],
                    })
              )

              addMessageForEnabledTarget(messages, centId, { type: MessageType.NotifyShareClass, poolId: self.id })
            })
          )
        }
      }

      newAccounts.map((accountId) => {
        const isDebitNormal = accountIsDebitNormal.get(accountId)

        if (isDebitNormal === undefined) {
          return
        }

        batch.push(
          encodeFunctionData({
            abi: ABI.Hub,
            functionName: 'createAccount',
            args: [self.id.raw, BigInt(accountId), isDebitNormal],
          })
        )
      })

      if (batch.length === 0) {
        throw new Error('No changes to update')
      }

      yield* wrapTransaction('Update pool details', ctx, {
        contract: hub,
        policy: { poolId: self.id },
        data: batch,
        messages,
      })
    }, this.centrifugeId)
  }

  /**
   * Update pool managers.
   *
   * Routed to the backend's `updatePoolManagers` action in backend mode.
   * Two differences from the local path, both the backend's design
   * rather than an omission here, and both pinned by a test:
   *
   * - The "cannot remove all pool managers" check moves SERVER-side. Locally it
   *   is computed here against `poolManagers()`; on the backend route the
   *   private-api evaluates the same rule against the `chain_v1` projection and
   *   answers 422 `LAST_POOL_MANAGER`. The check does not run twice: keeping it
   *   here as well would make the call depend on a projection read the caller
   *   could race, and the refusal that matters is the one the signing path
   *   actually enforces. Same reasoning as the absent `isBalanceSheetManager`
   *   pre-flight on the balance-sheet writes: authorization and safety rails
   *   belong to the guard and the policy engine, not to a client that can be
   *   bypassed.
   * - The batch ORDER differs. This method moves the SIGNER's own entry last so
   *   a manager who revokes themselves while adding others does not lose
   *   authority mid-batch; the backend's builder cannot reproduce that (the
   *   signer is unknown at preview time, and on the Fordefi route the calldata
   *   is re-derived at prepare and again during dual-channel verification, so
   *   any signer-dependent ordering would fail verification). It emits all
   *   grants before all revokes instead, which is signer-independent and
   *   strictly stronger for the failure mode the local rule targets. The two
   *   therefore produce byte-equal calldata only when the caller's order already
   *   satisfies both rules — see `builders/managers.ts`.
   */
  updatePoolManagers(updates: { address: HexString; canManage: boolean }[]) {
    return this._root._routeDeferredTransaction(
      'updatePoolManagers',
      this.id.toString(),
      async () => ({
        poolId: this.id.toString(),
        // The caller's order, verbatim. The builder does its own stable
        // grants-before-revokes partition; re-ordering here as well would mean
        // the SDK and the backend disagreed about what the caller asked for
        // while producing the same bytes.
        updates: updates.map(({ address, canManage }) => ({ address, canManage })),
      }),
      {
        title: 'Update pool managers',
        centrifugeId: this.centrifugeId,
        gate: [],
        local: () => this.#updatePoolManagersLocal(updates),
      }
    )
  }

  #updatePoolManagersLocal(updates: { address: HexString; canManage: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub, contractAbis: ABI } = await self._root.protocolContext(self.id)

      const existingManagers = await self.poolManagers()
      const leftManagers = new Map<string, boolean>()

      existingManagers.forEach((manager) => {
        leftManagers.set(manager.address.toLowerCase(), true)
      })

      updates.forEach(({ address, canManage }) => {
        const addr = address.toLowerCase()
        const managerExists = leftManagers.get(addr)

        if (!managerExists && canManage) {
          leftManagers.set(addr, true)
        }

        if (managerExists && !canManage) {
          leftManagers.delete(addr)
        }
      })

      if (leftManagers.size === 0) {
        throw new Error('Cannot remove all pool managers')
      }

      // Ensure that updating the signer's address is always last in the batch,
      // to prevent removing the signer from the list of managers, before having added others,
      // which would cause the other updates to fail.
      const selfUpdateIndex = updates.findIndex((u) => u.address.toLowerCase() === ctx.signingAddress.toLowerCase())
      const selfUpdate = updates.splice(selfUpdateIndex >>> 0, 1)
      updates.push(...selfUpdate)

      const batch = updates.map(({ address, canManage }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateHubManager',
          args: [self.id.raw, address, canManage],
        })
      )

      yield* wrapTransaction('Update pool managers', ctx, {
        contract: hub,
        policy: { poolId: self.id },
        data: batch,
      })
    }, this.centrifugeId)
  }

  /**
   * Update balance sheet managers.
   *
   * @param options.refundAddress - Where unspent cross-chain gas payment is
   * returned. Optional and defaulted to the signing address on the local path,
   * which is exactly what this method has always done. REQUIRED in backend
   * mode, where there is no signing address at build time.
   *
   * Routed to the backend's `updateBalanceSheetManagers` action in backend
   * mode. Unlike {@link updatePoolManagers} this one dispatches one
   * cross-chain message per named network, so it carries a refund address, and
   * the backend cannot fill one in: the calldata is built before any signer is
   * resolved and must stay byte-identical at preview, at prepare and again
   * during Fordefi's dual-channel re-derivation.
   *
   * So backend mode refuses rather than guessing, the same call
   * `balanceSheet.revoke()` makes for its custodian. Defaulting to the
   * connected wallet would be the plausible-wrong-value trap: on the custodial
   * route the signer is the pool's Fordefi vault, and the refund of a
   * vault-paid message would be sent to a browser wallet instead.
   *
   * The caller's entry order is preserved on both paths — see
   * `builders/managers.ts` for why this action is NOT repartitioned the way
   * `updatePoolManagers` is.
   */
  updateBalanceSheetManagers(
    updates: { centrifugeId: CentrifugeId; address: HexString; canManage: boolean }[],
    options: { refundAddress?: HexString } = {}
  ) {
    return this._root._routeDeferredTransaction(
      'updateBalanceSheetManagers',
      this.id.toString(),
      async () => {
        if (!options.refundAddress) {
          throw new Error(
            'pool.updateBalanceSheetManagers() needs an explicit { refundAddress } in backend mode: ' +
              'Hub.updateBalanceSheetManager dispatches a paid cross-chain message per network and returns ' +
              'the unspent gas to that address, and the backend builds the calldata before any signer is ' +
              'resolved. Pass the address that will sign — the pool vault address on the Fordefi route.'
          )
        }
        return this._balanceSheetManagerPayload(updates, options.refundAddress)
      },
      {
        title: 'Update balance sheet managers',
        centrifugeId: this.centrifugeId,
        gate: updates.map(({ centrifugeId }) => ({ centrifugeId })),
        local: () => this.#updateBalanceSheetManagersLocal(updates, options.refundAddress),
      }
    )
  }

  #updateBalanceSheetManagersLocal(
    updates: { centrifugeId: CentrifugeId; address: HexString; canManage: boolean }[],
    refundAddress?: HexString
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const hubCtx = await self._root.protocolContext(self.id)
      const { hub } = hubCtx
      // Unchanged default: this method has always refunded to whoever signs.
      const { data, messages } = self._balanceSheetManagerUpdates(updates, refundAddress ?? ctx.signingAddress, hubCtx)

      yield* wrapTransaction('Update balance sheet managers', ctx, {
        contract: hub,
        policy: { poolId: self.id },
        data,
        messages,
      })
    }, this.centrifugeId)
  }

  /**
   * @internal The backend `updateBalanceSheetManagers` payload. Applies the same cross-chain kill-switch as
   * the local path, so the two agree on which networks a batch touches.
   * @throws If none of the updates targets a cross-chain enabled network.
   */
  _balanceSheetManagerPayload(
    updates: { centrifugeId: CentrifugeId; address: HexString; canManage: boolean }[],
    refundAddress: HexString
  ) {
    const enabledUpdates = filterCrosschainEnabledTargets(updates)
    if (enabledUpdates.length === 0) {
      throw new Error('No enabled networks to update balance sheet managers')
    }
    return {
      poolId: this.id.toString(),
      refundAddress,
      updates: enabledUpdates.map(({ centrifugeId, address, canManage }) => ({
        // Decimal string on the wire, as every chain-table column is.
        centrifugeId: String(centrifugeId),
        address,
        canManage,
      })),
    }
  }

  /**
   * @internal Hub calldata and messages for a balance sheet manager update, so a caller can run it inside
   * its own transaction context.
   * @throws If none of the updates targets a cross-chain enabled network.
   */
  _balanceSheetManagerUpdates(
    updates: { centrifugeId: CentrifugeId; address: HexString; canManage: boolean }[],
    refundAddress: HexString,
    hubCtx: SdkProtocolContext
  ) {
    const enabledUpdates = filterCrosschainEnabledTargets(updates)
    // v3.3 replaced updateBalanceSheetManager with updateManager, whose `spoke`
    // kind is the balance sheet manager.
    const data = enabledUpdates.map(({ centrifugeId, address, canManage }) =>
      isV3_3(hubCtx)
        ? builders.updateManager(builderContext(hubCtx), {
            poolId: this.id.toString(),
            centrifugeId: String(centrifugeId),
            kind: 'spoke',
            address,
            canManage,
            refundAddress,
          }).data
        : encodeFunctionData({
            abi: hubCtx.contractAbis.Hub,
            functionName: 'updateBalanceSheetManager',
            args: [this.id.raw, centrifugeId, addressToBytes32(address), canManage, refundAddress],
          })
    )
    const messages: Record<number, MessageTypeWithSubType[]> = {}
    enabledUpdates.forEach(({ centrifugeId }) => {
      addMessageForEnabledTarget(
        messages,
        centrifugeId,
        isV3_3(hubCtx)
          ? messageV3_3(MessageTypeV3_3.UpdateManager, this.id)
          : { type: MessageType.UpdateBalanceSheetManager, poolId: this.id }
      )
    })

    if (data.length === 0) {
      throw new Error('No enabled networks to update balance sheet managers')
    }

    return { data, messages }
  }

  /**
   * Update an OracleValuation feeder on the hub chain for this pool.
   * @throws DeployedContractVersionError before anything is signed, when `oracleValuation` is the hub chain's
   * registry OracleValuation and the client's address book does not record the ABI digest of the pool's bundled
   * OracleValuation ABI for it.
   * @throws DeployedContractVersionError for any address on a hub chain whose address book lists no
   * OracleValuation (in the bundled book Plume, Avalanche, BNB, HyperEVM, Monad, Pharos and Arc, where it excludes
   * 0xCBdb6EFF…).
   * Any other address on a chain that lists an OracleValuation is encoded with the bundled ABI unchecked.
   */
  updateOracleValuationFeeder(
    oracleValuation: HexString,
    centrifugeId: CentrifugeId,
    feeder: HexString,
    canFeed: boolean
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const hubCtx = await self._root.protocolContext(self.id)
      if (isV3_3(hubCtx)) {
        // v3.3 OracleValuation only takes feeder updates from the hub, as a local manager call.
        yield* wrapTransaction('Update oracle valuation feeder', ctx, {
          contract: hubCtx.hub,
          policy: { poolId: self.id },
          data: encodeHubManagerCall(hubCtx, {
            centrifugeId: self.centrifugeId,
            target: oracleValuation,
            payload: encodeOracleValuationFeederPayload({ centrifugeId: String(centrifugeId), feeder, canFeed }),
            label: 'OracleValuation.UpdateFeeder',
            refund: ctx.signingAddress,
          }),
        })
        return
      }
      // The book's ABI digest describes the registry's OracleValuation; another address is the caller's own
      // contract, which the book does not describe, and is encoded unchecked. Where the book lists no
      // OracleValuation the two cannot be told apart, so the check refuses every address.
      const registryOracleValuation = hubCtx.oracleValuation
      if (!registryOracleValuation || oracleValuation.toLowerCase() === registryOracleValuation.toLowerCase()) {
        const { book } = await self._root._addressBook()
        assertDeployedContractVersion(
          {
            operation: 'Pool.updateOracleValuationFeeder',
            environment: self._root.config.environment,
            protocolVersion: hubCtx.protocolVersion,
            centrifugeId: self.centrifugeId,
            contract: 'oracleValuation',
          },
          book
        )
      }
      const data = encodeFunctionData({
        abi: hubCtx.contractAbis.OracleValuation,
        functionName: 'updateFeeder',
        args: [self.id.raw, centrifugeId, addressToBytes32(feeder), canFeed],
      })

      yield* wrapTransaction('Update oracle valuation feeder', ctx, {
        contract: oracleValuation,
        data,
      })
    }, this.centrifugeId)
  }

  /**
   * Set adapters for multiple networks at once.
   *
   * Every adapter must belong to the pool's protocol version, which is the hub's: a local adapter's `entrypoint()`
   * must be the pool's MultiAdapter on the hub, a remote adapter's the MultiAdapter of the hub's version on its
   * network. That holds for a spoke still migrating: between the hub's `Activated` and the spoke's `Onboarded`, the
   * spoke's own context reads v3.2, but the hub's v3.3 `SetPoolAdapters` lands on its v3.3 MultiAdapter, so its
   * remote adapters are the v3.3 ones. Otherwise this throws
   * `AdapterVersionMismatchError` before anything is signed, listing every refused adapter.
   * {@link Pool.globalAdapters} lists the local adapters a pool may use toward a network and
   * {@link Pool.remoteGlobalAdapters} the remote ones.
   *
   * The check reads every target network, not only the hub, so each needs a client (`rpcUrls`), and the hub's
   * version must be deployed there, or this throws `ProtocolVersionResolutionError`. A failed read is thrown as it is.
   */
  setAdapters(
    updates: {
      centrifugeId: CentrifugeId
      localAdapters: HexString[]
      remoteAdapters: HexString[]
      threshold?: number
      recoveryIndex?: number
    }[]
  ) {
    const self = this
    return this._transact(async function* (ctx) {
      const hubCtx = await self._root.protocolContext(self.id)
      const { hub, contractAbis: ABI } = hubCtx

      const enabledUpdates = filterCrosschainEnabledTargets(updates)
      await assertPoolVersionAdapters(self._root, hubCtx, self.id, enabledUpdates)
      if (isV3_3(hubCtx)) {
        if (enabledUpdates.length === 0) {
          throw new Error('No enabled networks to set pool adapters')
        }
        // v3.3 refuses setAdapters inside a hub batch (CannotSetAdaptersWhileBatching):
        // one transaction per network. It also dropped the recovery index.
        const sends = enabledUpdates.map(({ centrifugeId, localAdapters, remoteAdapters, threshold }) => ({
          centrifugeId,
          data: encodeFunctionData({
            abi: ABIS_V3_3.Hub,
            functionName: 'setAdapters',
            args: [
              self.id.raw,
              centrifugeId,
              localAdapters,
              remoteAdapters.map(addressToBytes32),
              threshold ?? localAdapters.length,
              ctx.signingAddress,
            ],
          }),
        }))
        // All networks are judged before the first is signed, so a refusal leaves the pool's adapters as they were.
        // Each send judges its network again, which catches a policy that changed in between.
        if (!ctx.isBatching) {
          const calls = sends.map(({ data }) => ({ poolId: self.id, data }))
          const outOfPolicy = await outOfPolicyStatus('Set pool adapters', ctx, calls)
          if (outOfPolicy) {
            yield outOfPolicy
            return
          }
        }
        for (const { centrifugeId, data } of sends) {
          const sent = yield* wrapTransaction('Set pool adapters', ctx, {
            contract: hub,
            policy: { poolId: self.id },
            data,
            messages: { [centrifugeId]: [{ type: MessageType.SetPoolAdapters, poolId: self.id }] },
          })
          if (sent?.type === 'OutOfPolicy') return
        }
        return
      }
      const batch = enabledUpdates.map(({ centrifugeId, localAdapters, remoteAdapters, threshold, recoveryIndex }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'setAdapters',
          args: [
            self.id.raw,
            centrifugeId,
            localAdapters,
            remoteAdapters.map(addressToBytes32),
            threshold ?? localAdapters.length,
            recoveryIndex ?? localAdapters.length,
            ctx.signingAddress,
          ],
        })
      )

      const messages: Record<number, MessageTypeWithSubType[]> = {}
      enabledUpdates.forEach(({ centrifugeId }) => {
        addMessageForEnabledTarget(messages, centrifugeId, { type: MessageType.SetPoolAdapters, poolId: self.id })
      })

      if (batch.length === 0) {
        throw new Error('No enabled networks to set pool adapters')
      }

      yield* wrapTransaction('Set pool adapters', ctx, {
        contract: hub,
        policy: { poolId: self.id },
        data: batch,
        messages,
      })
    }, this.centrifugeId)
  }

  /**
   * Schedule authorizations for hub calls the pool's policy delays: one `Hub.initiateAuthorization` per entry of
   * `datas`, sent as one `Hub.multicall` (atomic, one wallet prompt) or as the plain call for a single entry. A pool
   * manager signs it, and the policy does not classify this call itself, only the calldata it schedules. An action
   * that ended in `OutOfPolicy` is scheduled with {@link Pool.scheduleOutOfPolicy}, which takes its status; this takes
   * calldata alone.
   *
   * Take each entry from `built.calls[i].data` of `centrifuge.buildOnly(...)`. Once the entries have matured,
   * {@link Pool.executeAuthorizations} sends the calldata of the group unchanged. A call that carries a refund address is
   * consumed only by calldata with the same one, so build it with the `fromAddress` that will sign a re-run of the
   * owning action (`docs/sdk/hub-policies.md`).
   *
   * The transaction reverts with `InPolicy` for a call that is in policy, `AlreadyAuthorized` for one already
   * scheduled (an expired entry blocks the same calldata until {@link Pool.cancelAuthorization} removes it),
   * `PolicyNotInstalled` when the pool has no policy, and, under `StdHubPolicy`, `CallerNotAllowed` when it confines
   * the signer away from the call. This call is not judged by the pre-send check, so these revert on chain.
   *
   * @param datas - The calldata of each hub call to authorize, at least one, none twice: whole-byte hex that starts
   * with a function selector and is not a multicall wrapper.
   * @throws UnsupportedForProtocolVersionError on a pool that runs protocol v3.2, which has no policies.
   * @throws Error when `datas` is empty, an entry is not the calldata of one hub call, or an entry repeats.
   */
  initiateAuthorizations(datas: HexString[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const hubCtx = await self.#hubPolicyContext('Pool.initiateAuthorizations')
      if (datas.length === 0) {
        throw new Error('Pool.initiateAuthorizations needs at least one hub call to authorize')
      }
      datas.forEach((data) => assertAuthorizationCalldata(data, 'Pool.initiateAuthorizations'))
      assertDistinctCalldata(datas, 'Pool.initiateAuthorizations')

      yield* wrapTransaction('Schedule authorizations', ctx, {
        contract: hubCtx.hub,
        data: datas.map((data) => encodeInitiateAuthorization(self.id, data)),
      })
    }, this.centrifugeId)
  }

  /**
   * Schedule an action the pool's hub policy delayed, from the `OutOfPolicy` status it ended in, as one group: one
   * transaction on the hub chain that schedules every call that needs an authorization and sends the independent
   * instant calls with their fees, in the order of `status.batch`. A call that is ready and that a matured group
   * rebuilds when it executes (`deferred`: a `notifySharePrice` after a share price update that is not ready, a
   * `notifyPool` or `notifyAssetPrice` before a deployment that is not ready) is not sent. The items of
   * {@link Pool.authorizations} that share this transaction's `txHash` are the group: once they matured, pass their
   * `data`, in list order, to {@link Pool.executeAuthorizations}.
   *
   * ```ts
   * const result = await pool.updatePoolManagers(managers)
   * if (result.type === 'OutOfPolicy') await pool.scheduleOutOfPolicy(result)
   * ```
   *
   * The entries that schedule name no pool, since no policy classifies `Hub.initiateAuthorization`; the instant calls
   * that are sent are judged again like any hub send, so a call that is no longer ready ends this transaction in a new
   * `OutOfPolicy` status with nothing signed. A single entry is sent as the plain `initiateAuthorization`.
   *
   * `status.batch` holds only the calls a pool's policy judged, and a call that names no pool is not one of them. The
   * `OutOfPolicy` that this method resolves with lists the calls it sends and none it schedules, and the one of a
   * `Centrifuge.batchTransactions` that merges in an `initiateAuthorizations` lacks its entries: scheduling either
   * schedules less than the action.
   *
   * A status is a verdict at one block: pass the one the action just yielded. A call that cannot be scheduled throws
   * before anything is signed, naming the call and what to do (`docs/sdk/hub-policies.md`, "Scheduling a group").
   *
   * @param status - The `OutOfPolicy` status of the transaction, as it was yielded.
   * @throws UnsupportedForProtocolVersionError on a pool that runs protocol v3.2, which has no policies.
   * @throws Error before anything is read when the status is not an `OutOfPolicy` status with its calls and batch, a
   * call of it is not a call of the v3.3 Hub for this pool that an SDK entity builds, a call's `deferred` is not what
   * the rules give for the batch, a call is `forbidden`, `pending`, `expired` or `undetermined`, no call needs an
   * authorization, a ready `setAdapters` (the Hub refuses it inside a batch), a ready deployment leg bound for a
   * network whose `notifyPool` the batch leaves to the execution, or the same calldata would be scheduled twice.
   * @throws Error after the pool's version is read when the messages of a call cannot be derived.
   */
  scheduleOutOfPolicy(status: OperationOutOfPolicyStatus) {
    const self = this
    return this._transact(async function* (ctx) {
      const entries = parseSchedule(self, status)
      const hubCtx = await self.#hubPolicyContext('Pool.scheduleOutOfPolicy')
      const plan = planSchedule(self, hubCtx, entries)

      yield* wrapTransaction('Schedule out-of-policy action', ctx, {
        contract: hubCtx.hub,
        policies: plan.policies,
        data: plan.data,
        messages: plan.messages,
      })
    }, this.centrifugeId)
  }

  /**
   * Execute a matured group of hub calls that {@link Pool.scheduleOutOfPolicy} or {@link Pool.initiateAuthorizations}
   * scheduled: the scheduled calldata goes to the Hub unchanged, in one transaction (a `Hub.multicall` when it has
   * several calls), and the cross-chain fees of what the calls send are paid with it. The signer must be a pool
   * manager.
   *
   * Pass the `data` of the items of one group, which share a `txHash`, in the order {@link Pool.authorizations} lists
   * them. Every item must be ready on the chain when it is sent; for a scheduled call that means `matured`. One that
   * is not ends the transaction in `OutOfPolicy`, which names it, with nothing signed. The instant calls the group
   * depends on are rebuilt against the chain as it is now and refunded to the signer: a `notifySharePrice` per notified
   * network after each `updateSharePrice`, a `notifyPool` where the group deploys to a network the pool is not on, and a
   * `notifyAssetPrice` before each `updateVault` that deploys a vault, none of them when the group holds that call
   * itself. A `setAdapters` call is sent first, in a transaction of its own. The rules, the refusals and the fee are in
   * `docs/sdk/hub-policies.md`, "Executing a group".
   *
   * It does not send the investors' claim notifications that follow an issue or a revoke: they are no Hub call and
   * cannot share this transaction. When {@link Pool.hasClaimsAfterExecution} says the group has claims, call
   * {@link Pool.claimsAfterExecution} with the same `datas` as soon as this confirms.
   *
   * @param datas - The calldata of each call of the group, at least one, none twice: `built.calls[i].data` of a
   * `centrifuge.buildOnly(...)` of an SDK entity, for a call of this pool. A `multicall` wrapper and a function no entity
   * builds are refused.
   * @throws UnsupportedForProtocolVersionError on a pool that runs protocol v3.2, which has no policies.
   * @throws Error before anything is read when `datas` is empty, an entry repeats, an entry is not a call of the v3.3
   * Hub for this pool that an SDK entity builds, it carries a local value or extra gas the SDK cannot send, or the group
   * has a `setAdapters` call and is built or batched: it is several transactions. A group without one builds as a
   * single transaction.
   * @throws Error after the pool's version is read when the messages of a call cannot be derived, and when a call sends
   * a message to a chain whose cross-chain messaging is disabled.
   */
  executeAuthorizations(datas: HexString[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const title = 'Execute authorizations'
      const parsed = parseGroup(self, datas)
      if (parsed.some(isSetAdapters)) assertNotBatching(title, ctx)
      const hubCtx = await self.#hubPolicyContext('Pool.executeAuthorizations')
      const group = describeGroup(self, hubCtx, parsed)
      const plan = await planGroup(self._root, self, hubCtx, ctx.signingAddress, group)
      const calls = plan.calls.map(({ data }) => data)

      if (plan.setAdapters.length === 0) {
        yield* wrapTransaction(title, ctx, {
          contract: hubCtx.hub,
          policy: { poolId: self.id },
          data: calls,
          messages: plan.messages,
          alwaysBatch: plan.alwaysBatch,
        })
        return
      }
      // All calls are judged before the first is signed, so a refusal leaves the pool's adapters as they were.
      yield* sendCallsInOrder(title, ctx, [
        ...plan.setAdapters.map(({ data, messages }) => ({
          title: 'Set pool adapters',
          contract: hubCtx.hub,
          policy: { poolId: self.id },
          data: [data],
          messages,
        })),
        ...(calls.length === 0
          ? []
          : [
              {
                title,
                contract: hubCtx.hub,
                policy: { poolId: self.id },
                data: calls,
                messages: plan.messages,
                pendingPoolAdapters: plan.pendingPoolAdapters,
                alwaysBatch: plan.alwaysBatch,
              },
            ]),
      ])
    }, this.centrifugeId)
  }

  /**
   * Whether a group holds an issue or a revoke, so {@link Pool.claimsAfterExecution} has claims to send after
   * {@link Pool.executeAuthorizations} confirmed it. Call this with the `datas` you executed and, when it is true,
   * call `claimsAfterExecution` right away. A group of deployments, share prices or approvals alone is false.
   *
   * It reads calldata and nothing else and never throws: calldata that is not a call of this pool's Hub counts for
   * nothing. It cannot tell the pool's `BatchRequestManager` from another contract on the hub chain that takes the same
   * payload, since that address is read from the address book, so it answers by the payload and the hub chain; the
   * method it guards checks the address.
   *
   * @param datas - The calldata of each call of the group, as passed to {@link Pool.executeAuthorizations}.
   */
  hasClaimsAfterExecution(datas: HexString[]): boolean {
    return datas.some((data) => settlesOrders(peekHubCall(data), this.id))
  }

  /**
   * Send the hub-side claims of a group that {@link Pool.executeAuthorizations} executed: one `BatchRequestManager`
   * transaction with a `notifyDeposit` for each investor of an epoch the group issued, and a `notifyRedeem` for each
   * of an epoch it revoked, who is not notified yet. They cannot share the Execute transaction on v3.3: the issue and
   * the revoke go through `Hub.managerCall`, and a claim is a call of the `BatchRequestManager` itself.
   *
   * Call it right after the Execute confirms, with the same `datas`, when {@link Pool.hasClaimsAfterExecution} says
   * the group has claims. Investors and claim counts both come from the indexer, and nothing is read from the chain:
   * for each epoch the group issues or revokes it lists the investors whose closed order is not notified yet, and
   * notifies each for the number of their closed orders of the asset that are not notified, which is the window
   * `BatchRequestManager` counts as claimable. It sends at most as many investors per asset as the order flows
   * notify beside the messages of the hub batch, so a pool with more needs the call again: the claims are
   * permissionless, a notified investor drops out of the list, and the same `datas` can be passed again. The fee for
   * the callbacks is paid with the transaction and unspent gas is refunded to the signer. The transaction is no Hub
   * call, so no hub policy judges it.
   *
   * It first waits for the indexer to process the settlement, which is when every epoch the group issues or revokes
   * shows as closed for its asset, asking every 3 seconds for up to 2 minutes. Nothing is emitted while it waits. If the
   * indexer has not caught up by then it throws, with nothing signed, and the call can be made again. A read that fails
   * (the REST target refuses the per-investor reads) throws at once.
   *
   * @param datas - The calldata of each call of the group, as passed to {@link Pool.executeAuthorizations}.
   * @throws UnsupportedForProtocolVersionError on a pool that runs protocol v3.2, which has no policies and bundles
   * its claims in the batch.
   * @throws Error before anything is read when `datas` is empty, an entry repeats, an entry is not a call of the v3.3
   * Hub for this pool that an SDK entity builds, or the group holds no issue or revoke: it has no claims to send, which
   * {@link Pool.hasClaimsAfterExecution} tells beforehand. Also, after the pool's version is read, when no issue or
   * revoke of the group goes to the pool's `BatchRequestManager`, when an asset it settles is on a chain whose
   * cross-chain messaging is disabled, when the indexer has not processed the execution within the wait, and when every
   * investor of the settled epochs is already claimed, so there is nothing to claim.
   */
  claimsAfterExecution(datas: HexString[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const title = 'Notify claims'
      const group = parseGroup(self, datas, CLAIMS_METHOD)
      if (!group.some((call) => settlesOrders(call, self.id))) throw noSettlementError()
      const hubCtx = await self.#hubPolicyContext(CLAIMS_METHOD)
      const plan = await planClaims(self._root, self, hubCtx, ctx.signingAddress, group, ctx.signal)

      yield* wrapTransaction(title, ctx, {
        contract: hubCtx.batchRequestManager,
        data: plan.data,
        messages: plan.messages,
      })
    }, this.centrifugeId)
  }

  /**
   * Cancel the authorization of one hub call that is scheduled, matured or expired, so it can no longer be consumed
   * and the same calldata can be scheduled again. `data` is the calldata that was scheduled. The id is derived under
   * the policy installed now, so an authorization scheduled under an earlier install cannot be canceled: the
   * transaction reverts with `Unauthorized`, as it does when none exists. The policy classifies this call too: a signer
   * that `StdHubPolicy` confines to selectors that leave `cancelAuthorization` out ends the transaction in an
   * `OutOfPolicy` status with a `forbidden` call (reason `callerNotAllowed`), and nothing is signed or sent. An awaited
   * transaction resolves with that status and has no hash.
   *
   * @param data - The calldata of the hub call whose authorization to cancel: whole-byte hex that starts with a
   * function selector and is not a multicall wrapper.
   * @throws UnsupportedForProtocolVersionError on a pool that runs protocol v3.2, which has no policies.
   * @throws Error when `data` is not the calldata of one hub call.
   */
  cancelAuthorization(data: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const hubCtx = await self.#hubPolicyContext('Pool.cancelAuthorization')
      assertAuthorizationCalldata(data, 'Pool.cancelAuthorization')

      yield* wrapTransaction('Cancel authorization', ctx, {
        contract: hubCtx.hub,
        policy: { poolId: self.id },
        data: encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'cancelAuthorization',
          args: [self.id.raw, data],
        }),
      })
    }, this.centrifugeId)
  }

  /**
   * The policy installed on this pool's hub with the parameters its contract was deployed with, or `null` when the pool
   * runs protocol v3.2 or has no policy: no install, or the latest install is the zero address.
   *
   * The install is the latest `HUB_REGISTRY_SET_POLICY` row of the pool on its hub chain and the parameters are the
   * `hub_policy` row of the same log, read through the public API (the read fails on the `api-v3` target). `expiry()`
   * is read from the policy contract only when that row is missing or carries none. A parameter the indexer did not
   * publish stays `null`, never `0` or `false`: show it as nothing and raise no alert. A latest install whose log
   * carried no policy address gives `address: null` and every parameter `null`.
   *
   * It refreshes when the indexer poll lands (`indexerPollingInterval`, 120 s by default and five times that while a
   * push seam is connected), so a policy installed by the caller's own write shows once the indexer has processed it
   * and the next poll arrives. {@link Pool.refreshHubPolicyReads} asks for the refresh now.
   * @throws AuthorizationFoldError when the rows are broken: rows of another pool, a hub row of another chain, or a
   * malformed number. A failing `expiry()` read other than a missing view fails the query.
   */
  hubExecutionPolicy(): Query<HubExecutionPolicy | null> {
    return this._query(['hubExecutionPolicy', this.id.toString()], () => readHubExecutionPolicy(this._root, this))
  }

  /**
   * The pool's authorizations, one item per scheduling run, folded from the indexed policy and authorization log
   * (the read fails on the `api-v3` target) and judged at the hub chain's latest block time as of the refresh: `status`
   * is `scheduled`, `matured`, `expired`, `undetermined`, `canceled`, `consumed` or `orphaned` (see
   * `AuthorizationStatus`), and each item carries the scheduled `data`, its `functionName` and its decoded `args`.
   * Calldata scheduled again after a cancel or a consumption is a new item, so the earlier run stays in the list; key
   * rows by `runId`, which `authId` cannot do since the runs of one calldata share it. A `consumed` item has the time
   * and transaction it was executed in (`executedAt`, `executedTxHash`), a `canceled` item those of its cancel
   * (`canceledAt`, `canceledTxHash`). Items are in scheduling order, and those that share a `txHash` were scheduled
   * together. `skipped` names the rows and runs the index holds too little for (read again later). An empty list on a
   * pool that runs protocol v3.2.
   *
   * Execute a group with {@link Pool.executeAuthorizations}, passing the `data` of the items that share a `txHash` in list
   * order; every item must be ready on the chain when it is sent, which for a scheduled call means `matured`, or the
   * transaction ends in `OutOfPolicy` naming it. A call that carries a refund address is consumed only by calldata with
   * the same refund address, which is `args.refund` of the item. `expiry()` is read from the policy contract only when
   * the latest install's row gives none.
   *
   * It refreshes when the indexer poll lands (`indexerPollingInterval`, 120 s by default and five times that while a
   * push seam is connected), not after the caller's own write until the indexer has processed it and the next poll
   * arrives; {@link Pool.refreshHubPolicyReads} asks for the refresh now. The SDK runs no timer of its own: a consumer that wants a live label computes it from `validAfter` and
   * `expiresAt` against its own clock or the chain's time.
   * @throws AuthorizationFoldError when the rows are broken: rows of another pool, a hub row of another chain, a hub
   * row without a column it needs, or a malformed number. A failing `expiry()` or block read fails the query.
   */
  authorizations(): Query<PoolAuthorizationList> {
    return this._query(['authorizations', this.id.toString()], () => readAuthorizations(this._root, this))
  }

  /**
   * Reads the indexer again for {@link Pool.hubExecutionPolicy} and {@link Pool.authorizations}, for after the caller's
   * own write: it drops their cached results and the two indexer queries behind them, and every subscription of the two
   * that is already running fetches and emits again once the indexer answers. Nothing else of the pool is cleared.
   * `centrifuge.clearQueryCache` does not do this: a running subscription keeps its observable and refreshes only when
   * the indexer poll lands.
   *
   * It refreshes what the indexer has. A write shows there only once the indexer has processed its transaction, so a
   * call made straight after the write can still return the old rows. Executing the group or running the owning action
   * again reads the chain.
   */
  refreshHubPolicyReads(): void {
    refreshHubPolicyReads(this._root, this)
  }

  /** The pool's hub context, refused on protocol versions before v3.3, where no hub policy exists. */
  async #hubPolicyContext(method: string) {
    const hubCtx = await this._root.protocolContext(this.id)
    if (!isV3_3(hubCtx)) {
      throw new UnsupportedForProtocolVersionError(
        method,
        hubCtx.protocolVersion,
        'hub policies and authorizations exist on protocol v3.3 only'
      )
    }
    return hubCtx
  }

  /**
   * Get the configured adapter set and signature threshold for this pool on a
   * specific network. Reads the MultiAdapter on the pool's hub chain.
   *
   * Use {@link Pool.globalAdapters} for the default (pool 0) set of the pool's protocol version.
   *
   * @param centrifugeId - The centrifuge ID of the destination network
   */
  adapters(centrifugeId: CentrifugeId) {
    return this._query(['adapters', this.id.toString(), centrifugeId], () =>
      this._root._readMultiAdapter(this.id, centrifugeId, this.id.raw)
    )
  }

  /**
   * The global (pool 0) adapter set and signature threshold for messages toward a network, read on the hub's
   * MultiAdapter of this pool's protocol version: the adapters this pool can use on that route. On a chain that
   * hosts two versions, `centrifuge.globalAdapters(hub, target)` answers the newest version's set instead, whose
   * adapters cannot carry an older pool's messages.
   *
   * @param centrifugeId - The centrifuge ID of the destination network
   */
  globalAdapters(centrifugeId: CentrifugeId) {
    return this._query(['globalAdapters', this.id.toString(), centrifugeId], () =>
      this._root._readMultiAdapter(this.id, centrifugeId, 0n)
    )
  }

  /**
   * The global (pool 0) adapter set and signature threshold on a network's MultiAdapter of this pool's protocol
   * version, which is the hub's, for messages toward the hub; a spoke between the hub's `Activated` and its own
   * `Onboarded` is read on its v3.3 MultiAdapter, though its own context still reads v3.2: the remote counterparts of {@link Pool.globalAdapters}, and the addresses
   * `setAdapters` takes as `remoteAdapters` for that network. An adapter's address can differ between chains (v3.2
   * LayerZero on testnet centrifugeId 9), so the hub's addresses are not valid remote ones. Nothing on chain ties
   * the order of the two sets; deployments configure them with the same bridges in the same order. Reads the
   * network's chain, so it needs a client there, and throws `ProtocolVersionResolutionError` when the hub's
   * version is not deployed there.
   *
   * @param centrifugeId - The centrifuge ID of the destination network
   */
  remoteGlobalAdapters(centrifugeId: CentrifugeId) {
    return this._query(['remoteGlobalAdapters', this.id.toString(), centrifugeId], () =>
      this._root._readMultiAdapter(this._root._poolContextAtHubVersion(this.id, centrifugeId), this.centrifugeId, 0n)
    )
  }

  /**
   * The adapter addresses the registry lists for this pool's protocol version on a network, which is the hub's, so a
   * spoke between the hub's `Activated` and its own `Onboarded` answers its v3.3 adapters; the pool-scoped
   * counterpart of `centrifuge.adapters(centrifugeId)`, which answers the network's newest version. Use it to name
   * adapters. `layerZeroAdapter` is in every deployment; the others are `undefined` where the registry lists none,
   * which includes adapters a MultiAdapter holds but the registry does not ship (v3.2's Wormhole). For the
   * addresses a route can use, read {@link Pool.globalAdapters} and {@link Pool.remoteGlobalAdapters}. Throws
   * `ProtocolVersionResolutionError` when the hub's version is not deployed there.
   *
   * @param centrifugeId - The centrifuge ID of the network
   */
  deployedAdapters(centrifugeId: CentrifugeId) {
    return this._query(['deployedAdapters', this.id.toString(), centrifugeId], () =>
      this._root._poolContextAtHubVersion(this.id, centrifugeId).pipe(map(deployedAdapterAddresses))
    )
  }

  /**
   * Per-adapter live + in-flight state for this pool on the spoke→hub route,
   * from the indexer. `isEnabled` is the set confirmed live on the spoke;
   * `crosschainInProgress` flags an adapter whose enable/disable was triggered
   * on the hub but has not yet been confirmed on the spoke (`null` once settled).
   *
   * Unlike `adapters()` — which reads the hub MultiAdapter and so reports a
   * triggered change as already active — this reflects what is actually live
   * versus still in transit.
   *
   * @param centrifugeId - The centrifuge ID of the spoke network
   */
  adapterStatus(centrifugeId: CentrifugeId): Query<AdapterStatus[]> {
    return this._query(['adapterStatus', this.id.toString(), centrifugeId, this.centrifugeId], () =>
      this._root
        ._queryData<PoolAdapterRow[]>('poolAdapters', {
          poolId: this.id.toString(),
          localCentrifugeId: String(this.centrifugeId),
          remoteCentrifugeId: String(centrifugeId),
        })
        .pipe(
          map((poolAdapters): AdapterStatus[] =>
            poolAdapters.map((item) => ({
              address: item.adapterAddress.toLowerCase() as HexString,
              name: item.adapter?.name ?? 'unknown',
              isEnabled: !!item.isEnabled,
              crosschainInProgress: item.crosschainInProgress as AdapterProgress,
            }))
          )
        )
    )
  }

  /**
   * The v3.2 to v3.3 migration of this pool, or `null` when it never armed:
   * the hub phase, and per spoke its phase, the relayed steps with where
   * each landed, and the gate state the migration module derives.
   */
  migration(): Query<PoolMigration | null> {
    return this._query(['migration', this.id.toString()], () =>
      combineLatest([
        this._root._queryData<PoolMigrationRow | null>('poolMigration', { poolId: this.id.toString() }),
        this._root._queryData<PoolMigrationStepRow[]>('poolMigrationSteps', { poolId: this.id.toString() }),
      ]).pipe(
        switchMap(([row, steps]) => {
          if (row === null) return of(null)
          const hubPhase = hubPhaseOfRow(row.hubPhase)
          const ids = messageIdsOf(this.centrifugeId, steps)
          const messages$ =
            ids.length === 0
              ? of([] as CrosschainMessageRow[])
              : this._root._queryData<CrosschainMessageRow[]>('crosschainMessageRows', { ids })
          const recorded = spokeIdsOf(row, steps)
          // A spoke the pool is live on but never armed can still be armed while the hub is Armed or
          // HubOnboarded; after activation nothing is, and a native v3.3 spoke must not read as one.
          const live$ =
            hubPhase === 'armed' || hubPhase === 'hubOnboarded'
              ? defer(() => this.migrationSpokeCandidates(recorded)).pipe(
                  map((candidates) => activeSpokesOf(candidates).filter((cid) => !recorded.includes(cid)))
                )
              : of([] as CentrifugeId[])
          return live$.pipe(
            switchMap((liveSpokes) => {
              const facade$ = readFacadeFlags(this._root, this, hubPhase, [...recorded, ...liveSpokes])
              return combineLatest([messages$, facade$]).pipe(
                map(([messages, facade]) => assembleMigration({ row, hubPhase, steps, messages, facade, liveSpokes }))
              )
            })
          )
        })
      )
    )
  }

  /**
   * The chains this pool's migration can touch, each confirmed on its chain: the chain directory, the
   * v3.2 hub's spoke record and `migrationSpokes`, with a chain that cannot be read named `unreadable`.
   * @internal
   */
  migrationSpokeCandidates(migrationSpokes: readonly CentrifugeId[] = []): Promise<MigrationSpokeCandidates> {
    return migrationSpokeCandidates(this._root, this, migrationSpokes)
  }

  /**
   * Whether this pool's migration allows `action` on one network now: the
   * answer the migration gate gives a write before it builds, from the same
   * derivation (the hub chain without a spoke row is judged from the hub
   * phase). `action` is a gate row key from `MIGRATION_ACTION` or an SDK
   * action name such as `requestDeposit` or `crosschainTransferShares`; a name
   * the gate table does not map, and every action on a pool that is not
   * migrating, is allowed. A bridge passes `destinationCentrifugeId` and is
   * judged at both ends. Each read asks the gate's own derivation afresh, the
   * facade first and the indexer only for a migrating pool; a state that cannot
   * be read is a refusal. The answer is not cached and does not update: read
   * it again before a write.
   * @param action - The gate row key or SDK action name
   * @param centrifugeId - The network the action keys on (the vault's chain; the source of a bridge)
   * @param options.destinationCentrifugeId - The destination of a bridge
   */
  isAllowed(
    action: MigrationAction | PoolActionName,
    centrifugeId: CentrifugeId,
    options: { destinationCentrifugeId?: CentrifugeId } = {}
  ): Query<MigrationGateAnswer> {
    const { destinationCentrifugeId } = options
    return this._query(null, () =>
      defer(() =>
        this._root._migrationGateAnswer(this.id.toString(), action, [
          { centrifugeId, ...(destinationCentrifugeId !== undefined ? { destinationCentrifugeId } : {}) },
        ])
      )
    )
  }

  /**
   * One migration operation on the facade, signed by the pool's hub manager
   * on the chain the operation belongs to: the hub for every step, the spoke
   * as well for `installPoolAdapters`, the chain itself for `lock`. The call
   * is simulated with `simulateCalls` before anything is signed and refused
   * on a failing simulation; the relays it pays for are priced like any other
   * cross-chain write.
   */
  migrationStep(operation: MigrationOperation, options?: MigrationSendOptions): Transaction {
    const self = this
    const signedOn = migrationOperationChain(this.id, operation)
    return this._transact(async function* (ctx) {
      const built = buildMigrationOperation({
        environment: self._root.config.environment,
        poolId: self.id,
        signedOn,
        refundAddress: ctx.signingAddress,
        operation,
      })
      const messages = migrationOperationMessages(
        self.id,
        operation,
        await migrationRelayTargets(ctx.publicClient, self.id, operation, self._root.config.environment)
      )
      if (!ctx.isBatching && !ctx.isBuilding) {
        // The relays' fee is part of the value the gateway checks, so the call is simulated with it.
        const value = await valueWithMessageFees(
          ctx,
          built.value,
          Object.keys(messages).length > 0 ? messages : undefined
        )
        const { results } = await ctx.publicClient.simulateCalls({
          account: ctx.signingAddress,
          calls: [{ to: built.to, data: built.data, value }],
        })
        const failed = results.find((result) => result.status === 'failure')
        if (failed) throw new MigrationSimulationError(operation.name, failed.error)
        yield { type: 'TransactionSimulation', title: `Migration ${operation.name}`, result: results }
      }
      yield* wrapTransaction(`Migration ${operation.name}`, ctx, {
        contract: built.to,
        data: built.data,
        value: built.value,
        messages: Object.keys(messages).length > 0 ? messages : undefined,
        gas: options?.gas,
      })
    }, signedOn)
  }

  /**
   * Hub migration operations sent as one transaction through the facade's
   * `multicall`, for an operator that signs alone (a Safe batches on its own).
   * Each entry carries what {@link migrationStep} would send for it alone, its
   * relays priced at signing, and the transaction's value is their sum. Before
   * anything is signed the entries are simulated in order, each on the state
   * the earlier ones leave, so a failing one is named with its place in the
   * bundle; the bundle is simulated after them. One operation is
   * {@link migrationStep}. `lock` and `forceRelease` cannot join a bundle of
   * two or more. A plan bundle of two or more entries holds only
   * entries with an operation: `bundle.entries.map((i) => plan.entries[i].operation!)`.
   * Under `buildOnly` the fees are priced when the transaction is built, carried
   * in `value`, and no `messages` are returned, since the entries' values are
   * part of the calldata.
   */
  migrationBundle(operations: readonly MigrationOperation[], options?: MigrationSendOptions): Transaction {
    if (operations.length === 0) throw new Error('A migration bundle needs at least one operation')
    const offHub = operations.find((operation) => migrationOperationChain(this.id, operation) !== this.centrifugeId)
    if (offHub) {
      throw new Error(
        `Migration operation ${offHub.name} is not signed on the hub chain ${this.centrifugeId}, so it cannot join the facade's multicall`
      )
    }
    if (operations.length === 1) return this.migrationStep(operations[0]!, options)
    // Inside multicall the sender is the facade, and these check msg.sender against the pool's lock admin.
    const lockAdmin = operations.find((operation) => operation.name === 'lock' || operation.name === 'forceRelease')
    if (lockAdmin) {
      throw new Error(
        `Migration operation ${lockAdmin.name} is checked against the lock admin as the sender, so it cannot join the facade's multicall; send it with migrationStep`
      )
    }
    const self = this
    const title = `Migration ${operations.map((operation) => operation.name).join(', ')}`
    return this._transact(async function* (ctx) {
      const environment = self._root.config.environment
      const entries = await Promise.all(
        operations.map(async (operation) => {
          const built = buildMigrationOperation({
            environment,
            poolId: self.id,
            signedOn: self.centrifugeId,
            refundAddress: ctx.signingAddress,
            operation,
          })
          const messages = migrationOperationMessages(
            self.id,
            operation,
            await migrationRelayTargets(ctx.publicClient, self.id, operation, environment)
          )
          const value = await valueWithMessageFees(
            ctx,
            built.value,
            Object.keys(messages).length > 0 ? messages : undefined
          )
          return { operation, to: built.to, data: built.data, value }
        })
      )
      const bundle = encodeMigrationBundle({ environment, poolId: self.id, entries })
      if (!ctx.isBatching && !ctx.isBuilding) {
        const alone = await ctx.publicClient.simulateCalls({
          account: ctx.signingAddress,
          calls: entries.map(({ to, data, value }) => ({ to, data, value })),
        })
        const failed = alone.results.findIndex((result) => result.status === 'failure')
        if (failed !== -1) {
          throw new MigrationSimulationError(entries[failed]!.operation.name, alone.results[failed]!.error, {
            index: failed + 1,
            count: entries.length,
          })
        }
        const { results } = await ctx.publicClient.simulateCalls({
          account: ctx.signingAddress,
          calls: [{ to: bundle.to, data: bundle.data, value: bundle.value }],
        })
        if (results[0]?.status === 'failure') throw new MigrationSimulationError('multicall', results[0].error)
        yield { type: 'TransactionSimulation', title, result: results }
      }
      yield* wrapTransaction(title, ctx, {
        contract: bundle.to,
        data: bundle.data,
        value: bundle.value,
        gas: options?.gas,
      })
    }, this.centrifugeId)
  }

  /**
   * Pins one unsigned migration record under `{environment}-migration-{poolId}`
   * through `config.pinJson` and answers its CID. One per point of no return.
   */
  async pinMigrationRecord(record: MigrationRecord): Promise<string> {
    if (record.poolId !== this.id.raw.toString()) {
      throw new Error(`migration record names pool ${record.poolId}, this pool is ${this.id.raw.toString()}`)
    }
    return this._root.config.pinJson(record, migrationRecordName(this._root.config.environment, this.id))
  }

  /**
   * The inputs of this pool's migration steps on one spoke, derived from the
   * live v3.2 stack of that chain at one block the way Protocol's
   * `MigrationInputs` derives them: the freeze's sync-reserve keys, the
   * offboard's vaults, rotation assets and managers, the spoke onboard's
   * seeds, and the manager grants the hub onboard carries for the spoke.
   * The indexer only names candidates; every list is decided on chain.
   */
  migrationInputs(centrifugeId: CentrifugeId, options: MigrationInputsOptions = {}): Query<MigrationSpokeInputs> {
    return this._query(['migrationInputs', this.id.toString(), centrifugeId, migrationInputsKey(options)], () =>
      defer(() => deriveMigrationSpokeInputs(this._root, this.id, centrifugeId, options))
    )
  }

  /**
   * Every ramp accounting id the spoke's v3.3 ramps need, a receipt and a liability id per ramp asset, each with
   * whether the spoke registry already knows it. The plan offers a registration only for the ones it does not.
   */
  migrationRampIds(centrifugeId: CentrifugeId): Query<MigrationRampId[]> {
    return this._query(['migrationRampIds', this.id.toString(), centrifugeId], () =>
      this.migrationInputs(centrifugeId).pipe(
        switchMap((inputs) => defer(() => rampIdsOf(this._root, this.id, centrifugeId, inputs)))
      )
    )
  }

  /**
   * The hub onboard's input, derived on the hub chain at one block: the live
   * v3.2 hub admins, the holding keys the v3.2 hub carries, the asset ids the
   * batch request manager has state for, and one manager grant set per armed
   * spoke, read on each spoke.
   */
  migrationHubInputs(spokeCentrifugeIds: CentrifugeId[], options: MigrationInputsOptions = {}): Query<MigrationHubInputs> {
    const key = ['migrationHubInputs', this.id.toString(), spokeCentrifugeIds.join(','), migrationInputsKey(options)]
    return this._query(key, () => defer(() => deriveMigrationHubInputs(this._root, this.id, spokeCentrifugeIds, options)))
  }

  /**
   * The plan of this pool's migration from the phases it holds now: every operator call of the current
   * checkpoints with the inputs the App would send, each simulated on the chain that signs it, sliced where the
   * destination's batch ceiling refuses the whole, and grouped into the approvals a signer makes. Derived at
   * every read, never stored; re-planning at the same blocks reproduces the same calldata. A spoke whose step
   * reverts in simulation, or that still has a parked message, stops with the reason and the others carry on.
   */
  migrationPlan(options: MigrationPlanOptions = {}): Query<MigrationPlan> {
    return this._query(['migrationPlan', this.id.toString(), migrationPlanKey(options)], () =>
      this.migration().pipe(
        distinctUntilChanged((a, b) => migrationFingerprint(a) === migrationFingerprint(b)),
        switchMap(() => defer(() => deriveMigrationPlan(this._root, this, options)))
      )
    )
  }

  /**
   * The one action the migration's call order puts first: the first entry of {@link migrationPlan}, or the wait
   * on a relayed step still in flight, or `null` once nothing remains.
   */
  migrationNextAction(options: MigrationPlanOptions = {}): Query<MigrationNextAction | null> {
    return this._query(['migrationNextAction', this.id.toString(), migrationPlanKey(options)], () =>
      combineLatest([this.migrationPlan(options), this.migration()]).pipe(
        map(([plan, migration]) => nextActionOf(plan, stepsInFlight(migration)))
      )
    )
  }

  /**
   * The pre-check of this pool's migration, the way Protocol's `PreCheck.s.sol` reports it: every row the
   * contract no longer refuses, with its severity, the step it concerns, the chain and the source it was read
   * from, before the operator signs. The hub report runs on the hub chain, the spoke report on every active
   * network, the gateway checks once; `blockingRows` are the STOP rows and the two WARN rows the App holds a
   * step on (AS38 parents-first before arming, AS43 an unarmed live spoke at the hub onboard). Read-only, at
   * each chain's head block; the indexer only names candidates, every row is decided on chain.
   */
  migrationPreCheck(options: MigrationPreCheckOptions = {}): Query<PreCheckReport> {
    return this._query(['migrationPreCheck', this.id.toString(), migrationPreCheckKey(options)], () =>
      deriveMigrationPreCheck(this._root, this, options)
    )
  }

  /**
   * What investors can still claim on one spoke's v3.2 ARM: an executed deposit's shares and a redeem payout, per
   * vault and investor, read without the rest of the pre-check. Both are lost to the investor after the first
   * offboard toward the spoke. Empty once the pool runs on v3.3.
   */
  migrationClaimables(centrifugeId: CentrifugeId): Query<MigrationClaimables> {
    return this._query(['migrationClaimables', this.id.toString(), centrifugeId], () =>
      deriveMigrationClaimables(this._root, this, centrifugeId)
    )
  }

  /**
   * The live guards before plan entry `index` is signed, the way `SendStep` checks them: the signer is the
   * recorded operator (and a live v3.2 hub manager where the step requires one), the entry's recorded phases
   * are the phases the chains read now, every armed spoke reads the phase a hub step waits on, the spoke stands
   * at the hub's current freeze generation with no Abort relayed at it before an offboard, no chain the entry
   * touches is locked, no earlier entry is still to be signed on a chain it sends toward, and the entry before
   * it landed. Each row names what it read, where and at which block. A failing row refuses the signature
   * before anything is simulated; `stale` marks a guard the pool moved past, which calls for a new plan.
   */
  migrationGuards(plan: MigrationPlan, index: number, options: MigrationGuardsOptions = {}): Query<GuardRow[]> {
    const fingerprint = keccak256(
      toHex(`${plan.hubPhase}|${plan.entries.slice(0, index + 1).map((entry) => entry.data).join('|')}`)
    )
    return this._query(
      [
        'migrationGuards',
        this.id.toString(),
        index,
        options.signer ?? '',
        String(options.ignoreStepsInFlight ?? ''),
        (options.sentWith ?? []).join(','),
        fingerprint,
      ],
      () =>
        this.migration().pipe(
          switchMap(() => defer(() => deriveMigrationGuards(this._root, this, plan, index, options)))
        )
    )
  }

  /**
   * Where a plan entry's relayed steps landed, off {@link migration}: the latest relay of each step the entry's
   * operation sends toward the spoke it concerns, among the relays from `options.sinceBlock` on (pass the plan's
   * hub block, `plan.chains`, so an earlier generation's relay never reads as this entry), `pending` before any,
   * `inFlight`, `landed`, `parked` with the spoke's revert reason, or `dropped`. A same-chain entry never reads in
   * flight; an entry that relays no step reads `none`.
   */
  migrationLanding(entry: MigrationPlanEntry, options: { sinceBlock?: number } = {}): Query<EntryLanding> {
    const sinceBlock = options.sinceBlock ?? null
    return this._query(['migrationLanding', this.id.toString(), entry.concerns, entry.data, sinceBlock ?? ''], () =>
      this.migration().pipe(map((migration) => entryLanding(entry, migration, sinceBlock)))
    )
  }

  /**
   * The settle report of one remote spoke, the way Protocol's `MigrationSettle` reads it: every batch the spoke
   * executed for the pool (off the indexer's payload rows, held to the hub's relayed step records), each own
   * parked message classified by the refusal a retry meets now (`waiting`, `dead`, `blocking`, `dormant`), and
   * the retries that land, found by simulating `Gateway.retry` in the hub's send order until a pass lands
   * nothing. `operations` are the retries to sign through {@link migrationSettle}, in that order. A parked
   * Abort, and every Freeze or offboard step of its generation or below, is never retried while the Abort can
   * land. The original message is retried, never re-planned (AS47).
   */
  migrationSettleReport(centrifugeId: CentrifugeId, options: MigrationSettleOptions = {}): Query<MigrationSettleReport> {
    return this._query(['migrationSettleReport', this.id.toString(), migrationSettleKey(centrifugeId, options)], () =>
      this.migration().pipe(switchMap(() => defer(() => deriveMigrationSettle(this._root, this, centrifugeId, options))))
    )
  }

  /**
   * After `activate`: each armed spoke's own v3.3 VaultRouter and whether it holds `bridger` on the pool. A spoke
   * reads `grant` once its reserve restore landed and the router lacks the grant, `holds` once granted, `waits`
   * while the restore is in flight (a restore landing later would overwrite the grant), `unreadable` when its
   * chain could not be read. The `grant` spokes go in one hub multicall through {@link migrationSettle}.
   */
  migrationRouterBridger(): Query<RouterBridgerSpoke[]> {
    return this._query(['migrationRouterBridger', this.id.toString()], () =>
      this.migration().pipe(switchMap(() => defer(() => routerBridgerState(this._root, this))))
    )
  }

  /**
   * One settle operation: `retry` sends `Gateway.retry` of the original parked message on the spoke chain, which
   * anyone signs, with the gas the wallet estimates for it; `routerBridger` grants the v3.3 VaultRouter `bridger`
   * on the named spokes in one hub multicall, signed by a hub manager, the relay toward each remote spoke priced
   * like any other cross-chain write.
   */
  migrationSettle(operation: MigrationSettleOperation): Transaction {
    const self = this
    if (operation.kind === 'retry') {
      return this._transact(async function* (ctx) {
        const ctx33 = await self._root.protocolContext({ centrifugeId: operation.centrifugeId, protocolVersion: '3.3' })
        const data = encodeFunctionData({
          abi: ABIS_V3_3.Gateway,
          functionName: 'retry',
          args: [self.centrifugeId, operation.message],
        })
        if (!ctx.isBatching && !ctx.isBuilding) {
          const parked = (await ctx.publicClient.readContract({
            address: ctx33.gateway,
            abi: ABIS_V3_3.Gateway,
            functionName: 'failedMessages',
            args: [self.centrifugeId, keccak256(operation.message)],
          })) as bigint
          if (parked === 0n) {
            throw new MigrationSettleError(
              'migrationSettle: the message is no longer parked on this spoke (retried already, or cleared); read the settle report again'
            )
          }
          const { results } = await ctx.publicClient.simulateCalls({
            account: ctx.signingAddress,
            calls: [{ to: ctx33.gateway, data }],
          })
          const failed = results.find((result) => result.status === 'failure') as { data?: HexString } | undefined
          if (failed) {
            throw new MigrationSettleError(
              `migrationSettle: the retry reverts now: ${describeSettleRevert(failed.data ?? '0x')}`
            )
          }
          yield { type: 'TransactionSimulation', title: 'Migration settle: retry', result: results }
        }
        yield* wrapTransaction('Migration settle: retry', ctx, { contract: ctx33.gateway, data })
      }, operation.centrifugeId)
    }
    return this._transact(async function* (ctx) {
      const pool = await self._root.protocolContext(self.id)
      const spokes = await routerBridgerState(self._root, self)
      const calls: HexString[] = []
      const messages: Record<CentrifugeId, MessageTypeWithSubType[]> = {}
      for (const cid of operation.spokeCentrifugeIds) {
        const spoke = spokes.find((s) => s.centrifugeId === cid)
        if (!spoke || spoke.state !== 'grant' || !spoke.router) {
          throw new Error(`migrationSettle: cid ${cid} is not ready for the router bridger grant (${spoke?.state ?? 'not armed'})`)
        }
        calls.push(
          builders.updateManager(builderContext(pool), {
            poolId: self.id.raw.toString(),
            centrifugeId: String(cid),
            kind: 'bridger',
            address: spoke.router,
            canManage: true,
            refundAddress: ctx.signingAddress,
          }).data as HexString
        )
        if (cid !== self.centrifugeId) messages[cid] = [messageV3_3(MessageTypeV3_3.UpdateManager, self.id)]
      }
      if (calls.length === 0) throw new Error('migrationSettle: no spoke to grant')
      yield* wrapTransaction('Migration settle: router bridger', ctx, {
        contract: pool.hub,
        policy: { poolId: self.id },
        data: calls,
        messages: Object.keys(messages).length > 0 ? messages : undefined,
      })
    }, this.centrifugeId)
  }

  /**
   * What still has to settle on one spoke before its first offboard: the
   * pending and queued deposits and redemptions per share class and asset.
   */
  migrationDrainWorklist(centrifugeId: CentrifugeId): Query<MigrationDrainItem[]> {
    return this._query(['migrationDrainWorklist', this.id.toString(), centrifugeId], () =>
      this.shareClasses().pipe(
        switchMap((shareClasses) =>
          shareClasses.length === 0
            ? of([] as MigrationDrainItem[])
            : combineLatest(
                shareClasses.map((shareClass) =>
                  combineLatest([shareClass._investOrders(), shareClass._redeemOrders(), shareClass._balances()]).pipe(
                    map(([invest, redeem, holdings]) =>
                      drainItemsOf(
                        centrifugeId,
                        shareClass.id.raw,
                        invest,
                        redeem,
                        new Map(holdings.map((holding) => [holding.assetId, holding.asset.decimals]))
                      )
                    )
                  )
                )
              ).pipe(map((perShareClass) => perShareClass.flat()))
        )
      )
    )
  }

  /**
   * Query cross-chain messages (indexer-side: `CrosschainPayload`) for this
   * pool. Without a filter, returns the most recent batch across all routes
   * and statuses; `filter.status` is the common case (e.g. `'InTransit'` for
   * pending in-flight messages).
   *
   * Use `filter.include` to opt into nested data (pool, token, blockchains,
   * inner messages, adapter participations). For paginating very long lists,
   * pass `before`/`after` cursors from a previous page's `pageInfo`.
   */
  crosschainMessages(filter: Omit<CrosschainMessagesFilter, 'poolId'> = {}) {
    return queryCrosschainMessages(this._root, { ...filter, poolId: this.id })
  }

  /**
   * Look up a single cross-chain message of THIS pool by its composite key
   * `(payloadId, payloadIndex)`. Returns `undefined` when the indexer has no
   * such record for this pool. By default all available joins (pool, token,
   * blockchains, inner messages, adapter participations) are included.
   *
   * The pool-scoped mirror of `centrifuge.crosschainMessage()`, for the same
   * reason `crosschainMessages()` has one: the backend route is
   * `GET /pools/:poolId/crosschain-messages/:id`, gated `@PoolMembers()` on the
   * pool in its path, so the unscoped call has no endpoint to reach in backend
   * mode and refuses there rather than guessing a pool. Use this one from the
   * management app; `centrifuge.crosschainMessage()` remains for public mode.
   *
   * The backend answers 404 `CROSSCHAIN_MESSAGE_NOT_FOUND` both for a payload
   * that does not exist and for one belonging to another pool — no cross-pool
   * existence oracle — and the route table maps that single code to
   * `undefined`, which is the answer this method's signature already had.
   */
  crosschainMessage(id: HexString, index: number, include?: CrosschainMessageIncludes) {
    return queryCrosschainMessage(this._root, id, index, include, this.id)
  }

  createAccounts(accounts: { accountId: bigint; isDebitNormal: boolean }[]) {
    const self = this
    return this._transact(async function* (ctx) {
      const { hub, contractAbis: ABI } = await self._root.protocolContext(self.id)
      const txBatch = accounts.map(({ accountId, isDebitNormal }) =>
        encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'createAccount',
          args: [self.id.raw, accountId, isDebitNormal],
        })
      )

      yield* wrapTransaction('Create accounts', ctx, {
        contract: hub,
        policy: { poolId: self.id },
        data: txBatch,
      })
    }, this.centrifugeId)
  }

  getEscrowAddress() {
    return this._escrow()
  }

  /**
   * @internal
   */
  _shareClassIds() {
    return this._query(['shareClasses', this.id.toString()], () =>
      combineLatest([this._root.protocolContext(this.id), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([{ shareClassManager, contractAbis: ABI, protocolVersion }, client]) =>
          defer(async () => {
            const count = await client.readContract({
              address: shareClassManager,
              abi: ABI.ShareClassManager,
              functionName: 'shareClassCount',
              args: [this.id.raw],
            })
            return Array.from({ length: count }, (_, i) => ShareClassId.from(this.id, i + 1))
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: shareClassManager,
                eventName: 'AddShareClass',
                filter: (events) => {
                  return events.some((event) => event.args.poolId === this.id.raw)
                },
              },
              this.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /**
   * The pool's escrow at its resolved protocol version, read from its escrow factory on
   * `centrifugeId` (the hub chain by default). Spoke-side reads pass their own chain: the
   * escrow is the one that chain's balance sheet and vaults use.
   * @internal
   */
  _escrow(centrifugeId: CentrifugeId = this.centrifugeId) {
    return this._query(['escrow', this.id.toString(), centrifugeId], () =>
      combineLatest([
        this._root.protocolContext({ poolId: this.id, centrifugeId }),
        this._root.getClient(centrifugeId),
      ]).pipe(switchMap(([ctx, client]) => poolEscrowAt(client, ctx, this.id)))
    )
  }

  /** @internal */
  _managers() {
    return this._query(null, () =>
      this._root._queryData<PoolManagerRow[]>('poolManagers', { poolId: this.id.toString() }).pipe(
        map((poolManagers) => {
          return poolManagers.map((manager) => {
            return {
              address: manager.address.toLowerCase() as HexString,
              isHubManager: manager.isHubManager,
              isBalancesheetManager: manager.isBalancesheetManager,
              crosschainInProgress: manager.crosschainInProgress as ManagerProgress,
              centrifugeId: Number(manager.centrifugeId),
            }
          })
        })
      )
    )
  }

  /**
   * Per-manager live + in-flight state for the Balance Sheet, from the indexer.
   * `isBalancesheetManager` is the set confirmed live on the spoke;
   * `crosschainInProgress` flags a grant/revoke that was triggered on the hub
   * but has not yet been confirmed on the spoke (`null` once settled).
   *
   * Unlike `balanceSheetManagers()` — which only returns the confirmed set, and
   * is what actual authorization checks (`isBalanceSheetManager()`) rely on —
   * this also surfaces managers still in transit, for display purposes.
   */
  balanceSheetManagerStatus(): Query<BalanceSheetManagerStatus[]> {
    return this._query(['balanceSheetManagerStatus', this.id.toString()], () => {
      return combineLatest([this._managers(), this._root.protocolContext(this.id)]).pipe(
        map(([managers, { asyncRequestManager, syncManager }]) => {
          return managers
            .filter((manager) => manager.isBalancesheetManager || manager.crosschainInProgress != null)
            .map((manager) => {
              let type: BalanceSheetManagerStatus['type'] = 'Custom'
              if (manager.address.toLowerCase() === asyncRequestManager.toLowerCase()) {
                type = 'AsyncRequestManager'
              } else if (manager.address.toLowerCase() === syncManager.toLowerCase()) {
                type = 'SyncManager'
              }

              return {
                address: manager.address,
                centrifugeId: manager.centrifugeId,
                type,
                isBalancesheetManager: manager.isBalancesheetManager,
                crosschainInProgress: manager.crosschainInProgress as ManagerProgress,
              }
            })
        })
      )
    })
  }
}
