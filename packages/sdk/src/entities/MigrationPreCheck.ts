import { getMessageId, HUB_PHASE, SPOKE_PHASE } from '@centrifuge/protocol'
import { isAddressEqual, parseAbi, zeroAddress, type Abi } from 'viem'
import type { PoolMigrationRow } from '@centrifuge/queries/core'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'
import {
  addressToBytes32,
  answered,
  CLASS_PROBE_MAX,
  HUB_ASSET_CID_MAX,
  HUB_ASSET_COUNTER_MAX,
  includes,
  LEGACY_ABI,
  MAX_V32_CENTRIFUGE_ID,
  MigrationInputsDerivation,
  present,
  topicOf,
  unique,
  word,
  type Call,
  type MigrationInputSource,
  type MigrationInputsReader,
  type MigrationLiveVault,
  type MigrationSpokeCandidates,
  type Result,
  type V32Refs,
} from './MigrationInputs.js'
import { laneAdapters } from './migrationLanes.js'
import type { MigrationPlanPhase, UnreadableSpoke } from './MigrationPlan.js'
import { hubPhaseOfRow, spokePhaseOfRow } from './PoolMigration.js'

export type PreCheckSeverity = 'stop' | 'warn' | 'gap' | 'info'
export type PreCheckStep = MigrationPlanPhase | 'lanes' | 'drain' | 'launch'
export type PreCheckSource = MigrationInputSource | 'record' | 'attest'

export type PreCheckAmount = {
  raw: bigint
  /** `null` when the asset did not answer `decimals()`. */
  decimals: number | null
  asset?: HexString
  /** The amount in the pool's currency at the v3.2 spoke's stored price, 18 decimals; absent when no price is stored. */
  inPoolCurrency?: bigint
}

export const PRECHECK_CODES = [
  'gateway.hubToSpoke.noExecutedOnLane',
  'gateway.hubToSpoke.notExecuted',
  'gateway.hubToSpoke.parkedTransferIgnored',
  'gateway.hubToSpoke.sameChainSpoke',
  'gateway.hubToSpoke.summary',
  'gateway.quiet.candidatesGap',
  'gateway.quiet.deferredToSpokes',
  'gateway.quiet.messageInFlight',
  'gateway.quiet.parkedTransferIgnored',
  'gateway.quiet.stuckPriceNotifies',
  'gateway.quiet.stuckSetPoolAdapters',
  'gateway.quiet.summary',
  'gateway.quiet.underpaidNotQueried',
  'hub.admins.admin',
  'hub.admins.candidatesGap',
  'hub.admins.issuerContract',
  'hub.admins.leftOnV32',
  'hub.admins.noLiveManager',
  'hub.admins.removedByOnboard',
  'hub.armingRecord.notArmed',
  'hub.assets.summary',
  'hub.breaker.circuitBreaker',
  'hub.identity.summary',
  'hub.identity.unknownToRegistry',
  'hub.investorOrders.candidatesGap',
  'hub.investorOrders.depositPending',
  'hub.investorOrders.investorSetGap',
  'hub.investorOrders.queuedDeposit',
  'hub.investorOrders.queuedDepositCancelling',
  'hub.investorOrders.queuedRedeem',
  'hub.investorOrders.queuedRedeemCancelling',
  'hub.investorOrders.redeemPending',
  'hub.investorOrders.summary',
  'hub.investorOrders.unclaimedDepositRounds',
  'hub.investorOrders.unclaimedRedeemRounds',
  'hub.liabilities.liability',
  'hub.liabilities.summary',
  'hub.operator.liveManager',
  'hub.operator.notInCandidates',
  'hub.operator.notManager',
  'hub.orders.depositEpochsCarried',
  'hub.orders.depositNotIssued',
  'hub.orders.pendingDeposit',
  'hub.orders.pendingRedeem',
  'hub.orders.redeemEpochsCarried',
  'hub.orders.redeemNotRevoked',
  'hub.orders.summary',
  'hub.reservation.notReserved',
  'hub.reservation.pastInitiate',
  'hub.reservation.reserved',
  'hub.reservation.unread',
  'hub.spokes.inactive',
  'hub.spokes.notRead',
  'hub.spokes.nothingToArm',
  'hub.spokes.setGap',
  'hub.spokes.sources',
  'hub.spokes.unreadable',
  'lanes.kindMismatch',
  'lanes.layerZeroOnly',
  'lanes.noClient',
  'lanes.noPoolAdapters',
  'lanes.noV33Stack',
  'lanes.peerSide',
  'lanes.peerUnreadable',
  'lanes.side',
  'migration.onV33',
  'spoke.assetIds.diverged',
  'spoke.assetIds.noV33Registry',
  'spoke.assetIds.renamedOnRotation',
  'spoke.assetIds.summary',
  'spoke.assetPrices.summary',
  'spoke.claimables.cancelledDeposit',
  'spoke.claimables.cancelledRedeem',
  'spoke.claimables.candidatesGap',
  'spoke.claimables.investorSetGap',
  'spoke.claimables.maxMint',
  'spoke.claimables.maxWithdraw',
  'spoke.claimables.pendingDeposit',
  'spoke.claimables.pendingRedeem',
  'spoke.claimables.summary',
  'spoke.classes.none',
  'spoke.classes.token',
  'spoke.escrow.alreadyRotated',
  'spoke.escrow.balanced',
  'spoke.escrow.belowTotals',
  'spoke.escrow.erc6909.accountingTokenDropped',
  'spoke.escrow.erc6909.leftBehind',
  'spoke.escrow.erc6909.positionsGap',
  'spoke.escrow.erc6909.stayed',
  'spoke.escrow.foreign.admitsUnknown',
  'spoke.escrow.foreign.noHook',
  'spoke.escrow.foreign.notOursRefuses',
  'spoke.escrow.foreign.refusesUnknown',
  'spoke.escrow.ownShares',
  'spoke.escrow.reservations',
  'spoke.escrow.reservedReleased',
  'spoke.escrow.reservedWillRelease',
  'spoke.escrow.summary',
  'spoke.escrow.surplus',
  'spoke.foreignShareTokens.classCeiling',
  'spoke.foreignShareTokens.crossCheck',
  'spoke.foreignShareTokens.escrowAdmitted',
  'spoke.foreignShareTokens.escrowNotAdmitted',
  'spoke.foreignShareTokens.indexerDisagrees',
  'spoke.foreignShareTokens.membershipLapsed',
  'spoke.foreignShareTokens.noIndexerEntry',
  'spoke.foreignShareTokens.outsideProbe',
  'spoke.foreignShareTokens.probeEdge',
  'spoke.foreignShareTokens.probeSource',
  'spoke.foreignShareTokens.summary',
  'spoke.holderMemberships.holdsWithoutMembership',
  'spoke.holderMemberships.hookUnreadable',
  'spoke.holderMemberships.member',
  'spoke.holderMemberships.summary',
  'spoke.hookManagers.grant',
  'spoke.hookManagers.noHooks',
  'spoke.hookManagers.notEnumerated',
  'spoke.hookManagers.summary',
  'spoke.hookManagers.sweepGap',
  'spoke.hooks.alreadyV33',
  'spoke.hooks.kindChanges',
  'spoke.hooks.mapSource',
  'spoke.hooks.mapped',
  'spoke.hooks.mappedSameKind',
  'spoke.hooks.missingFromMap',
  'spoke.hooks.noHook',
  'spoke.hooks.notOurs',
  'spoke.hooks.targetsUnread',
  'spoke.managers.balanceSheet',
  'spoke.managers.balanceSheetGap',
  'spoke.managers.gatewayGap',
  'spoke.managers.gatewaySweep',
  'spoke.managers.gatewaySweepEmpty',
  'spoke.managers.liveGatewayManager',
  'spoke.managers.summary',
  'spoke.pointer.arm',
  'spoke.pointer.frozen',
  'spoke.pointer.notArm',
  'spoke.pointer.vaultless',
  'spoke.ramps.assetNotRegistered',
  'spoke.ramps.assetOnSpoke',
  'spoke.ramps.assetOnSpokeAndHub',
  'spoke.ramps.assetRegisteredLater',
  'spoke.ramps.assetUnknownToHub',
  'spoke.ramps.classMissing',
  'spoke.ramps.config',
  'spoke.ramps.configGap',
  'spoke.ramps.instanceMismatch',
  'spoke.ramps.noConfig',
  'spoke.ramps.noV33Stack',
  'spoke.ramps.notBound',
  'spoke.ramps.notGranted',
  'spoke.ramps.notRelayer',
  'spoke.ramps.preview',
  'spoke.ramps.replayed',
  'spoke.ramps.summary',
  'spoke.ramps.twoForOneClass',
  'spoke.report.stopped',
  'spoke.syncReserves.maxReserve',
  'spoke.syncReserves.summary',
  'spoke.valuations.answers',
  'spoke.valuations.noCode',
  'spoke.valuations.notCarried',
  'spoke.valuations.stackValuation',
  'spoke.valuations.wrongShape',
  'spoke.vaults.alreadyConfigured',
  'spoke.vaults.notWarded',
  'spoke.vaults.setGap',
  'spoke.vaults.summary',
  'spoke.vaults.unknownToRegistry',
  'spoke.vaults.vault',
  'spoke.vaults.wardSummary',
] as const

export type PreCheckCode = (typeof PRECHECK_CODES)[number]

export type PreCheckRefs = { vault?: HexString; investor?: HexString; field?: string; address?: HexString }

export type PreCheckRow = {
  code: PreCheckCode
  severity: PreCheckSeverity
  /** The step whose signature the row concerns, `drain` for what settles between the freeze and the offboard. */
  step: PreCheckStep
  centrifugeId: CentrifugeId
  section: string
  source: PreCheckSource
  subject: string
  message: string
  amount?: PreCheckAmount
  /** The row describes the migration's own footprint or an accepted residue: known, nothing to do. */
  knownSettled: boolean
  /** A STOP, or one of the two WARN rows the App holds the step on (AS38, AS43). */
  blocking: boolean
  refs?: PreCheckRefs
}

export type PreCheckChain = { centrifugeId: CentrifugeId; block: bigint; roles: ('hub' | 'spoke')[] }

type ClaimableState = {
  vault: MigrationLiveVault
  investor: HexString
  maxMint: bigint
  maxWithdraw: bigint
  claimableMint: bigint
  claimableWithdraw: bigint
  pendingDepositRequest: bigint
  pendingRedeemRequest: bigint
  claimableCancelDepositRequest: bigint
  claimableCancelRedeemRequest: bigint
}

/**
 * One investor's unclaimed position on a vault of the spoke's v3.2 ARM. `amount` is raw: share units for a deposit,
 * asset units for a redeem. `refusedByHook` is set when the share token's hook refuses the claim, so the investor
 * cannot take it until the manager resolves it.
 */
export type MigrationClaimable = {
  investor: HexString
  vault: HexString
  shareClassId: ShareClassId
  assetId: AssetId
  kind: 'deposit' | 'redeem'
  amount: bigint
  refusedByHook: boolean
}

/** The unclaimed positions on one spoke, with `gaps` naming where the investor set may be short. */
export type MigrationClaimables = { centrifugeId: CentrifugeId; items: MigrationClaimable[]; gaps: string[] }

export type PreCheckNote = {
  code: PreCheckCode
  section: string
  centrifugeId: CentrifugeId
  text: string
  refs?: PreCheckRefs
}

export type PreCheckReport = {
  poolId: PoolId
  migration: HexString | null
  hubPhase: number | null
  spokePhases: Record<number, number>
  operator: HexString | null
  armedSpokes: CentrifugeId[]
  chains: PreCheckChain[]
  rows: PreCheckRow[]
  blockingRows: PreCheckRow[]
  notes: PreCheckNote[]
  counts: Record<PreCheckSeverity, number>
}

export function migratedPreCheckReport(
  poolId: PoolId,
  row: PoolMigrationRow | null,
  facade: HexString | null
): PreCheckReport {
  const hubPhase = row ? hubPhaseOfRow(row.hubPhase) : null
  const spokePhases: Record<number, number> = {}
  for (const spoke of row?.spokes ?? [])
    spokePhases[Number(spoke.centrifugeId)] = SPOKE_PHASE[spokePhaseOfRow(spoke.phase)]
  const text = !row
    ? 'the pool is on v3.3 and the indexer holds no migration row for it: created on v3.3, or the row is not projected yet; nothing to check'
    : hubPhase === 'activated'
      ? `the pool is on v3.3 and its migration is activated (started ${new Date(row.startedAt).toISOString()}, operator ${row.operator}): nothing left to check`
      : `the pool reads v3.3 while its migration row reads ${hubPhase}: the indexer has not caught up on the row; nothing to check until it does`
  return {
    poolId,
    migration: facade,
    hubPhase: hubPhase ? HUB_PHASE[hubPhase] : null,
    spokePhases,
    operator: row?.operator ?? null,
    armedSpokes: (row?.spokes ?? [])
      .filter((spoke) => spokePhaseOfRow(spoke.phase) !== 'none')
      .map((spoke) => Number(spoke.centrifugeId) as CentrifugeId),
    chains: [],
    rows: [],
    blockingRows: [],
    notes: [{ code: 'migration.onV33', section: 'migration', centrifugeId: poolId.centrifugeId, text }],
    counts: { stop: 0, warn: 0, gap: 0, info: 0 },
  }
}

export type PreCheckV32 = V32Refs & {
  hub: HexString | null
  /** FreezeOnly, FullRestrictions, FreelyTransferable, RedemptionRestrictions, each null where the chain records none. */
  hooks: (HexString | null)[]
  identityValuation: HexString | null
  oracleValuation: HexString | null
  accountingToken: HexString | null
}

export type PreCheckV33 = {
  hubRegistry: HexString | null
  spokeRegistry: HexString | null
  accountingToken: HexString | null
  onOffRampFactory: HexString | null
  multiAdapter: HexString | null
  layerZeroAdapter: HexString | null
  chainlinkAdapter: HexString | null
  hooks: (HexString | null)[]
}

/** One chain's reads: its reader at one block, the inputs derivation on it, and the stacks it records. */
export type PreCheckSite = {
  centrifugeId: CentrifugeId
  reader: MigrationInputsReader
  inputs: MigrationInputsDerivation
  v32: PreCheckV32
  /** `null` when the chain records no v3.3 stack. */
  v33: PreCheckV33 | null
  /** The deployed migration facade, `null` on a chain that carries none yet. */
  migration: { address: HexString; abi: Abi } | null
}

export type PreCheckMessage = {
  hash: HexString
  messageType: string
  status: string
  fromCentrifugeId: CentrifugeId
  toCentrifugeId: CentrifugeId
  /** The pool the indexer files it under; `SetPoolAdapters` routes as pool 0 and is filed under none. */
  poolId: bigint | null
  rawData: HexString | null
}

export type PreCheckInvestorKey = { scId: ShareClassId; assetId: AssetId; investor: HexString }

export type PreCheckCandidates = {
  /** The spokes the pool is live on, from the one set the plan walks (`pool.migrationSpokeCandidates()`). */
  spokes(): Promise<CentrifugeId[]>
  /** The chains that set could not be read on, and the hub record when it failed, with why. */
  unreadableSpokes(): Promise<UnreadableSpoke[]>
  /** Every pool manager row of the pool, hub admins included, with the chain each is filed under. */
  managers(): Promise<{ address: HexString; centrifugeId: CentrifugeId }[]>
  /** One spoke's candidate lists, plus the class each indexed ramp instance is filed under. */
  spoke(
    centrifugeId: CentrifugeId,
    scIds: readonly ShareClassId[]
  ): Promise<MigrationSpokeCandidates & { rampClasses: { instance: HexString; scId: ShareClassId }[] }>
  /** The hub's (class, asset, investor) order candidates and the sources that could not be read to the end. */
  hubInvestors(scIds: readonly ShareClassId[]): Promise<{ keys: PreCheckInvestorKey[]; gaps: string[] }>
  /** One spoke's investor candidates: members, holders and order rows. */
  spokeInvestors(
    centrifugeId: CentrifugeId,
    scIds: readonly ShareClassId[]
  ): Promise<{ byClass: { scId: ShareClassId; investors: HexString[] }[]; gaps: string[] }>
  /** Every inner message not executed: the pool's, and every `SetPoolAdapters` fleet-wide (filed under no pool). */
  messages(): Promise<{
    pool: PreCheckMessage[]
    setPoolAdapters: PreCheckMessage[]
    gaps: string[]
    executedOnLane(cid: CentrifugeId): number
  }>
  /** The indexer's whitelist entry of `account` on `token`'s class on one chain, null when it has none. */
  membership(
    token: { poolId: PoolId; scId: ShareClassId },
    centrifugeId: CentrifugeId,
    account: HexString
  ): Promise<{ validUntil: bigint; isFrozen: boolean } | null>
}

export type PreCheckOptions = {
  /** The pool probe window of the foreign share-token sections; the reference's 16 x 128 x 64 by default. */
  poolProbe?: { cidMax?: number; counterMax?: number; classMax?: number }
  /** First block of the v3.2 Gateway `UpdateManager` sweep; omitted, gateway managers rest on the indexer candidates. */
  gatewayLogsFromBlock?: bigint
  /** Whether `activate` installs the bridge circuit breaker (the plan's `bridgeCircuitBreaker`). */
  bridgeCircuitBreaker?: boolean
}

export const PRECHECK_ABI = parseAbi([
  'function checkERC20Transfer(address from, address to, uint256 value, (bytes16 from, bytes16 to) hookData) view returns (bool)',
  'function hook() view returns (address)',
  'function hookDataOf(address user) view returns (bytes16)',
  'function poolEscrow() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address who) view returns (uint256)',
  'function balanceOf(address who, uint256 tokenId) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function hub() view returns (address)',
  'function wards(address who) view returns (uint256)',
  'function pricePoolPerShare(uint64 poolId, bytes16 scId) view returns (uint256)',
  'function valuation(uint64 poolId, bytes16 scId) view returns (address)',
  'function requestManager(uint64 poolId) view returns (address)',
  'function isPoolActive(uint64 poolId) view returns (bool)',
  'function shareToken(uint64 poolId, bytes16 scId) view returns (address)',
  'function shareTokenDetails(address token) view returns (uint64 poolId, bytes16 scId)',
  'function idToAsset(uint128 assetId) view returns (address asset, uint256 tokenId)',
  'function assetToId(address asset, uint256 tokenId) view returns (uint128)',
  'function markersPricePoolPerAsset(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint64 computedAt, uint64 maxAge, uint64 validUntil)',
  'function pricePoolPerAsset(uint64 poolId, bytes16 scId, uint128 assetId, bool checkValidity) view returns (uint128)',
  'function isLinked(address vault) view returns (bool)',
  'function exists(uint64 poolId) view returns (bool)',
  'function manager(uint64 poolId, address who) view returns (bool)',
  'function currency(uint64 poolId) view returns (uint128)',
  'function isRegistered(uint128 assetId) view returns (bool)',
  'function shareClassCount(uint64 poolId) view returns (uint32)',
  'function pendingDeposit(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint128)',
  'function pendingRedeem(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint128)',
  'function epochId(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint32 deposit, uint32 issue, uint32 redeem, uint32 revoke)',
  'function depositRequest(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) view returns (uint128 pending, uint32 lastUpdate)',
  'function redeemRequest(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) view returns (uint128 pending, uint32 lastUpdate)',
  'function queuedDepositRequest(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) view returns (bool isCancelling, uint128 amount)',
  'function queuedRedeemRequest(uint64 poolId, bytes16 scId, uint128 assetId, bytes32 investor) view returns (bool isCancelling, uint128 amount)',
  'function maxDepositClaims(uint64 poolId, bytes16 scId, bytes32 investor, uint128 assetId) view returns (uint32)',
  'function maxRedeemClaims(uint64 poolId, bytes16 scId, bytes32 investor, uint128 assetId) view returns (uint32)',
  'function holding(uint64 poolId, bytes16 scId, uint128 assetId) view returns (uint128 assetAmount, uint128 assetAmountValue, address valuation, bool isLiability)',
  'function holding(bytes16 scId, address asset, uint256 tokenId) view returns (uint128 total, uint128 reserved)',
  'function escrow(uint64 poolId) view returns (address)',
  'function investments(address vault, address investor) view returns (uint128 maxMint, uint128 maxWithdraw, uint128 depositPrice, uint128 redeemPrice, uint128 pendingDepositRequest, uint128 pendingRedeemRequest, uint128 claimableCancelDepositRequest, uint128 claimableCancelRedeemRequest, uint128 pendingCancelDepositRequest, uint128 pendingCancelRedeemRequest)',
  'function maxMint(address vault, address investor) view returns (uint256)',
  'function maxWithdraw(address vault, address investor) view returns (uint256)',
  'function activeSessionId(uint16 centrifugeId, uint64 poolId) view returns (uint16)',
  'function quorum(uint16 centrifugeId, uint64 poolId) view returns (uint8)',
  'function adapters(uint16 centrifugeId, uint64 poolId, uint16 session, uint256 index) view returns (address)',
  'function estimate(uint16 centrifugeId, bytes payload, uint256 gasLimit) view returns (uint256)',
  'function toTokenId(uint64 poolId, address asset, bool liability) view returns (uint256)',
  'function previewManager(uint64 poolId, bytes16 scId) view returns (address)',
  'function vaultDetails(address vault) view returns (uint128 assetId, address asset, uint256 tokenId, bool isLinked)',
  'event UpdateManager(uint64 indexed poolId, address indexed who, bool canManage)',
  'event Rely(address indexed user)',
  'error ShareTokenDoesNotExist()',
])

const HUB_ASSET_DECIMALS_ABI = parseAbi(['function decimals(uint128 assetId) view returns (uint8)'])
const HUB_POOL_DECIMALS_ABI = parseAbi(['function decimals(uint64 poolId) view returns (uint8)'])
const ERC6909_DECIMALS_ABI = parseAbi(['function decimals(uint256 tokenId) view returns (uint8)'])

/** `ITransferHook.ESCROW_HOOK_ID`: the redeem sentinel a hook probe transfers toward. */
export const ESCROW_HOOK_ID = '0x000000000000000000000000000000000001CF60' as HexString
/** A destination no restriction set has ever named, standing in for the undeployed v3.3 escrow at rotation time. */
export const UNKNOWN_TARGET = '0x9dd37e7ca9ee01ed8b3af7d2a0d1b4aa7a6df18a' as HexString
export const POOL_COUNTER_MAX = 128

const HOOK_KIND_NAMES = ['FreezeOnly', 'FullRestrictions', 'FreelyTransferable', 'RedemptionRestrictions'] as const
const HUB_PHASE_HUB_ONBOARDED = 2
const SPOKE_PHASE_FROZEN = 2
const SPOKE_PHASE_OFFBOARDED = 3
const SPOKE_PHASE_ONBOARDED = 4
const LANE_LAYER_ZERO = 1
const LANE_CHAINLINK = 2
const LANE_OTHER = 4
const CARRIED_BY_VAULT = 1
const CARRIED_BY_PRICE = 2
const CARRIED_BY_ROTATION = 4
const PROBE_FROM = '0x1111111111111111111111111111111111111111' as HexString
const PROBE_TO = '0x2222222222222222222222222222222222222222' as HexString
const LIVE_GATEWAY_MANAGER =
  'a live v3.2 Gateway manager can lift the M2b outgoing block; AS26 expected none fleet-wide. The offboard removes the role and does not carry it to v3.3: the pool admins re-grant it after activation if they want it'
const PRICE_KINDS = ['NotifyPricePoolPerShare', 'NotifyPricePoolPerAsset']

/** The parked v3.2 share transfers the migration ignores (AS39), by pool, lane and hash; read 2026-10-22. */
export const AS39_PARKED_TRANSFERS: readonly { poolId: bigint; from: number; to: number; hash: HexString }[] = [
  {
    poolId: 281474976710662n,
    from: 1,
    to: 4,
    hash: '0x9823a1900cbe0f27856f90eb5e4d3d791e77fbb61c59ef717bd5d855e360f3b8',
  },
  {
    poolId: 281474976710659n,
    from: 1,
    to: 2,
    hash: '0xcd549e451f831bf69779c5c8a6cf83e0d07a3592e1d5e9c7acd099dfa8ab0ee0',
  },
  {
    poolId: 281474976710663n,
    from: 1,
    to: 5,
    hash: '0x12eb61cc4cd49c454d5537f190b030ffc526c54a998d3b21432f1c6a846be279',
  },
  {
    poolId: 281474976710659n,
    from: 2,
    to: 1,
    hash: '0x7ee257ebe1d7238fa124739ffa52d3849d8ef4048258c455197f6d3cc14aa0ef',
  },
  {
    poolId: 281474976710659n,
    from: 2,
    to: 1,
    hash: '0x341a6ac7de95346d65c4b6c39119315c7d53947e842446105ef9af0c14bacc3f',
  },
  {
    poolId: 281474976710659n,
    from: 2,
    to: 1,
    hash: '0x4a9aa75a027a8d52e2a4daf4c74db949f576378578e69c56d3846d6a6438ec3a',
  },
  {
    poolId: 281474976710659n,
    from: 2,
    to: 1,
    hash: '0xb5d07da19f5ce21a890d57081591ef248049dc322da128c0fa4d97198cd61e7a',
  },
]

// ---------------------------------------------------------------------------------------------------
// Orders: `MigrationOrders.verdicts`
// ---------------------------------------------------------------------------------------------------

export type SettleWindow = 'open' | 'closed' | 'unseen'
export type EpochPointers = { deposit: number; issue: number; redeem: number; revoke: number }
export type OrderVerdict = { code: PreCheckCode; blocking: boolean; row: string; consequence: string }

/** @internal */
export function orderDeadline(spokeCid: CentrifugeId): string {
  return `before the first relayOffboard toward centrifugeId ${spokeCid}; from then settlement toward it is blocked (app-gate §5.6)`
}

/** @internal */
export function settleRemedy(window: SettleWindow, helper: string): string {
  if (window === 'open') return `; ${helper}(..), hub manager`
  if (window === 'closed') {
    return "; already past for this chain's spoke, whose offboard has started: a settlement now cannot be claimed (VaultNotLinked)"
  }
  return `; ${helper}(..), hub manager, only while no relayOffboard toward it has been sent: the hub cannot read that spoke's phase, so the App gates on StepRelayed`
}

function desync(
  codes: { blocking: PreCheckCode; carried: PreCheckCode },
  pair: string,
  approved: number,
  settled: number,
  spokeCid: CentrifugeId,
  pastOffboard: boolean,
  remedy: string,
  v33Call: string
): OrderVerdict {
  const row = `epochId ${pair} = ${approved}/${settled}`
  if (pastOffboard) {
    return {
      code: codes.carried,
      blocking: false,
      row,
      consequence: `carried to v3.3 (spoke centrifugeId ${spokeCid} is past its offboard): one zero-amount ${v33Call} per desynced epoch after activate, v3.3 hub manager`,
    }
  }
  return {
    code: codes.blocking,
    blocking: true,
    row,
    consequence: `EpochsNotSynced at relayOffboard toward centrifugeId ${spokeCid}: ${remedy}`,
  }
}

/**
 * What the v3.3 offboard makes of one (class, asset) pair's open orders and epoch parity, as
 * `MigrationOrders.verdicts` decides it: epoch rows first, then the open orders.
 * @internal
 */
export function orderVerdicts(
  pendingDeposit: bigint,
  pendingRedeem: bigint,
  epochs: EpochPointers,
  spokeCid: CentrifugeId,
  pastOffboard: boolean,
  window: SettleWindow
): OrderVerdict[] {
  const out: OrderVerdict[] = []
  if (epochs.deposit !== epochs.issue) {
    out.push(
      desync(
        { blocking: 'hub.orders.depositNotIssued', carried: 'hub.orders.depositEpochsCarried' },
        'deposit/issue',
        epochs.deposit,
        epochs.issue,
        spokeCid,
        pastOffboard,
        'approved deposits not issued; the manager issues on v3.2 first, issueOutstanding(..), hub manager',
        'issueShares'
      )
    )
  }
  if (epochs.redeem !== epochs.revoke) {
    out.push(
      desync(
        { blocking: 'hub.orders.redeemNotRevoked', carried: 'hub.orders.redeemEpochsCarried' },
        'redeem/revoke',
        epochs.redeem,
        epochs.revoke,
        spokeCid,
        pastOffboard,
        'approved redeems not revoked; the manager revokes on v3.2 first, revokeOutstanding(..), hub manager',
        'revokeShares'
      )
    )
  }
  if (pendingDeposit !== 0n) {
    out.push({
      code: 'hub.orders.pendingDeposit',
      blocking: false,
      row: `pendingDeposit = ${pendingDeposit}`,
      consequence: `open deposit order: its assets ride into the v3.3 escrow as unledgered surplus a manager can later note as pool assets, and the investor loses the order unless it is settled ${orderDeadline(spokeCid)}${settleRemedy(window, 'settleDeposit')}`,
    })
  }
  if (pendingRedeem !== 0n) {
    out.push({
      code: 'hub.orders.pendingRedeem',
      blocking: false,
      row: `pendingRedeem = ${pendingRedeem}`,
      consequence: `open redeem order: the shares stay in the retired v3.2 escrow and the investor is left with neither shares nor assets, which the pool's manager moves with Spoke.transferSharesFrom or root with recoverTokens, unless it is settled ${orderDeadline(spokeCid)}${settleRemedy(window, 'settleRedeem')}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------
// Hook classification: `HookClassifier`
// ---------------------------------------------------------------------------------------------------

function hexBytes(code: HexString): Uint8Array {
  const clean = code.slice(2)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function addressSite(code: Uint8Array, i: number): number | null {
  const lowest = i >= 19 ? i - 19 : 0
  for (let start = i; start >= lowest; start--) {
    if (start < 13 || start + 20 > code.length || code[start - 13] !== 0x7f) continue
    let padded = true
    for (let j = start - 12; j < start; j++) {
      if (code[j] !== 0) {
        padded = false
        break
      }
    }
    if (padded) return start
  }
  return null
}

/**
 * Whether `code` is `bookCode` with one immutable address swapped: every difference sits in the address bytes
 * of a PUSH32 both codes share, and every such site holds the same address.
 * @internal
 */
export function differsOnlyInAddresses(code: HexString, bookCode: HexString): boolean {
  const a = hexBytes(code)
  const b = hexBytes(bookCode)
  if (a.length !== b.length) return false
  let value: string | null = null
  let i = 0
  while (i < a.length) {
    if (a[i] === b[i]) {
      i++
      continue
    }
    const start = addressSite(b, i)
    if (start === null) return false
    const site = Array.from(a.slice(start, start + 20))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    if (value !== null && site !== value) return false
    value = site
    i = start + 20
  }
  return true
}

// ---------------------------------------------------------------------------------------------------
// The pre-check
// ---------------------------------------------------------------------------------------------------

type LaneSide = {
  network: CentrifugeId
  known: boolean
  installed: boolean
  set: HexString[]
  kinds: number
  members: string
}
type HubSpokeCandidate = {
  centrifugeId: CentrifugeId
  source: string
  readable: boolean
  active: boolean
  unread: string
}
type ForeignToken = { token: HexString; pool: PoolId; scId: ShareClassId }

/** Reads every report of one run shares, so reports running side by side read each value once. */
type SharedReads = {
  seen: Set<string>
  spokeCids: Promise<CentrifugeId[]> | null
  hubCurrency: Promise<{ id: bigint | null; unread: string }> | null
  v33HooksOf: Map<CentrifugeId, Promise<HexString[]>>
  classCount: Promise<number> | null
  messages: ReturnType<PreCheckCandidates['messages']> | null
}

/** The pool a v3.2 share token belongs to, or `null` for an asset the Spoke does not know as a share token. */
const shareTokenOwner = (result: Result): PoolId | null =>
  result.status === 'success' ? new PoolId(BigInt((result.result as readonly [bigint, HexString])[0])) : null

/** `null` when the asset does not answer `decimals()`: a size is then not shown rather than shown 10^12 off. */
const decimalsOf = (result: Result): number | null =>
  result.status === 'success' ? Number(result.result as number | bigint) : null

const roundCount = (result: Result): bigint =>
  result.status === 'success' ? BigInt(result.result as number | bigint) : 0n

const HUB_ORDER_CODES = {
  'depositRequest.pending': 'hub.investorOrders.depositPending',
  'redeemRequest.pending': 'hub.investorOrders.redeemPending',
  'queuedDeposit.amount': 'hub.investorOrders.queuedDeposit',
  'queuedRedeem.amount': 'hub.investorOrders.queuedRedeem',
  maxDepositClaims: 'hub.investorOrders.unclaimedDepositRounds',
  maxRedeemClaims: 'hub.investorOrders.unclaimedRedeemRounds',
} as const satisfies Record<string, PreCheckCode>

const CLAIMABLE_CODES = {
  maxMint: 'spoke.claimables.maxMint',
  maxWithdraw: 'spoke.claimables.maxWithdraw',
  pendingDepositRequest: 'spoke.claimables.pendingDeposit',
  pendingRedeemRequest: 'spoke.claimables.pendingRedeem',
  claimableCancelDepositRequest: 'spoke.claimables.cancelledDeposit',
  claimableCancelRedeemRequest: 'spoke.claimables.cancelledRedeem',
} as const satisfies Record<string, PreCheckCode>

const cidList = (cids: readonly CentrifugeId[]) => cids.join(', ')
const same = (a: HexString, b: HexString) => isAddressEqual(a, b)
const bytes32ToAddress = (value: HexString): HexString => `0x${value.slice(2, 42)}` as HexString

/**
 * The off-chain half of the v3.3 migration's validation, as `PreCheck.s.sol` reports it: everything the
 * contract no longer refuses is named per row with its value, before the operator signs the step it concerns.
 * Read-only. The hub report runs on the pool's hub site, the spoke report on every site the v3.2 Spoke knows
 * the pool on, the pool-global gateway checks once. Enumerate from the indexer, decide on chain: every
 * candidate row is re-read against the v3.2 contract before it is reported.
 * @internal
 */
export class MigrationPreCheck {
  readonly rows: PreCheckRow[] = []
  readonly notes: PreCheckNote[] = []
  #shared: SharedReads = {
    seen: new Set<string>(),
    spokeCids: null,
    hubCurrency: null,
    v33HooksOf: new Map(),
    classCount: null,
    messages: null,
  }

  constructor(
    readonly poolId: PoolId,
    readonly sites: ReadonlyMap<CentrifugeId, PreCheckSite>,
    readonly candidates: PreCheckCandidates,
    readonly options: PreCheckOptions = {},
    /** Opens a chain only the v3.2 hub record names, so its activity is read rather than assumed. */
    readonly openSite?: (centrifugeId: CentrifugeId) => Promise<PreCheckSite>
  ) {}

  /** A report of the same run with its own rows and notes, so reports can run side by side and keep their order. */
  #fork(): MigrationPreCheck {
    const fork = new MigrationPreCheck(this.poolId, this.sites, this.candidates, this.options, this.openSite)
    fork.#shared = this.#shared
    return fork
  }

  get hub(): PreCheckSite | null {
    return this.sites.get(this.poolId.centrifugeId) ?? null
  }

  // Rows

  private row(
    code: PreCheckCode,
    severity: PreCheckSeverity,
    section: string,
    step: PreCheckStep,
    centrifugeId: CentrifugeId,
    source: PreCheckSource,
    subject: string,
    message: string,
    extra: { amount?: PreCheckAmount; knownSettled?: boolean; blocking?: boolean; refs?: PreCheckRefs } = {}
  ) {
    this.rows.push({
      code,
      severity,
      step,
      centrifugeId,
      section,
      source,
      subject,
      message,
      ...(extra.amount ? { amount: extra.amount } : {}),
      knownSettled: extra.knownSettled ?? false,
      blocking: extra.blocking ?? severity === 'stop',
      ...(extra.refs ? { refs: extra.refs } : {}),
    })
  }

  /** A spoke read that throws stops that spoke's report, not the whole pre-check: the arm holds on it. */
  private spokeReportStopped(centrifugeId: CentrifugeId, error: unknown) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    this.row(
      'spoke.report.stopped',
      'stop',
      'spoke.report',
      'arm',
      centrifugeId,
      'chain',
      `spoke cid ${centrifugeId}`,
      `the spoke report stopped at a read that failed (${reason}); the rest of this chain is not judged, so run the pre-check again once it reads`
    )
  }

  private note(code: PreCheckCode, section: string, centrifugeId: CentrifugeId, text: string, refs?: PreCheckRefs) {
    this.notes.push({ code, section, centrifugeId, text, ...(refs ? { refs } : {}) })
  }

  private once(key: string): boolean {
    if (this.#shared.seen.has(key)) return false
    this.#shared.seen.add(key)
    return true
  }

  // Reads

  private async read(site: PreCheckSite, calls: readonly Call[]): Promise<Result[]> {
    return site.reader.read(calls)
  }

  private call(address: HexString, functionName: string, args: readonly unknown[] = [], abi: Abi = PRECHECK_ABI): Call {
    return { address, abi, functionName, args }
  }

  private async tokenDecimals(site: PreCheckSite, tokens: readonly HexString[]): Promise<Map<string, number | null>> {
    const distinct = [...new Set(tokens.map((token) => token.toLowerCase() as HexString))]
    const results = await this.read(
      site,
      distinct.map((token) => this.call(token, 'decimals'))
    )
    return new Map(distinct.map((token, i) => [token, decimalsOf(results[i]!)]))
  }

  private async hubDecimals(
    hub: PreCheckSite,
    assetIds: readonly AssetId[]
  ): Promise<{ asset: (assetId: AssetId) => number | null; shares: number | null }> {
    const registry = hub.v32.hubRegistry
    if (!registry) return { asset: () => null, shares: null }
    const distinct = [...new Set(assetIds.map((assetId) => assetId.raw))]
    const results = await this.read(hub, [
      this.call(registry, 'decimals', [this.poolId.raw], HUB_POOL_DECIMALS_ABI),
      ...distinct.map((raw) => this.call(registry, 'decimals', [raw], HUB_ASSET_DECIMALS_ABI)),
    ])
    const byAsset = new Map(distinct.map((raw, i) => [raw, decimalsOf(results[i + 1]!)]))
    return { asset: (assetId) => byAsset.get(assetId.raw) ?? null, shares: decimalsOf(results[0]!) }
  }

  private async one<T>(
    site: PreCheckSite,
    address: HexString,
    functionName: string,
    args: readonly unknown[],
    what: string
  ): Promise<T> {
    const [result] = await this.read(site, [this.call(address, functionName, args)])
    return answered<T>(result!, what)
  }

  private async tryOne<T>(
    site: PreCheckSite,
    address: HexString,
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T | null> {
    const [result] = await this.read(site, [this.call(address, functionName, args)])
    return result!.status === 'success' ? (result!.result as T) : null
  }

  private async facade<T>(site: PreCheckSite, functionName: string, args: readonly unknown[]): Promise<T | null> {
    if (!site.migration) return null
    const [result] = await this.read(site, [
      { address: site.migration.address, abi: site.migration.abi, functionName, args },
    ])
    return answered<T>(result!, `migration facade ${functionName}`)
  }

  private async hubPhase(site: PreCheckSite): Promise<number | null> {
    const phase = await this.facade<number | bigint>(site, 'hubPhase', [this.poolId.raw])
    return phase === null ? null : Number(phase)
  }

  private async spokePhase(site: PreCheckSite, poolId: PoolId = this.poolId): Promise<number | null> {
    const phase = await this.facade<number | bigint>(site, 'spokePhase', [poolId.raw])
    return phase === null ? null : Number(phase)
  }

  private async hubOnboarded(site: PreCheckSite): Promise<boolean> {
    const phase = await this.hubPhase(site)
    return phase !== null && phase >= HUB_PHASE_HUB_ONBOARDED
  }

  private async localPastOffboard(site: PreCheckSite): Promise<boolean> {
    const phase = await this.spokePhase(site)
    return phase !== null && phase >= SPOKE_PHASE_OFFBOARDED
  }

  private async localSettleWindow(site: PreCheckSite): Promise<SettleWindow> {
    if (!site.migration) return 'open'
    const [phase, unlinked, rotated, removed] = await Promise.all([
      this.spokePhase(site),
      this.facade<bigint | number>(site, 'unlinkedVaults', [this.poolId.raw]),
      this.facade<bigint | number>(site, 'rotatedAssets', [this.poolId.raw]),
      this.facade<bigint | number>(site, 'removedManagers', [this.poolId.raw]),
    ])
    const started =
      (phase ?? 0) > SPOKE_PHASE_FROZEN ||
      Number(unlinked ?? 0) !== 0 ||
      Number(rotated ?? 0) !== 0 ||
      Number(removed ?? 0) !== 0
    return started ? 'closed' : 'open'
  }

  private async hookMapped(site: PreCheckSite, hook: HexString): Promise<boolean> {
    if (site.migration) {
      const target = await this.facade<HexString>(site, 'hookMap', [hook])
      return target !== null && !same(target, zeroAddress)
    }
    return site.v32.hooks.some((book) => book !== null && same(book, hook))
  }

  private async mappedTarget(site: PreCheckSite, hook: HexString): Promise<HexString | null> {
    const target = await this.facade<HexString>(site, 'hookMap', [hook])
    return target === null || same(target, zeroAddress) ? null : target
  }

  private v33Hooks(site: PreCheckSite): Promise<HexString[]> {
    const cached = this.#shared.v33HooksOf.get(site.centrifugeId)
    if (cached) return cached
    const hooks = this.readV33Hooks(site)
    this.#shared.v33HooksOf.set(site.centrifugeId, hooks)
    return hooks
  }

  private async readV33Hooks(site: PreCheckSite): Promise<HexString[]> {
    const hooks: HexString[] = []
    for (let k = 0; k < 4; k++) {
      const configured = site.v33?.hooks[k] ?? null
      if (configured && !same(configured, zeroAddress)) hooks.push(configured)
      const book = site.v32.hooks[k] ?? null
      if (book && site.migration) {
        const mapped = await this.mappedTarget(site, book)
        if (mapped) hooks.push(mapped)
      }
    }
    return hooks
  }

  private async isV33Hook(site: PreCheckSite, hook: HexString): Promise<boolean> {
    if (same(hook, zeroAddress)) return false
    return includes(await this.v33Hooks(site), hook)
  }

  private async ourHookKind(site: PreCheckSite, hook: HexString): Promise<{ ours: boolean; kind: number }> {
    const code = (await site.reader.code?.(hook)) ?? null
    if (!code || code === '0x') return { ours: false, kind: 0 }
    for (let k = 0; k < 4; k++) {
      const book = site.v32.hooks[k]
      if (!book) continue
      if (same(book, hook)) return { ours: true, kind: k }
      const bookCode = (await site.reader.code?.(book)) ?? null
      if (bookCode && bookCode !== '0x' && differsOnlyInAddresses(code, bookCode)) return { ours: true, kind: k }
    }
    return { ours: false, kind: 0 }
  }

  private async hookAllows(site: PreCheckSite, hook: HexString, from: HexString, to: HexString): Promise<boolean> {
    const [result] = await this.read(site, [
      this.call(hook, 'checkERC20Transfer', [
        from,
        to,
        0n,
        { from: '0x00000000000000000000000000000000', to: '0x00000000000000000000000000000000' },
      ]),
    ])
    return result!.status === 'success' && result!.result === true
  }

  /** Three `checkERC20Transfer` probes from a non-member: plain transfer, to the redeem sentinel, to zero. */
  private async hookKind(site: PreCheckSite, hook: HexString): Promise<string> {
    const [plain, redeem, burn] = await Promise.all([
      this.hookAllows(site, hook, PROBE_FROM, PROBE_TO),
      this.hookAllows(site, hook, PROBE_FROM, ESCROW_HOOK_ID),
      this.hookAllows(site, hook, PROBE_FROM, zeroAddress),
    ])
    if (!plain && !redeem && burn) return 'FullRestrictions'
    if (plain && redeem && burn) return 'FreezeOnly'
    if (plain && !redeem && !burn) return 'FreelyTransferable'
    if (plain && !redeem && burn) return 'RedemptionRestrictions'
    return `UNKNOWN(${plain ? 'T' : 'F'}${redeem ? 'T' : 'F'}${burn ? 'T' : 'F'})`
  }

  private messages() {
    return (this.#shared.messages ??= this.candidates.messages())
  }

  private spokeCids(): Promise<CentrifugeId[]> {
    return (this.#shared.spokeCids ??= this.candidates.spokes())
  }

  private classCount(hub: PreCheckSite): Promise<number> {
    return (this.#shared.classCount ??= hub.inputs.hubShareClassCount(this.poolId))
  }

  // Run

  async run(): Promise<PreCheckReport> {
    const hub = this.hub
    const spokeSites = [...this.sites.values()]
    const spokeRoles = new Map<CentrifugeId, boolean>(
      await Promise.all(
        spokeSites.map(
          async (site) =>
            [
              site.centrifugeId,
              await this.one<boolean>(
                site,
                site.v32.spoke,
                'isPoolActive',
                [this.poolId.raw],
                'v3.2 Spoke.isPoolActive'
              ),
            ] as const
        )
      )
    )
    const lanes = hub
      ? (await this.spokeCids()).filter((cid) => cid !== this.poolId.centrifugeId)
      : spokeSites.filter((site) => spokeRoles.get(site.centrifugeId)).map((site) => site.centrifugeId)

    const reports: ((report: MigrationPreCheck) => Promise<void>)[] = [
      (report) => report.gatewayQuiet(lanes),
      (report) => report.hubToSpokeExecuted(lanes),
      ...(hub ? [(report: MigrationPreCheck) => report.hubReport(hub)] : []),
      ...spokeSites
        .filter((site) => spokeRoles.get(site.centrifugeId))
        .map((site) => async (report: MigrationPreCheck) => {
          try {
            await report.spokeReport(site)
          } catch (error) {
            report.spokeReportStopped(site.centrifugeId, error)
          }
        }),
    ]
    const forks = reports.map(() => this.#fork())
    await Promise.all(reports.map((report, i) => report(forks[i]!)))
    for (const fork of forks) {
      this.rows.push(...fork.rows)
      this.notes.push(...fork.notes)
    }

    const migration = hub?.migration?.address ?? spokeSites.find((site) => site.migration)?.migration?.address ?? null
    const [phases, hubPhase, operator, armedSpokes] = await Promise.all([
      Promise.all(spokeSites.map((site) => this.spokePhase(site))),
      hub ? this.hubPhase(hub) : null,
      hub ? this.facade<HexString>(hub, 'operator', [this.poolId.raw]) : null,
      hub ? this.facade<readonly number[]>(hub, 'armedSpokes', [this.poolId.raw]) : null,
    ])
    const spokePhases: Record<number, number> = {}
    spokeSites.forEach((site, i) => {
      const phase = phases[i]
      if (phase !== null && phase !== undefined) spokePhases[site.centrifugeId] = phase
    })
    const counts: Record<PreCheckSeverity, number> = { stop: 0, warn: 0, gap: 0, info: 0 }
    for (const row of this.rows) counts[row.severity]++
    return {
      poolId: this.poolId,
      migration,
      hubPhase,
      spokePhases,
      operator,
      armedSpokes: (armedSpokes ?? []).map((cid) => cid as CentrifugeId),
      chains: spokeSites.map((site) => ({
        centrifugeId: site.centrifugeId,
        block: site.reader.block,
        roles: [
          ...(site.centrifugeId === this.poolId.centrifugeId ? (['hub'] as const) : []),
          ...(spokeRoles.get(site.centrifugeId) ? (['spoke'] as const) : []),
        ],
      })),
      rows: this.rows,
      blockingRows: this.rows.filter((row) => row.blocking),
      notes: this.notes,
      counts,
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Gateway quiet (pool-global, indexer)
  // ---------------------------------------------------------------------------------------------------

  private isAs39Parked(message: PreCheckMessage): boolean {
    return AS39_PARKED_TRANSFERS.some(
      (parked) =>
        parked.poolId === this.poolId.raw &&
        parked.from === message.fromCentrifugeId &&
        parked.to === message.toCentrifugeId &&
        (parked.hash.toLowerCase() === message.hash.toLowerCase() ||
          getMessageId(parked.from, parked.to, parked.hash).toLowerCase() === message.hash.toLowerCase())
    )
  }

  private messageRow(message: PreCheckMessage): string {
    return `${message.messageType} ${message.fromCentrifugeId}->${message.toCentrifugeId} ${message.status} ${message.hash}`
  }

  private async gatewayQuiet(lanes: readonly CentrifugeId[]) {
    const section = 'gateway.quiet'
    const hubCid = this.poolId.centrifugeId
    const { pool, setPoolAdapters, gaps } = await this.messages()
    for (const gap of gaps)
      this.row('gateway.quiet.candidatesGap', 'gap', section, 'offboard', hubCid, 'idx', 'cross-chain messages', gap)
    let deferred = 0
    let prices = 0
    for (const message of pool) {
      if (PRICE_KINDS.includes(message.messageType)) {
        prices++
        continue
      }
      if (message.fromCentrifugeId === hubCid && lanes.includes(message.toCentrifugeId)) {
        deferred++
        continue
      }
      if (this.isAs39Parked(message)) {
        this.row(
          'gateway.quiet.parkedTransferIgnored',
          'info',
          section,
          'offboard',
          message.toCentrifugeId,
          'idx',
          this.messageRow(message),
          'known, ignored (AS39): a parked v3.2 share transfer the migration leaves behind',
          { knownSettled: true }
        )
        continue
      }
      this.row(
        'gateway.quiet.messageInFlight',
        'warn',
        section,
        'offboard',
        message.toCentrifugeId,
        'idx',
        this.messageRow(message),
        'must clear (retry or repay) before the offboard: an in-flight message lands on a re-pointed pool'
      )
    }
    if (deferred !== 0)
      this.note(
        'gateway.quiet.deferredToSpokes',
        section,
        hubCid,
        `${deferred} hub->spoke messages left to the per-spoke obligation-6 section`
      )
    if (prices !== 0) {
      this.row(
        'gateway.quiet.stuckPriceNotifies',
        'info',
        section,
        'offboard',
        hubCid,
        'idx',
        `${prices} stuck price notifies`,
        'superseded price notifies: permanent v3.2 residue, safe to leave (v3.3 clears them)',
        { knownSettled: true }
      )
    }
    let hits = 0
    for (const message of setPoolAdapters) {
      const raw = message.rawData
      if (!raw || raw.length < 2 + 9 * 2) continue
      const embedded = BigInt(`0x${raw.slice(4, 20)}`)
      if (embedded !== this.poolId.raw) continue
      hits++
      this.row(
        'gateway.quiet.stuckSetPoolAdapters',
        'warn',
        section,
        'offboard',
        message.toCentrifugeId,
        'idx',
        `SetPoolAdapters ${message.fromCentrifugeId}->${message.toCentrifugeId} ${message.status}`,
        'the most dangerous straggler: a stuck adapter-set change for this pool'
      )
    }
    this.note(
      'gateway.quiet.summary',
      section,
      hubCid,
      `${pool.length} non-executed messages for the pool, ${hits} stuck SetPoolAdapters (${setPoolAdapters.length} fleet-wide) decoded`
    )
    this.row(
      'gateway.quiet.underpaidNotQueried',
      'gap',
      section,
      'offboard',
      hubCid,
      'idx',
      'crosschainPayloads',
      'underpaid batches not queried: no per-pool key on that entity'
    )
  }

  private async hubToSpokeExecuted(lanes: readonly CentrifugeId[]) {
    const section = 'gateway.hubToSpoke'
    const hubCid = this.poolId.centrifugeId
    if (lanes.length === 0) {
      this.note(
        'gateway.hubToSpoke.sameChainSpoke',
        section,
        hubCid,
        "no remote spoke: a same-chain spoke's callbacks are synchronous"
      )
      return
    }
    const { pool, executedOnLane } = await this.messages()
    for (const cid of lanes) {
      const onLane = pool.filter((message) => message.fromCentrifugeId === hubCid && message.toCentrifugeId === cid)
      let open = 0
      let prices = 0
      for (const message of onLane) {
        if (PRICE_KINDS.includes(message.messageType)) {
          prices++
          continue
        }
        if (this.isAs39Parked(message)) {
          this.row(
            'gateway.hubToSpoke.parkedTransferIgnored',
            'info',
            section,
            'offboard',
            cid,
            'idx',
            this.messageRow(message),
            'known, ignored (AS39): a parked v3.2 share transfer the migration leaves behind',
            { knownSettled: true }
          )
          continue
        }
        open++
        this.row(
          'gateway.hubToSpoke.notExecuted',
          'warn',
          section,
          'offboard',
          cid,
          'idx',
          this.messageRow(message),
          'not executed on the spoke: retry it (permissionless) before the first relayOffboard toward it. A settlement callback that lands after UnlinkVaults credits an unlinked vault: both claims revert (VaultNotLinked) and the next rotation releases the reserved payout to the pool'
        )
      }
      const executed = executedOnLane(cid)
      this.note(
        'gateway.hubToSpoke.summary',
        section,
        cid,
        `${open} hub->spoke messages not executed, ${prices} superseded price notifies not listed (no settlement in them), ${executed} executed`
      )
      if (executed === 0) {
        this.row(
          'gateway.hubToSpoke.noExecutedOnLane',
          'gap',
          section,
          'offboard',
          cid,
          'idx',
          `lane ${hubCid}->${cid}`,
          'the indexer answers no executed hub->spoke message on this lane, so its zero open count is not a measurement'
        )
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Hub report
  // ---------------------------------------------------------------------------------------------------

  private async hubReport(hub: PreCheckSite) {
    const hubCid = hub.centrifugeId
    const exists = await this.one<boolean>(
      hub,
      hub.v32.hubRegistry,
      'exists',
      [this.poolId.raw],
      'v3.2 HubRegistry.exists'
    )
    if (!exists) {
      this.row(
        'hub.identity.unknownToRegistry',
        'stop',
        'hub.identity',
        'arm',
        hubCid,
        'chain',
        `pool ${this.poolId.toString()}`,
        'homed here but unknown to the v3.2 hub registry'
      )
      return
    }
    const count = await this.classCount(hub)
    const currency = await this.one<bigint>(
      hub,
      hub.v32.hubRegistry,
      'currency',
      [this.poolId.raw],
      'v3.2 HubRegistry.currency'
    )
    this.#shared.hubCurrency = Promise.resolve({ id: BigInt(currency), unread: '' })
    this.note(
      'hub.identity.summary',
      'hub.identity',
      hubCid,
      `currency ${currency}${BigInt(currency) === 840n ? ' (USD)' : ''} | ${count} share classes`
    )

    const { spokes, record } = await this.hubSpokes(hub)
    await this.hubArmingRecord(hub, spokes)
    await this.hubSpokeless(hub, spokes, record)
    await this.hubReservation(hub)
    await this.hubLanes(hub, spokes)
    this.hubBreaker(hub)

    const managers = await this.candidates.managers()
    const hubCandidates = unique(managers.filter((row) => row.centrifugeId === hubCid).map((row) => row.address))
    const inventory = await hub.inputs.hubInventory(this.poolId, hubCandidates, [], count)
    await this.hubAdmins(hub, inventory.v32Admins, hubCandidates.length)
    this.note(
      'hub.assets.summary',
      'hub.assets',
      hubCid,
      `${inventory.registeredAssetIds.length} asset ids registered on this hub (probe window cid 1..${HUB_ASSET_CID_MAX} x counter 1..${HUB_ASSET_COUNTER_MAX}); ${inventory.orderedAssetIds.length} of them carry v3.2 BRM order state`
    )

    await this.hubOrders(hub, count, inventory.registeredAssetIds)
    await this.hubInvestorOrders(hub, inventory.scIds)
    await this.hubLiabilities(hub, count, inventory.registeredAssetIds.length, inventory.holdings)
  }

  private async siteOf(cid: CentrifugeId): Promise<{ site: PreCheckSite } | { reason: string }> {
    const site = this.sites.get(cid)
    if (site) return { site }
    if (!this.openSite) return { reason: 'its chain is outside this run' }
    try {
      return { site: await this.openSite(cid) }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private async hubSpokes(hub: PreCheckSite): Promise<{ spokes: HubSpokeCandidate[]; record: CentrifugeId[] }> {
    const section = 'hub.spokes'
    const listed = await this.spokeCids()
    const record = await hub.inputs.hubSpokeRecord(this.poolId)
    this.note(
      'hub.spokes.sources',
      section,
      hub.centrifugeId,
      `spokes per indexer: ${listed.length} [${cidList(listed)}]; per the v3.2 hub record (hubRequestManager toward cid 1..${MAX_V32_CENTRIFUGE_ID}): ${record.length} [${cidList(record)}]`
    )
    const union = uniqueCids([...listed, ...record])
    const spokes: HubSpokeCandidate[] = []
    for (const cid of union) {
      const source =
        listed.includes(cid) && record.includes(cid)
          ? 'indexer and hub record'
          : listed.includes(cid)
            ? 'indexer'
            : 'hub record'
      const opened = await this.siteOf(cid)
      if ('reason' in opened) {
        spokes.push({ centrifugeId: cid, source, readable: false, active: false, unread: opened.reason })
        this.note(
          'hub.spokes.notRead',
          section,
          cid,
          `spoke cid ${cid} (named by ${source}): not read (${opened.reason})`
        )
        continue
      }
      const { site } = opened
      const [result] = await this.read(site, [this.call(site.v32.spoke, 'isPoolActive', [this.poolId.raw])])
      if (result!.status !== 'success') {
        spokes.push({
          centrifugeId: cid,
          source,
          readable: true,
          active: false,
          unread: 'v3.2 Spoke.isPoolActive did not answer',
        })
        continue
      }
      const active = result!.result === true
      spokes.push({ centrifugeId: cid, source, readable: true, active, unread: '' })
      if (!active) {
        this.row(
          'hub.spokes.inactive',
          'info',
          section,
          'arm',
          cid,
          'idxchain',
          `spoke cid ${cid} (named by ${source})`,
          this.inactiveSpokeNote(cid),
          { knownSettled: true }
        )
      }
    }
    for (const unreadable of await this.candidates.unreadableSpokes()) {
      const cid = unreadable.centrifugeId ?? hub.centrifugeId
      this.row(
        'hub.spokes.unreadable',
        'stop',
        section,
        'arm',
        cid,
        unreadable.centrifugeId === null ? 'record' : 'chain',
        unreadable.centrifugeId === null ? 'spoke set' : `spoke cid ${cid}`,
        `${unreadable.reason}: a spoke that cannot be read can neither be armed nor left out of the hub onboard; the plan holds the arm and stops onboardHub until it reads`
      )
    }
    this.row(
      'hub.spokes.setGap',
      'gap',
      section,
      'arm',
      hub.centrifugeId,
      'idxchain',
      'spoke set',
      "the chain directory united with the v3.2 hub's hubRequestManager record, each confirmed on its chain; a spoke neither names is invisible here (the hub cannot list a pool's spokes)"
    )
    return { spokes, record }
  }

  private inactiveSpokeNote(cid: CentrifugeId): string {
    if (cid === this.poolId.centrifugeId) {
      return 'pool not active on its v3.2 Spoke: not a spoke to arm (relayArm refuses SpokeNotActiveOnV32)'
    }
    return 'pool not active on its v3.2 Spoke: not a spoke to arm. relayArm still records it on the hub, which counts it armed from then on, and its Arm parks SpokeNotActiveOnV32 there'
  }

  /** With nothing armed, `onboardHub` takes the hub-only path, which refuses any cid the v3.2 hub still names a request manager toward. */
  private async hubSpokeless(hub: PreCheckSite, spokes: HubSpokeCandidate[], record: CentrifugeId[]) {
    if (record.length === 0 || (await this.hubOnboarded(hub))) return
    const armed = (await this.facade<readonly number[]>(hub, 'armedSpokes', [this.poolId.raw])) ?? []
    if (armed.length !== 0) return
    if (spokes.some((c) => c.active || !c.readable || c.unread !== '')) return
    const cid = record[0]!
    this.row(
      'hub.spokes.nothingToArm',
      'stop',
      'hub.spokes',
      'onboardHub',
      hub.centrifugeId,
      'chain',
      `v3.2 hubRequestManager toward cid ${cid} with no spoke active to arm`,
      `onboardHub refuses while nothing is armed: NoArmedSpokes without the noV32Spokes attestation, SpokeNotArmed(${cid}) with it, the hub-only onboard requiring every v3.2 hubRequestManager unset (AS5). Clear it by making the pool active on cid ${cid}'s v3.2 Spoke while a v3.2 hub manager is left: land its v3.2 NotifyPool there (wait for it, retry it on that chain if it parked, or send notifyPool), then arm and migrate cid ${cid} as a spoke. Do not arm cid ${cid} as it is: AS5's finalize-only exit carries the pool past onboardHub, but no driver activates a pool whose armed spoke never reads Onboarded`
    )
  }

  /** Once the hub is Armed, every live candidate missing from the arming record is one the onboard and activation never reach (AS43). */
  private async hubArmingRecord(hub: PreCheckSite, spokes: HubSpokeCandidate[]) {
    const phase = await this.hubPhase(hub)
    if (phase === null || phase === 0) return
    const armed = ((await this.facade<readonly number[]>(hub, 'armedSpokes', [this.poolId.raw])) ?? []).map(Number)
    const action = phase === 1 ? '; relayArm it before onboardHub' : '; past the hub onboard it can no longer be armed'
    for (const c of spokes) {
      if (armed.includes(c.centrifugeId)) continue
      let status: string
      if (!c.readable) status = `cannot be checked, armed or planned (not read: ${c.unread})`
      else if (c.unread !== '') status = `activity unread (${c.unread})`
      else if (c.active) status = 'active on its v3.2 Spoke'
      else continue
      this.row(
        'hub.armingRecord.notArmed',
        'warn',
        'hub.armingRecord',
        'onboardHub',
        c.centrifugeId,
        'record',
        `spoke cid ${c.centrifugeId} (named by ${c.source}) ${status}, not in the arming record`,
        `${c.active ? 'its v3.2 pool is left live' : 'if its v3.2 pool is live, it is left live'} with no v3.2 hub manager after onboardHub, and after activate any pool admin can drive the migration contract there${action}`,
        { blocking: phase === 1 }
      )
    }
  }

  private async hubLanes(hub: PreCheckSite, spokes: HubSpokeCandidate[]) {
    for (const c of spokes) {
      if (c.centrifugeId === hub.centrifugeId) continue
      if (c.readable && c.unread === '' && !c.active) continue
      await this.lane(hub, c.centrifugeId, c.source)
    }
  }

  private async spokeLane(site: PreCheckSite) {
    const hubCid = this.poolId.centrifugeId
    if (hubCid === site.centrifugeId) return
    await this.lane(site, hubCid, "the pool's hub")
  }

  /** The pool lane rule: each half is read on the chain that holds it and the two are compared by kind. */
  private async lane(site: PreCheckSite, cid: CentrifugeId, source: string) {
    const section = 'lanes'
    const label = `lane ${site.centrifugeId} -> cid ${cid}`
    const peerSite = this.sites.get(cid)
    if (!peerSite) {
      this.row(
        'lanes.noClient',
        'warn',
        section,
        'lanes',
        site.centrifugeId,
        'chain',
        `${label} (named by ${source})`,
        'no client configured for this cid: neither half of the lane is readable, and no tooling can check, arm or plan a spoke there'
      )
      return
    }
    const here = await this.laneSide(site, cid)
    if (!here.known) {
      this.row(
        'lanes.noV33Stack',
        'gap',
        section,
        'lanes',
        site.centrifugeId,
        'chain',
        label,
        'this chain records no v3.3 stack, so neither half of the lane is readable'
      )
      return
    }
    this.note('lanes.side', section, site.centrifugeId, `${label}: ${this.laneSideText(here)}`)
    if (here.set.length === 0) {
      this.row(
        'lanes.noPoolAdapters',
        'stop',
        section,
        'lanes',
        site.centrifugeId,
        'chain',
        `${label} on ${site.centrifugeId}`,
        'NoPoolAdapters at installPoolAdapters: the global set keeps neither LayerZero nor a Chainlink quoting 7M'
      )
    }
    const peer = await this.laneSide(peerSite, site.centrifugeId)
    if (!peer.known) {
      this.row(
        'lanes.peerUnreadable',
        'gap',
        section,
        'lanes',
        cid,
        'chain',
        label,
        `the peer half is not readable (cid ${cid} records no v3.3 stack), so the halves are not compared`
      )
      return
    }
    this.note('lanes.peerSide', section, cid, `${label}: peer ${this.laneSideText(peer)}`)
    if (peer.set.length === 0) {
      this.row(
        'lanes.noPoolAdapters',
        'stop',
        section,
        'lanes',
        cid,
        'chain',
        `${label} on ${cid}`,
        'NoPoolAdapters at installPoolAdapters: the global set keeps neither LayerZero nor a Chainlink quoting 7M'
      )
    }
    if (here.set.length !== 0 && peer.set.length !== 0 && here.kinds !== peer.kinds) {
      this.row(
        'lanes.kindMismatch',
        'stop',
        section,
        'lanes',
        site.centrifugeId,
        'chain',
        label,
        "the two halves disagree by kind: a message one side sends cannot meet the other side's threshold"
      )
    }
    if (here.kinds === LANE_LAYER_ZERO || peer.kinds === LANE_LAYER_ZERO) {
      this.row(
        'lanes.layerZeroOnly',
        'warn',
        section,
        'lanes',
        site.centrifugeId,
        'chain',
        label,
        'the lane ends LayerZero-only: to be re-confirmed with the team at close-out'
      )
    }
  }

  private laneSideText(side: LaneSide): string {
    return `${side.installed ? 'installed [' : 'would install ['}${side.members}], threshold ${side.set.length}`
  }

  /** One half of a lane: the pool's installed set, else what `installPoolAdapters` would install from the global one. */
  private async laneSide(site: PreCheckSite, toCid: CentrifugeId): Promise<LaneSide> {
    const side: LaneSide = {
      network: site.centrifugeId,
      known: false,
      installed: false,
      set: [],
      kinds: 0,
      members: '',
    }
    const multiAdapter = site.v33?.multiAdapter ?? null
    if (!multiAdapter) return side
    side.known = true
    const layerZero = site.v33?.layerZeroAdapter ?? null
    const chainlink = site.v33?.chainlinkAdapter ?? null
    const lane = await laneAdapters(
      (calls) => this.read(site, calls),
      multiAdapter,
      this.poolId,
      toCid,
      layerZero,
      chainlink
    )
    side.installed = lane.installed
    side.set = lane.set
    side.members = side.set
      .map((adapter) => {
        const isLayerZero = layerZero !== null && same(adapter, layerZero)
        const isChainlink = chainlink !== null && same(adapter, chainlink)
        side.kinds |= isLayerZero ? LANE_LAYER_ZERO : isChainlink ? LANE_CHAINLINK : LANE_OTHER
        return `${isLayerZero ? 'layerZero' : isChainlink ? 'chainlink' : 'unpinned'} ${adapter}`
      })
      .join(', ')
    return side
  }

  /** Only before `initiateMigration`, which reads the reservation itself. */
  private async hubReservation(hub: PreCheckSite) {
    const section = 'hub.reservation'
    const registry = hub.v33?.hubRegistry ?? null
    if (!hub.migration || !registry) {
      this.row(
        'hub.reservation.unread',
        'info',
        section,
        'arm',
        hub.centrifugeId,
        'chain',
        'reservation unread',
        !hub.migration
          ? "no migration contract to look for among the pool's v3.3 hub managers"
          : "this chain's config records no v3.3 hubRegistry"
      )
      return
    }
    if ((await this.hubPhase(hub)) !== 0) {
      this.note(
        'hub.reservation.pastInitiate',
        section,
        hub.centrifugeId,
        'past initiateMigration, which read the reservation'
      )
      return
    }
    const [exists, manager] = await this.read(hub, [
      this.call(registry, 'exists', [this.poolId.raw]),
      this.call(registry, 'manager', [this.poolId.raw, hub.migration.address]),
    ])
    const onRegistry = answered<boolean>(exists!, 'v3.3 HubRegistry.exists')
    if (onRegistry && answered<boolean>(manager!, 'v3.3 HubRegistry.manager')) {
      this.note(
        'hub.reservation.reserved',
        section,
        hub.centrifugeId,
        `reserved on the v3.3 hub registry ${registry}, the migration contract its manager`
      )
      return
    }
    this.row(
      'hub.reservation.notReserved',
      'stop',
      section,
      'arm',
      hub.centrifugeId,
      'chain',
      `${onRegistry ? 'pool on the v3.3 hub registry ' : 'pool not on the v3.3 hub registry '}${registry}${onRegistry ? ' without the migration contract as manager' : ''}`,
      'initiateMigration refuses PoolNotReserved: the launch spell reserves only the pools it was cast with and is one-shot, so only another spell can reserve it'
    )
  }

  private hubBreaker(hub: PreCheckSite) {
    const breaker = this.options.bridgeCircuitBreaker ?? true
    this.row(
      'hub.breaker.circuitBreaker',
      'info',
      'hub.breaker',
      'activate',
      hub.centrifugeId,
      'attest',
      'bridge circuit breaker',
      breaker
        ? "activate installs the bridge circuit breaker as the pool's bridging hook"
        : 'activate does not install the bridge circuit breaker: the pool bridges as on v3.2',
      { knownSettled: true }
    )
  }

  private async hubAdmins(hub: PreCheckSite, v32Admins: HexString[], candidateCount: number) {
    const section = 'hub.admins'
    const hubCid = hub.centrifugeId
    for (const admin of v32Admins) this.note('hub.admins.admin', section, hubCid, `admin ${admin}`, { address: admin })
    const onboarded = await this.hubOnboarded(hub)
    if (v32Admins.length === 0) {
      if (onboarded) {
        this.row(
          'hub.admins.removedByOnboard',
          'info',
          section,
          'onboardHub',
          hubCid,
          'record',
          'hub admins',
          'removed by M8: the pool has onboarded, and `activate` replays this set less its stack-bound admins',
          { knownSettled: true }
        )
      } else {
        this.row(
          'hub.admins.noLiveManager',
          'stop',
          section,
          'arm',
          hubCid,
          'idxchain',
          'hub admins',
          'no live v3.2 hub manager among the candidates: nobody can call initiateMigration (NotV32HubManager)'
        )
      }
    }
    const carried =
      v32Admins.length === 0 && onboarded
        ? ((await this.facade<HexString[]>(hub, 'removedHubAdmins', [this.poolId.raw])) ?? [])
        : v32Admins
    const bound = await hub.inputs.hubStackBound(carried)
    const operator = (await this.facade<HexString>(hub, 'operator', [this.poolId.raw])) ?? zeroAddress
    for (const admin of bound) {
      if (same(admin, operator)) continue
      this.row(
        'hub.admins.leftOnV32',
        'info',
        section,
        'activate',
        hubCid,
        'chain',
        `admin ${admin}`,
        'left on v3.2 at activate (bound to the v3.2 HubRegistry), not granted on v3.3',
        { knownSettled: true, refs: { address: admin } }
      )
    }
    await this.hubIssuerAdmins(hub, carried, bound)
    await this.hubOperator(hub, v32Admins)
    this.row(
      'hub.admins.candidatesGap',
      'gap',
      section,
      'arm',
      hubCid,
      'idxchain',
      'hub admins',
      `${candidateCount} indexer poolManagers candidates re-read on-chain; completeness is not provable on-chain`
    )
  }

  /** An issuer's contract answers `hub()` with the v3.2 Hub as the stack's own do, but not `hubRegistry()`. */
  private async hubIssuerAdmins(hub: PreCheckSite, admins: readonly HexString[], bound: readonly HexString[]) {
    const contracts: HexString[] = []
    for (const who of admins) {
      if (includes(bound, who)) continue
      if (await hub.reader.hasCode(who, hub.reader.block)) contracts.push(who)
    }
    if (contracts.length === 0) return
    const results = await this.read(
      hub,
      contracts.map((who) => this.call(who, 'hub'))
    )
    contracts.forEach((who, i) => {
      const result = results[i]!
      if (result.status !== 'success' || !hub.v32.hub || !same(result.result as HexString, hub.v32.hub)) return
      this.row(
        'hub.admins.issuerContract',
        'info',
        'hub.admins',
        'activate',
        hub.centrifugeId,
        'chain',
        `admin ${who}`,
        'an issuer contract pointing at the v3.2 Hub: activate grants it on v3.3 while it still calls the v3.2 Hub, so whatever it automates stops until its issuer re-points or replaces it; the pool manager removes the grant with Hub.updateHubManager',
        { refs: { address: who } }
      )
    })
  }

  /** Only while Armed: the pinned operator must still be a live v3.2 hub manager for every step before `onboardHub`. */
  private async hubOperator(hub: PreCheckSite, admins: readonly HexString[]) {
    if ((await this.hubPhase(hub)) !== 1) return
    const operator = (await this.facade<HexString>(hub, 'operator', [this.poolId.raw])) ?? zeroAddress
    const subject = `operator ${operator}`
    const live = await this.one<boolean>(
      hub,
      hub.v32.hubRegistry,
      'manager',
      [this.poolId.raw, operator],
      'v3.2 HubRegistry.manager'
    )
    if (!live) {
      this.row(
        'hub.operator.notManager',
        'stop',
        'hub.operator',
        'arm',
        hub.centrifugeId,
        'chain',
        subject,
        "no longer a live v3.2 hub manager: relayArm, relayFreeze, relayOffboard and onboardHub refuse NotV32HubManager. Re-grant it on v3.2, or, while this chain's spoke is not yet Frozen, another live v3.2 hub manager re-pins the operator with initiateMigration"
      )
      return
    }
    if (includes(admins, operator)) {
      this.note(
        'hub.operator.liveManager',
        'hub.operator',
        hub.centrifugeId,
        `${subject}: a live v3.2 hub manager, in the set M8 removes`
      )
      return
    }
    this.row(
      'hub.operator.notInCandidates',
      'stop',
      'hub.operator',
      'onboardHub',
      hub.centrifugeId,
      'idxchain',
      subject,
      "a live v3.2 hub manager the indexer's poolManagers candidates do not name, so the derived v32Admins leave it out and onboardHub refuses AdminsMissingOperator"
    )
  }

  /** Aggregate open orders and epoch parity per (class, asset): three reads per pair, one batch. */
  private async hubOrders(hub: PreCheckSite, count: number, assetIds: readonly AssetId[]) {
    const section = 'hub.orders'
    const [localPastOffboard, localWindow] = await Promise.all([
      this.localPastOffboard(hub),
      this.localSettleWindow(hub),
    ])
    const scIds = hub.inputs.hubScIds(this.poolId, count)
    const calls: Call[] = []
    for (const scId of scIds) {
      for (const assetId of assetIds) {
        const args = [this.poolId.raw, scId.raw, assetId.raw]
        calls.push(
          this.call(hub.v32.batchRequestManager, 'pendingDeposit', args),
          this.call(hub.v32.batchRequestManager, 'pendingRedeem', args),
          this.call(hub.v32.batchRequestManager, 'epochId', args)
        )
      }
    }
    const results = await this.read(hub, calls)
    let open = 0
    let carried = 0
    scIds.forEach((scId, s) => {
      assetIds.forEach((assetId, a) => {
        const p = (s * assetIds.length + a) * 3
        const pendingDeposit = BigInt(answered<bigint>(results[p]!, 'v3.2 BRM.pendingDeposit'))
        const pendingRedeem = BigInt(answered<bigint>(results[p + 1]!, 'v3.2 BRM.pendingRedeem'))
        const [deposit, issue, redeem, revoke] = answered<readonly (number | bigint)[]>(
          results[p + 2]!,
          'v3.2 BRM.epochId'
        ).map(Number)
        const epochs: EpochPointers = { deposit: deposit!, issue: issue!, redeem: redeem!, revoke: revoke! }
        if (epochs.deposit || epochs.issue || epochs.redeem || epochs.revoke) carried++
        const local = assetId.centrifugeId === hub.centrifugeId
        const verdicts = orderVerdicts(
          pendingDeposit,
          pendingRedeem,
          epochs,
          assetId.centrifugeId,
          local && localPastOffboard,
          local ? localWindow : 'unseen'
        )
        const key = pairLabel(scId, assetId)
        for (const verdict of verdicts) {
          this.row(
            verdict.code,
            verdict.blocking ? 'stop' : 'warn',
            section,
            verdict.row.startsWith('epochId') ? 'offboard' : 'drain',
            assetId.centrifugeId,
            'chain',
            `${key} ${verdict.row}`,
            verdict.consequence
          )
        }
        open += (pendingDeposit !== 0n ? 1 : 0) + (pendingRedeem !== 0n ? 1 : 0)
      })
    })
    this.note(
      'hub.orders.summary',
      section,
      hub.centrifugeId,
      `${count * assetIds.length} (class, asset) pairs probed, ${open} with an open order; ${carried} hold a non-zero v3.2 epoch pointer, copied to the v3.3 BRM at onboardHub`
    )
  }

  /** Investor-keyed BRM residue: the indexer names the (class, asset, investor) triples, the v3.2 BRM answers each. */
  private async hubInvestorOrders(hub: PreCheckSite, scIds: readonly ShareClassId[]) {
    const section = 'hub.investorOrders'
    const { keys, gaps } = await this.candidates.hubInvestors(scIds)
    for (const gap of gaps)
      this.row(
        'hub.investorOrders.candidatesGap',
        'gap',
        section,
        'drain',
        hub.centrifugeId,
        'idx',
        'investor candidates',
        gap
      )
    const seen = new Set<string>()
    const distinct = keys.filter((key) => {
      const id = `${key.scId.raw}|${key.assetId.raw}|${key.investor.toLowerCase()}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    const calls: Call[] = []
    for (const key of distinct) {
      const investor = addressToBytes32(key.investor)
      const args = [this.poolId.raw, key.scId.raw, key.assetId.raw, investor]
      calls.push(
        this.call(hub.v32.batchRequestManager, 'depositRequest', args),
        this.call(hub.v32.batchRequestManager, 'redeemRequest', args),
        this.call(hub.v32.batchRequestManager, 'queuedDepositRequest', args),
        this.call(hub.v32.batchRequestManager, 'queuedRedeemRequest', args),
        this.call(hub.v32.batchRequestManager, 'maxDepositClaims', [
          this.poolId.raw,
          key.scId.raw,
          investor,
          key.assetId.raw,
        ]),
        this.call(hub.v32.batchRequestManager, 'maxRedeemClaims', [
          this.poolId.raw,
          key.scId.raw,
          investor,
          key.assetId.raw,
        ])
      )
    }
    const [results, decimals] = await Promise.all([
      this.read(hub, calls),
      this.hubDecimals(
        hub,
        distinct.map((key) => key.assetId)
      ),
    ])
    distinct.forEach((key, i) => {
      const p = i * 6
      const label = `${pairLabel(key.scId, key.assetId)} investor ${key.investor}`
      const deadline = orderDeadline(key.assetId.centrifugeId)
      const cid = key.assetId.centrifugeId
      const assetDecimals = decimals.asset(key.assetId)
      const warnNonZero = (
        field: keyof typeof HUB_ORDER_CODES,
        value: bigint,
        consequence: string,
        amountDecimals?: number | null
      ) => {
        if (value === 0n) return
        this.row(
          HUB_ORDER_CODES[field],
          'warn',
          section,
          'drain',
          cid,
          'idxchain',
          `${label} ${field} = ${value}`,
          consequence,
          amountDecimals === undefined ? {} : { amount: { raw: value, decimals: amountDecimals } }
        )
      }
      const [depositPending] = answered<readonly bigint[]>(results[p]!, 'v3.2 BRM.depositRequest')
      warnNonZero(
        'depositRequest.pending',
        BigInt(depositPending!),
        `investor deposit order still pending: lost to the investor, its assets unledgered surplus, unless settled ${deadline}`,
        assetDecimals
      )
      const [redeemPending] = answered<readonly bigint[]>(results[p + 1]!, 'v3.2 BRM.redeemRequest')
      warnNonZero(
        'redeemRequest.pending',
        BigInt(redeemPending!),
        `investor redeem order still pending: shares stay in the retired escrow unless settled ${deadline}`,
        decimals.shares
      )
      const [depositCancelling, depositQueued] = answered<readonly [boolean, bigint]>(
        results[p + 2]!,
        'v3.2 BRM.queuedDepositRequest'
      )
      warnNonZero(
        'queuedDeposit.amount',
        BigInt(depositQueued),
        `queued deposit enters an epoch only through a settlement, so it clears ${deadline}`,
        assetDecimals
      )
      if (depositCancelling)
        this.row(
          'hub.investorOrders.queuedDepositCancelling',
          'warn',
          section,
          'drain',
          cid,
          'idxchain',
          `${label} queuedDeposit.isCancelling`,
          `queued deposit cancellation executes only through a settlement, so it clears ${deadline}`
        )
      const [redeemCancelling, redeemQueued] = answered<readonly [boolean, bigint]>(
        results[p + 3]!,
        'v3.2 BRM.queuedRedeemRequest'
      )
      warnNonZero(
        'queuedRedeem.amount',
        BigInt(redeemQueued),
        `queued redeem enters an epoch only through a settlement, so it clears ${deadline}`,
        decimals.shares
      )
      if (redeemCancelling)
        this.row(
          'hub.investorOrders.queuedRedeemCancelling',
          'warn',
          section,
          'drain',
          cid,
          'idxchain',
          `${label} queuedRedeem.isCancelling`,
          `queued redeem cancellation executes only through a settlement, so it clears ${deadline}`
        )
      warnNonZero(
        'maxDepositClaims',
        roundCount(results[p + 4]!),
        `issued epochs the investor never claimed: the notify (permissionless) and the claim both land ${deadline}, or the allocation stays in v3.2 epoch state`
      )
      warnNonZero(
        'maxRedeemClaims',
        roundCount(results[p + 5]!),
        `revoked epochs the investor never claimed: the notify (permissionless) and the claim both land ${deadline}, or the payout stays in v3.2 epoch state`
      )
    })
    this.note(
      'hub.investorOrders.summary',
      section,
      hub.centrifugeId,
      `${distinct.length} distinct (class, asset, investor) keys re-read on the v3.2 BRM`
    )
    this.row(
      'hub.investorOrders.investorSetGap',
      'gap',
      section,
      'drain',
      hub.centrifugeId,
      'idx',
      'investor set',
      'indexer order rows (pending, open and closed orders, members, holders); an investor the indexer never saw is invisible here'
    )
  }

  /** A liability entry is skipped at the hub onboard, so it is named. */
  private async hubLiabilities(
    hub: PreCheckSite,
    count: number,
    registered: number,
    holdings: readonly { scId: string; assetId: string }[]
  ) {
    const section = 'hub.liabilities'
    const [results, decimals] = await Promise.all([
      this.read(
        hub,
        holdings.map((key) =>
          this.call(hub.v32.holdings, 'holding', [this.poolId.raw, key.scId as HexString, BigInt(key.assetId)])
        )
      ),
      this.hubDecimals(
        hub,
        holdings.map((key) => new AssetId(BigInt(key.assetId)))
      ),
    ])
    let nonZero = 0
    let liabilities = 0
    holdings.forEach((key, i) => {
      const [amount, , , isLiability] = answered<readonly [bigint, bigint, HexString, boolean]>(
        results[i]!,
        'v3.2 Holdings.holding'
      )
      if (BigInt(amount) !== 0n) nonZero++
      if (!isLiability) return
      liabilities++
      const assetId = new AssetId(BigInt(key.assetId))
      this.row(
        'hub.liabilities.liability',
        'warn',
        section,
        'onboardHub',
        hub.centrifugeId,
        'chain',
        `${pairLabel(new ShareClassId(key.scId as HexString), assetId)} liability amount = ${amount}`,
        "v3.2 liability holding: left unseeded on the v3.3 hub (no liability flag exists there); the pool's v3.3 NAV omits it",
        { amount: { raw: BigInt(amount), decimals: decimals.asset(assetId) } }
      )
    })
    this.note(
      'hub.liabilities.summary',
      section,
      hub.centrifugeId,
      `${holdings.length} of ${count * registered} probed (class, asset) pairs carry something: the OnboardHubInput.holdings seed; ${nonZero} of them a non-zero amount (positive control), ${liabilities} liabilities`
    )
  }

  // ---------------------------------------------------------------------------------------------------
  // Spoke report
  // ---------------------------------------------------------------------------------------------------

  private async spokeReport(site: PreCheckSite) {
    const cid = site.centrifugeId
    const section = 'spoke.pointer'
    const pointer = await this.one<HexString>(
      site,
      site.v32.spoke,
      'requestManager',
      [this.poolId.raw],
      'v3.2 Spoke.requestManager'
    )
    if (same(pointer, site.v32.asyncRequestManager)) {
      this.note('spoke.pointer.arm', section, cid, `pointer is the v3.2 ARM ${pointer}`)
    } else if (same(pointer, zeroAddress)) {
      this.row(
        'spoke.pointer.vaultless',
        'info',
        section,
        'freeze',
        cid,
        'chain',
        'pointer = 0',
        'vault-less pool (AS36): the freeze flips nothing and abort restores nothing',
        { knownSettled: true }
      )
    } else if (site.migration && same(pointer, site.migration.address)) {
      this.row(
        'spoke.pointer.frozen',
        'info',
        section,
        'freeze',
        cid,
        'chain',
        `pointer = ${pointer}`,
        'already frozen: the migration contract holds the pointer',
        { knownSettled: true }
      )
    } else {
      this.row(
        'spoke.pointer.notArm',
        'stop',
        section,
        'freeze',
        cid,
        'chain',
        `pointer = ${pointer}`,
        'PointerNotArm at freeze: the pointer is neither the v3.2 ARM nor zero'
      )
    }

    await this.spokeLane(site)
    const hubCount = this.hub ? await this.classCount(this.hub) : 0
    const { scIds, tokens } = await this.spokeClasses(site, hubCount)
    await this.spokeHooks(site, scIds, tokens)
    const candidates = await this.candidates.spoke(cid, scIds)
    const vaults = await this.spokeVaults(site, scIds, candidates)
    await this.spokeClaimables(site, scIds, vaults)
    const { assetIds, assets } = await this.spokeEscrow(site, scIds)
    await this.spokeForeignShareTokens(site, scIds, tokens, assets)
    await this.spokeValuations(site, scIds, vaults)
    const balanceSheetManagers = await this.spokeManagers(site, candidates)
    await this.spokeRamps(site, scIds, assets, assetIds, balanceSheetManagers, candidates)
    await this.spokeSyncReserves(site, scIds, assets)
    const priceIds = await this.spokeAssetPrices(site, scIds)
    await this.spokeAssetIds(site, scIds, vaults, priceIds, assets, assetIds, tokens)
    await this.spokeHookManagers(site, scIds, tokens)
  }

  private async spokeClasses(site: PreCheckSite, hubCount: number) {
    const section = 'spoke.classes'
    const { scIds, tokens } = await site.inputs.spokeClasses(this.poolId, hubCount)
    const supplies = await this.read(
      site,
      tokens.map((token) => this.call(token, 'totalSupply'))
    )
    scIds.forEach((scId, i) =>
      this.note(
        'spoke.classes.token',
        section,
        site.centrifugeId,
        `sc${scIndex(scId)} token ${tokens[i]} supply ${word(supplies[i]!)}`
      )
    )
    if (scIds.length === 0) {
      this.row(
        'spoke.classes.none',
        'info',
        section,
        'freeze',
        site.centrifugeId,
        'chain',
        'classes = 0',
        'zero-class pool on this spoke (AS36): every per-class list is empty',
        { knownSettled: true }
      )
    }
    return { scIds, tokens }
  }

  /** An unmapped hook stays on the token (`HookKept`), so it is a warning, never a stop. */
  private async spokeHooks(site: PreCheckSite, scIds: readonly ShareClassId[], tokens: readonly HexString[]) {
    const section = 'spoke.hooks'
    const cid = site.centrifugeId
    const hooks = await this.read(
      site,
      tokens.map((token) => ({ address: token, abi: LEGACY_ABI as Abi, functionName: 'hook' }))
    )
    let targetsUnread = 0
    for (let i = 0; i < scIds.length; i++) {
      const hook = answered<HexString>(hooks[i]!, 'v3.2 ShareToken.hook')
      const label = `sc${scIndex(scIds[i]!)} hook ${hook}`
      if (same(hook, zeroAddress)) {
        this.row('spoke.hooks.noHook', 'info', section, 'arm', cid, 'chain', label, 'no hook on the v3.2 token', {
          knownSettled: true,
        })
        continue
      }
      const kind = await this.hookKind(site, hook)
      if (await this.isV33Hook(site, hook)) {
        this.row(
          'spoke.hooks.alreadyV33',
          'info',
          section,
          'arm',
          cid,
          'chain',
          `${label} (${kind})`,
          "already a v3.3 hook: LinkTokens re-pointed the token at it, the migration's own footprint",
          { knownSettled: true }
        )
        continue
      }
      if (await this.hookMapped(site, hook)) {
        if (!site.migration) {
          targetsUnread++
          this.note('spoke.hooks.mapped', section, cid, `${label} (${kind}) mapped`)
          continue
        }
        const target = (await this.mappedTarget(site, hook))!
        const targetKind = (await site.reader.hasCode(target, site.reader.block))
          ? await this.hookKind(site, target)
          : 'NO CODE'
        const row = `${label} (${kind}) mapped to ${target} (${targetKind})`
        if (kind === targetKind) this.note('spoke.hooks.mappedSameKind', section, cid, row)
        else
          this.row(
            'spoke.hooks.kindChanges',
            'warn',
            section,
            'arm',
            cid,
            'chain',
            row,
            'LinkTokens re-points the token at a hook of another kind: its transfer rules change for every holder on v3.3'
          )
        continue
      }
      await this.keptHook(site, label, kind, hook)
    }
    this.note(
      'spoke.hooks.mapSource',
      section,
      cid,
      `map source: ${site.migration ? 'deployed V33Migration.hookMap' : "the chain's four v3.2 book hooks (no deployed map)"}`
    )
    if (targetsUnread !== 0) {
      this.row(
        'spoke.hooks.targetsUnread',
        'info',
        section,
        'arm',
        cid,
        'chain',
        `${targetsUnread} mapped hooks`,
        'target kind not compared: no deployed hook map to read the target from'
      )
    }
  }

  private async keptHook(site: PreCheckSite, label: string, kind: string, hook: HexString) {
    const costs =
      ' until the manager swaps it, v3.3 fails Spoke.revoke and outgoing bridging, async deposit fulfillment, hub UpdateRestriction and hub hook-manager grants; sync deposits to members, plain transfers, redeem requests and incoming bridging (if the hook admits the endorsed SpokeHandler) still work'
    const { ours, kind: k } = await this.ourHookKind(site, hook)
    if (!ours) {
      this.row(
        'spoke.hooks.notOurs',
        'warn',
        'spoke.hooks',
        'arm',
        site.centrifugeId,
        'chain',
        `${label} (${kind}) not ours`,
        `LinkTokens keeps it;${costs}`
      )
      return
    }
    const book = site.v32.hooks[k]!
    const target = (site.migration ? await this.mappedTarget(site, book) : null) ?? site.v33?.hooks[k] ?? null
    this.row(
      'spoke.hooks.missingFromMap',
      'warn',
      'spoke.hooks',
      'arm',
      site.centrifugeId,
      'chain',
      `${label} (${kind}) one of ours, missing from the deploy map`,
      `LinkTokens keeps it; the manager's swap target is the shared v3.3 ${HOOK_KIND_NAMES[k]} ${target ?? '(not recorded on this chain)'};${costs}`
    )
  }

  private async spokeVaults(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    candidates: MigrationSpokeCandidates
  ): Promise<MigrationLiveVault[]> {
    const section = 'spoke.vaults'
    const cid = site.centrifugeId
    const linked = await site.inputs.linkedVaultsOnChain(this.poolId, scIds)
    const { vaults, unknown } = await site.inputs.liveVaults(this.poolId, unique([...candidates.vaults, ...linked]))
    const registry = site.v33?.spokeRegistry ?? null
    const links = registry
      ? await this.read(
          site,
          vaults.map((vault) => this.call(registry, 'isLinked', [vault.vault]))
        )
      : []
    vaults.forEach((vault, i) => {
      let link: string
      if (vault.isLinked) link = 'linked: unlinked at M3, registered and linked at M14'
      else if (links[i]?.status === 'success' && links[i]!.result === true)
        link = 'linked on v3.3 (unlinked on v3.2 at M3, linked at M14)'
      else link = 'UNLINKED: registered at M14 without a link, re-pointed at M15; the manager re-links it on v3.3'
      this.note(
        'spoke.vaults.vault',
        section,
        cid,
        `vault ${vault.vault} sc${scIndex(vault.scId)} asset ${vault.asset} (${vault.assetId.raw}) ${vault.isSync ? 'sync' : 'async'} ${link}`
      )
    })
    await this.vaultWards(site, vaults)
    for (const vault of unknown) {
      this.row(
        'spoke.vaults.unknownToRegistry',
        'warn',
        section,
        'offboard',
        cid,
        'idxchain',
        `vault ${vault}`,
        'indexer candidate the v3.2 vault registry does not know (vaultDetails reverts): migrated by neither M3 nor M14. Deployed after this block or registered on a registry this stack does not read'
      )
    }
    this.note(
      'spoke.vaults.summary',
      section,
      cid,
      `${candidates.vaults.length} indexer candidates: ${vaults.length} of this pool on the v3.2 vault registry, ${unknown.length} unknown to it`
    )
    this.row(
      'spoke.vaults.setGap',
      'gap',
      section,
      'offboard',
      cid,
      'idxchain',
      'vault set',
      'indexer vaults candidates re-read on-chain; v3.2 keeps vaults in a mapping and cannot list them'
    )
    return vaults
  }

  /** v3.2 registers any contract a pool manager names; only a genuine v3.2 factory relies it on the managers. */
  private async vaultWards(site: PreCheckSite, vaults: readonly MigrationLiveVault[]) {
    const results = await this.read(site, [
      ...vaults.map((vault) => this.call(site.v32.asyncRequestManager, 'wards', [vault.vault])),
      ...vaults.filter((vault) => vault.isSync).map((vault) => this.call(site.v32.syncManager, 'wards', [vault.vault])),
    ])
    let s = vaults.length
    let syncCount = 0
    for (let i = 0; i < vaults.length; i++) {
      const vault = vaults[i]!
      const armWarded = word(results[i]!) === 1n
      let syncWarded = true
      if (vault.isSync) {
        syncCount++
        syncWarded = word(results[s++]!) === 1n
      }
      if (armWarded && syncWarded) continue
      const row = `vault ${vault.vault}${armWarded ? '' : ' v3.2 ARM ward 0'}${syncWarded ? '' : ' v3.2 SyncManager ward 0'}`
      if ((await this.facade<boolean>(site, 'vaultConfigured', [this.poolId.raw, vault.vault])) === true) {
        this.row(
          'spoke.vaults.alreadyConfigured',
          'info',
          'spoke.vaults',
          'onboardSpokes',
          site.centrifugeId,
          'record',
          row,
          'ConfigureVaults already moved it to the v3.3 managers',
          { knownSettled: true }
        )
        continue
      }
      this.row(
        'spoke.vaults.notWarded',
        'stop',
        'spoke.vaults',
        'arm',
        site.centrifugeId,
        'chain',
        row,
        'ConfigureVaults refuses it (VaultNotWardedOnV32: the vault was not deployed by a genuine v3.2 factory), and only after the offboard has landed, so the spoke stalls Offboarded; do not arm while the vault set carries it'
      )
    }
    this.note(
      'spoke.vaults.wardSummary',
      'spoke.vaults',
      site.centrifugeId,
      `${vaults.length} vaults checked for the v3.2 ARM ward, ${syncCount} of them sync and checked on the v3.2 SyncManager too`
    )
  }

  /** Claimables per (vault, investor): the investor set from the indexer, every figure from the v3.2 ARM. */
  private async spokeClaimables(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    vaults: readonly MigrationLiveVault[]
  ) {
    const section = 'spoke.claimables'
    const cid = site.centrifugeId
    const { states, gaps } = await this.claimableStates(site, scIds, vaults)
    for (const gap of gaps)
      this.row('spoke.claimables.candidatesGap', 'gap', section, 'drain', cid, 'idx', 'investor candidates', gap)
    const { decimalsOf: tokenDecimalsOf, shareTokenOf } = await this.claimableTokens(site, states)
    for (const state of states) {
      const label = `vault ${state.vault.vault} investor ${state.investor}`
      const asset = state.vault.asset
      const share = shareTokenOf(state.vault.scId)
      const inAsset = { decimals: tokenDecimalsOf(asset), asset }
      const inShares = share ? { decimals: tokenDecimalsOf(share), asset: share } : { decimals: null }
      const warnNonZero = (
        field: keyof typeof CLAIMABLE_CODES,
        value: bigint,
        consequence: string,
        unit: { decimals: number | null; asset?: HexString }
      ) => {
        if (value === 0n) return
        this.row(
          CLAIMABLE_CODES[field],
          'warn',
          section,
          'drain',
          cid,
          'idxchain',
          `${label} ${field} = ${value}`,
          consequence,
          {
            amount: { raw: value, ...unit },
            refs: { vault: state.vault.vault, investor: state.investor, field },
          }
        )
      }
      const warnClaim = (
        field: keyof typeof CLAIMABLE_CODES,
        raw: bigint,
        claimable: bigint,
        consequence: string,
        unit: { decimals: number | null; asset?: HexString }
      ) => {
        let why = consequence
        if (raw !== 0n && claimable === 0n) {
          why +=
            ". The share token's hook refuses this investor's claim, so the ARM's view reads 0 and the investor cannot claim it: the manager must unfreeze or re-whitelist the investor (or otherwise resolve it) before the first relayOffboard toward this spoke"
        }
        warnNonZero(field, raw, why, unit)
      }
      warnClaim(
        'maxMint',
        state.maxMint,
        state.claimableMint,
        "unclaimed deposit allocation: the shares stay minted in the retired v3.2 escrow and the vault is re-pointed at a v3.3 ARM with no record; the pool's manager moves them with Spoke.transferSharesFrom (AS9), or root with recoverTokens",
        inShares
      )
      warnClaim(
        'maxWithdraw',
        state.maxWithdraw,
        state.claimableWithdraw,
        "unclaimed redeem payout: the reserved assets rotate into v3.3 as free pool assets (ReservedResidueReleased) and the investor's claim path is denied",
        inAsset
      )
      warnNonZero(
        'pendingDepositRequest',
        state.pendingDepositRequest,
        "spoke-side deposit open: see the hub's open-order rows",
        inAsset
      )
      warnNonZero(
        'pendingRedeemRequest',
        state.pendingRedeemRequest,
        "spoke-side redeem open: see the hub's open-order rows",
        inShares
      )
      warnNonZero(
        'claimableCancelDepositRequest',
        state.claimableCancelDepositRequest,
        'unclaimed deposit cancellation: the refund sits in the retired escrow',
        inAsset
      )
      warnNonZero(
        'claimableCancelRedeemRequest',
        state.claimableCancelRedeemRequest,
        'unclaimed redeem cancellation: the shares sit in the retired escrow',
        inShares
      )
    }
    this.note(
      'spoke.claimables.summary',
      section,
      cid,
      `${states.length} (vault, investor) keys re-read on the v3.2 ARM, each investor paired with the vaults of its own class`
    )
    this.row(
      'spoke.claimables.investorSetGap',
      'gap',
      section,
      'drain',
      cid,
      'idx',
      'investor set',
      'indexer members, holders and order rows for this spoke; not enumerable on-chain'
    )
  }

  /** The v3.2 ARM's figures per (vault, investor), each investor paired with the vaults of its own class. */
  private async claimableTokens(site: PreCheckSite, states: readonly ClaimableState[]) {
    const scIds = [...new Map(states.map((state) => [state.vault.scId.raw.toLowerCase(), state.vault.scId])).values()]
    const shareReads = await this.read(
      site,
      scIds.map((scId) => this.call(site.v32.spoke, 'shareToken', [this.poolId.raw, scId.raw]))
    )
    const shareTokens = new Map(
      scIds.map((scId, i) => [
        scId.raw.toLowerCase(),
        shareReads[i]!.status === 'success' ? (shareReads[i]!.result as HexString) : null,
      ])
    )
    const tokens = [
      ...states.map((state) => state.vault.asset),
      ...[...shareTokens.values()].filter((token): token is HexString => token !== null),
    ]
    const decimals = await this.tokenDecimals(site, tokens)
    return {
      decimalsOf: (token: HexString) => decimals.get(token.toLowerCase()) ?? null,
      shareTokenOf: (scId: ShareClassId) => shareTokens.get(scId.raw.toLowerCase()) ?? null,
    }
  }

  private async claimableStates(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    vaults: readonly MigrationLiveVault[]
  ): Promise<{ states: ClaimableState[]; gaps: string[] }> {
    const { byClass, gaps } = await this.candidates.spokeInvestors(site.centrifugeId, scIds)
    const states: ClaimableState[] = []
    for (const vault of vaults) {
      const investors = byClass.find((c) => c.scId.raw.toLowerCase() === vault.scId.raw.toLowerCase())?.investors ?? []
      const calls: Call[] = []
      for (const who of investors) {
        calls.push(
          this.call(site.v32.asyncRequestManager, 'investments', [vault.vault, who]),
          this.call(site.v32.asyncRequestManager, 'maxMint', [vault.vault, who]),
          this.call(site.v32.asyncRequestManager, 'maxWithdraw', [vault.vault, who])
        )
      }
      const results = await this.read(site, calls)
      investors.forEach((investor, i) => {
        const p = i * 3
        const state = answered<readonly bigint[]>(results[p]!, 'v3.2 ARM.investments').map(BigInt)
        const [
          maxMint,
          maxWithdraw,
          ,
          ,
          pendingDepositRequest,
          pendingRedeemRequest,
          claimableCancelDepositRequest,
          claimableCancelRedeemRequest,
        ] = state
        states.push({
          vault,
          investor,
          maxMint: maxMint!,
          maxWithdraw: maxWithdraw!,
          claimableMint: word(results[p + 1]!),
          claimableWithdraw: word(results[p + 2]!),
          pendingDepositRequest: pendingDepositRequest!,
          pendingRedeemRequest: pendingRedeemRequest!,
          claimableCancelDepositRequest: claimableCancelDepositRequest!,
          claimableCancelRedeemRequest: claimableCancelRedeemRequest!,
        })
      })
    }
    return { states, gaps }
  }

  /**
   * What investors can still claim on one spoke's v3.2 ARM, read without the rest of the pre-check: an executed
   * deposit's shares (`maxMint`) and a redeem payout (`maxWithdraw`). Both are lost to the investor after the first
   * offboard toward the spoke.
   */
  async claimables(centrifugeId: CentrifugeId): Promise<MigrationClaimables> {
    const site = this.sites.get(centrifugeId)
    if (!site) throw new Error(`no pre-check site for cid ${centrifugeId}`)
    const hubCount = this.hub ? await this.classCount(this.hub) : 0
    const { scIds } = await site.inputs.spokeClasses(this.poolId, hubCount)
    const candidates = await this.candidates.spoke(centrifugeId, scIds)
    const linked = await site.inputs.linkedVaultsOnChain(this.poolId, scIds)
    const { vaults } = await site.inputs.liveVaults(this.poolId, unique([...candidates.vaults, ...linked]))
    const { states, gaps } = await this.claimableStates(site, scIds, vaults)
    const items = states.flatMap((state): MigrationClaimable[] => {
      const base = {
        investor: state.investor,
        vault: state.vault.vault,
        shareClassId: state.vault.scId,
        assetId: state.vault.assetId,
      }
      return [
        ...(state.maxMint === 0n
          ? []
          : [{ ...base, kind: 'deposit' as const, amount: state.maxMint, refusedByHook: state.claimableMint === 0n }]),
        ...(state.maxWithdraw === 0n
          ? []
          : [
              {
                ...base,
                kind: 'redeem' as const,
                amount: state.maxWithdraw,
                refusedByHook: state.claimableWithdraw === 0n,
              },
            ]),
      ]
    })
    return { centrifugeId, items, gaps }
  }

  /** Every non-zero `reserved` is released at rotation and sized in pool currency through the v3.2 spoke's price. */
  private async spokeEscrow(site: PreCheckSite, scIds: readonly ShareClassId[]) {
    const section = 'spoke.escrow'
    const cid = site.centrifugeId
    const { assetIds, assets } = await site.inputs.registeredAssets(true, false)
    const escrow = await this.one<HexString>(
      site,
      site.v32.poolEscrowFactory,
      'escrow',
      [this.poolId.raw],
      'v3.2 PoolEscrowFactory.escrow'
    )
    this.note(
      'spoke.escrow.summary',
      section,
      cid,
      `v3.2 pool escrow ${escrow} | ${assets.length} assets registered on this spoke`
    )
    const ledgerCalls: Call[] = []
    for (const asset of assets) {
      for (const scId of scIds) ledgerCalls.push(this.call(escrow, 'holding', [scId.raw, asset, 0n]))
    }
    const [ledger, balances] = await Promise.all([
      this.read(site, ledgerCalls),
      this.read(
        site,
        assets.map((asset) => this.call(asset, 'balanceOf', [escrow]))
      ),
    ])
    const ledgerRow = (a: number, s: number): [bigint, bigint] => {
      const [total, reserved] = answered<readonly [bigint, bigint]>(
        ledger[a * scIds.length + s]!,
        'v3.2 PoolEscrow.holding'
      )
      return [BigInt(total), BigInt(reserved)]
    }
    const pastOffboard = await this.localPastOffboard(site)
    const migration = site.migration
    const [details, decimalReads, rotatedReads] = await Promise.all([
      this.read(
        site,
        assets.map((asset) => this.call(site.v32.spoke, 'shareTokenDetails', [asset]))
      ),
      this.read(
        site,
        assets.map((asset) => this.call(asset, 'decimals'))
      ),
      migration
        ? this.read(
            site,
            assets.map((asset) => ({
              address: migration.address,
              abi: migration.abi,
              functionName: 'assetRotated',
              args: [this.poolId.raw, asset],
            }))
          )
        : null,
    ])
    let reservations = 0
    for (let a = 0; a < assets.length; a++) {
      const asset = assets[a]!
      const assetId = assetIds[a]!
      const balance = word(balances[a]!)
      const owner = shareTokenOwner(details[a]!)
      if (owner && owner.raw === this.poolId.raw) {
        let reserved = 0n
        for (let s = 0; s < scIds.length; s++) reserved += ledgerRow(a, s)[1]
        if (balance === 0n && reserved === 0n) continue
        this.row(
          'spoke.escrow.ownShares',
          'info',
          section,
          'offboard',
          cid,
          'chain',
          `share token ${asset} as asset ${assetId.raw} balance ${balance} reserved ${reserved}`,
          "the pool's own shares: excluded from rotation (AssetIsShareToken) and abandoned in the retired escrow (AS9); the pool's manager moves them with Spoke.transferSharesFrom, or root with recoverTokens",
          { knownSettled: true }
        )
        continue
      }
      if (owner && balance !== 0n) await this.foreignShareTokenGate(site, escrow, asset, owner)
      const decimals = decimalsOf(decimalReads[a]!)
      const rotated = rotatedReads
        ? (answered<boolean | null>(rotatedReads[a]!, 'migration facade assetRotated') ?? false)
        : false
      let totals = 0n
      for (let s = 0; s < scIds.length; s++) {
        const [total, reserved] = ledgerRow(a, s)
        totals += total
        if (reserved === 0n) continue
        reservations++
        const scId = scIds[s]!
        const size =
          decimals === null
            ? { label: 'decimals unread: size unknown' }
            : await this.poolSize(site, scId, assetId, reserved, decimals)
        const amount: PreCheckAmount = {
          raw: reserved,
          decimals,
          asset,
          ...(size.inPoolCurrency !== undefined ? { inPoolCurrency: size.inPoolCurrency } : {}),
        }
        const subject = `${pairLabel(scId, assetId)} reserved = ${reserved} (${decimals === null ? 'decimals unread' : `${units(reserved, decimals)} units`}, ${size.label})`
        if (rotated) {
          this.row(
            'spoke.escrow.reservedReleased',
            'info',
            section,
            'offboard',
            cid,
            'record',
            subject,
            'already released to the pool at rotation (ReservedResidueReleased)',
            { amount, knownSettled: true }
          )
          continue
        }
        this.row(
          'spoke.escrow.reservedWillRelease',
          'warn',
          section,
          'offboard',
          cid,
          'chain',
          subject,
          "released at rotation, the v3.3 ledger starting with nothing reserved: v3.2 reserves for a pending deposit and an unclaimed deposit cancellation as well as for an unclaimed redeem payout, and whichever this backs loses its claim path. The ARM claimable rows name the positions; a pending deposit's tokens also count in this asset's surplus",
          { amount }
        )
      }
      if (balance > totals) {
        this.row(
          'spoke.escrow.surplus',
          'warn',
          section,
          'offboard',
          cid,
          'chain',
          `asset ${asset} balance ${balance} > ledger totals ${totals} (surplus ${decimals === null ? 'decimals unread' : `${units(balance - totals, decimals)} units`})`,
          'rides into the v3.3 escrow as recordedSurplus, unledgered; a manager can later note it as pool assets. Open deposit orders sit here',
          { amount: { raw: balance - totals, decimals, asset } }
        )
      } else if (balance < totals) {
        const subject = `asset ${asset} balance ${balance} < ledger totals ${totals}`
        if (rotated)
          this.row(
            'spoke.escrow.alreadyRotated',
            'info',
            section,
            'offboard',
            cid,
            'record',
            subject,
            'already rotated: the balance is in the v3.3 escrow and the v3.2 ledger stands as it was',
            { knownSettled: true }
          )
        else
          this.row(
            'spoke.escrow.belowTotals',
            'stop',
            section,
            'offboard',
            cid,
            'chain',
            subject,
            'BalanceBelowRecordedTotals at RotateAssets: the escrow cannot back its own ledger'
          )
      } else if (balance !== 0n) {
        this.note('spoke.escrow.balanced', section, cid, `asset ${asset} balance ${balance} == ledger totals`)
      }
    }
    this.note(
      'spoke.escrow.reservations',
      section,
      cid,
      `${reservations} non-zero reservations across ${scIds.length * assets.length} (class, asset) pairs`
    )
    await this.escrowErc6909(site, scIds, escrow, pastOffboard)
    return { assetIds, assets }
  }

  /** The rotation set holds ERC-20 positions only, so an ERC-6909 one stays in the retired v3.2 escrow. */
  private async escrowErc6909(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    escrow: HexString,
    pastOffboard: boolean
  ) {
    const section = 'spoke.escrow.erc6909'
    const cid = site.centrifugeId
    const { assetIds, assets, tokenIds } = await site.inputs.registeredAssets(false, true)
    const ledgerCalls: Call[] = []
    for (let a = 0; a < assets.length; a++) {
      for (const scId of scIds) ledgerCalls.push(this.call(escrow, 'holding', [scId.raw, assets[a]!, tokenIds[a]!]))
    }
    const [ledger, balances, decimalReads] = await Promise.all([
      this.read(site, ledgerCalls),
      this.read(
        site,
        assets.map((asset, a) => this.call(asset, 'balanceOf', [escrow, tokenIds[a]!]))
      ),
      this.read(
        site,
        assets.map((asset, a) => this.call(asset, 'decimals', [tokenIds[a]!], ERC6909_DECIMALS_ABI))
      ),
    ])
    let held = 0
    for (let a = 0; a < assets.length; a++) {
      let total = 0n
      let reserved = 0n
      for (let s = 0; s < scIds.length; s++) {
        const [t, r] = answered<readonly [bigint, bigint]>(ledger[a * scIds.length + s]!, 'v3.2 PoolEscrow.holding')
        total += BigInt(t)
        reserved += BigInt(r)
      }
      const balance = word(balances[a]!)
      if (total === 0n && reserved === 0n && balance === 0n) continue
      held++
      const accounting = site.v32.accountingToken !== null && same(assets[a]!, site.v32.accountingToken)
      const consequence = accounting
        ? 'an AccountingToken id, dropped with the v3.2 ramp state (AS21): the rotation moves ERC-20 positions only, and the v3.3 ramps register fresh accounting ids'
        : "left behind in the retired v3.2 escrow: the rotation moves ERC-20 positions only; a Root spell's recoverTokens can still move it"
      const subject = `ERC-6909 ${assets[a]} id ${tokenIds[a]} (asset ${assetIds[a]!.raw}) ledger total ${total} reserved ${reserved}, raw balance ${balance}`
      if (pastOffboard)
        this.row(
          'spoke.escrow.erc6909.stayed',
          'info',
          section,
          'offboard',
          cid,
          'chain',
          subject,
          `stayed in the v3.2 escrow at the offboard, ${consequence}`,
          { knownSettled: true }
        )
      else
        this.row(
          accounting ? 'spoke.escrow.erc6909.accountingTokenDropped' : 'spoke.escrow.erc6909.leftBehind',
          'warn',
          section,
          'offboard',
          cid,
          'chain',
          subject,
          consequence,
          {
            amount: { raw: balance, decimals: decimalsOf(decimalReads[a]!), asset: assets[a]! },
          }
        )
    }
    this.row(
      'spoke.escrow.erc6909.positionsGap',
      'gap',
      section,
      'offboard',
      cid,
      'chain',
      'ERC-6909 escrow positions',
      `the ${assets.length} ids registered on this v3.2 spoke read by ledger and raw balance (${held} held); an id the spoke never registered cannot be enumerated`
    )
  }

  /** Another pool's share token held as an asset, whose transfer hook will not admit the v3.3 escrow on its own. */
  private async foreignShareTokenGate(site: PreCheckSite, escrow: HexString, asset: HexString, owner: PoolId) {
    const section = 'spoke.escrow.foreign'
    const cid = site.centrifugeId
    const hook = await this.one<HexString>(site, asset, 'hook', [], 'v3.2 ShareToken.hook')
    const label = `asset ${asset} is pool ${owner.raw}'s share token, balance non-zero`
    if (same(hook, zeroAddress)) {
      this.row(
        'spoke.escrow.foreign.noHook',
        'info',
        section,
        'offboard',
        cid,
        'chain',
        label,
        'no transfer hook: rotated like any other asset',
        {
          knownSettled: true,
        }
      )
      return
    }
    if (await this.hookAllows(site, hook, escrow, UNKNOWN_TARGET)) {
      this.note(
        'spoke.escrow.foreign.admitsUnknown',
        section,
        cid,
        `${label}, and its hook ${hook} admits an unknown target`
      )
      return
    }
    const { ours } = await this.ourHookKind(site, hook)
    if (ours || (await this.isV33Hook(site, hook))) {
      this.row(
        'spoke.escrow.foreign.refusesUnknown',
        'info',
        section,
        'offboard',
        cid,
        'chain',
        `${label}, hook ${hook}`,
        'the hook refuses an unknown target, and `V33SpokeOffboard._moveEndorsed` is what admits it: RotateAssets endorses both escrows on the shared Root for the length of the move and vetoes exactly what it granted (AS38). Nothing to do before the step',
        { knownSettled: true }
      )
      return
    }
    this.row(
      'spoke.escrow.foreign.notOursRefuses',
      'info',
      section,
      'offboard',
      cid,
      'chain',
      `${label}, hook ${hook} (not ours, kept on the token)`,
      "its checkERC20Transfer refuses an unknown target, but a hook not ours need not enforce that view on a transfer, and the endorsement bracket helps only if it reads Root's endorsements: whether RotateAssets moves it is the hook's own rule, measured by walking the rotation on a fork"
    )
  }

  // Other pools' share tokens against this pool's escrow

  private async spokeForeignShareTokens(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    tokens: readonly HexString[],
    spokeAssets: readonly HexString[]
  ) {
    const section = 'spoke.foreignShareTokens'
    const cid = site.centrifugeId
    const escrow = await this.one<HexString>(
      site,
      site.v32.poolEscrowFactory,
      'escrow',
      [this.poolId.raw],
      'v3.2 PoolEscrowFactory.escrow'
    )
    const pools = await this.activePools(site)
    if (!pools.some((pool) => pool.raw === this.poolId.raw)) {
      this.row(
        'spoke.foreignShareTokens.outsideProbe',
        'gap',
        section,
        'arm',
        cid,
        'chain',
        `pool ${this.poolId.raw}`,
        "active here, is outside the pool probe window: other pools on this chain are not all read, so this section's rows and counts are not complete"
      )
    }
    const foreign = await this.otherShareTokens(site, pools)
    const probe = this.probeWindow()
    this.note(
      'spoke.foreignShareTokens.probeSource',
      section,
      cid,
      `source: on-chain, isPoolActive over cid 1..${probe.cidMax} x counter 1..${probe.counterMax} (${pools.length} active pools), shareToken over classes 1..${probe.classMax} (${foreign.length} other pools' tokens), each read as hookDataOf(escrow ${escrow})`
    )
    await this.foreignMemberships(site, escrow, foreign, spokeAssets)
    await this.holderMemberships(site, scIds, tokens, pools)
  }

  private probeWindow() {
    return {
      cidMax: this.options.poolProbe?.cidMax ?? MAX_V32_CENTRIFUGE_ID,
      counterMax: this.options.poolProbe?.counterMax ?? POOL_COUNTER_MAX,
      classMax: this.options.poolProbe?.classMax ?? CLASS_PROBE_MAX,
    }
  }

  /** Pool ids are sparse per hub chain, so a fixed (hub cid, counter) window is probed. */
  private async activePools(site: PreCheckSite): Promise<PoolId[]> {
    const { cidMax, counterMax } = this.probeWindow()
    const window: PoolId[] = []
    for (let cid = 1; cid <= cidMax; cid++) {
      for (let counter = 1; counter <= counterMax; counter++) window.push(PoolId.from(cid, counter))
    }
    const results = await this.read(
      site,
      window.map((pool) => this.call(site.v32.spoke, 'isPoolActive', [pool.raw]))
    )
    const pools: PoolId[] = []
    window.forEach((pool, i) => {
      if (!answered<boolean>(results[i]!, 'foreign pools: v3.2 Spoke.isPoolActive')) return
      pools.push(pool)
      if (i % counterMax === counterMax - 1) {
        this.row(
          'spoke.foreignShareTokens.probeEdge',
          'gap',
          'spoke.foreignShareTokens',
          'arm',
          site.centrifugeId,
          'chain',
          `pool ${pool.raw}`,
          "is active on the pool probe window's edge: pools past it are not read"
        )
      }
    })
    return pools
  }

  /** The v3.2 Spoke reverts on an absent class, so the probe reads every class up to the ceiling. */
  private async otherShareTokens(site: PreCheckSite, pools: readonly PoolId[]): Promise<ForeignToken[]> {
    const { classMax } = this.probeWindow()
    const calls: Call[] = []
    for (const pool of pools) {
      for (let index = 1; index <= classMax; index++)
        calls.push(this.call(site.v32.spoke, 'shareToken', [pool.raw, ShareClassId.from(pool, index).raw]))
    }
    const results = await this.read(site, calls)
    const tokens: ForeignToken[] = []
    pools.forEach((pool, p) => {
      if (pool.raw === this.poolId.raw) return
      for (let index = 1; index <= classMax; index++) {
        const result = results[p * classMax + index - 1]!
        if (!present(result, 'ShareTokenDoesNotExist', 'foreign tokens: v3.2 Spoke.shareToken')) continue
        const token = (result as { result: HexString }).result
        if (same(token, zeroAddress)) continue
        tokens.push({ token, pool, scId: ShareClassId.from(pool, index) })
        if (index === classMax) {
          this.row(
            'spoke.foreignShareTokens.classCeiling',
            'gap',
            'spoke.foreignShareTokens',
            'arm',
            site.centrifugeId,
            'chain',
            `pool ${pool.raw}`,
            "has a class on the class probe's ceiling: classes past it are not read"
          )
        }
      }
    })
    return tokens
  }

  private membership(entry: HexString): { validUntil: bigint; frozen: boolean } {
    const value = BigInt(entry)
    return { validUntil: value >> 64n, frozen: (value & 1n) === 1n }
  }

  private async foreignMemberships(
    site: PreCheckSite,
    escrow: HexString,
    tokens: readonly ForeignToken[],
    spokeAssets: readonly HexString[]
  ) {
    const section = 'spoke.foreignShareTokens'
    const cid = site.centrifugeId
    const results = await this.read(
      site,
      tokens.flatMap((t) => [
        this.call(t.token, 'hook'),
        this.call(t.token, 'hookDataOf', [escrow]),
        this.call(t.token, 'balanceOf', [escrow]),
      ])
    )
    const now = BigInt(Math.floor(Date.now() / 1000))
    let named = 0
    const entries: HexString[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      const hook = answered<HexString>(results[3 * i]!, 'v3.2 ShareToken.hook')
      const entry = answered<HexString>(results[3 * i + 1]!, 'v3.2 ShareToken.hookDataOf')
      entries.push(entry)
      const balance = word(results[3 * i + 2]!)
      if (BigInt(entry) === 0n && balance === 0n) continue
      const { validUntil, frozen } = this.membership(entry)
      const label = `pool ${t.pool.raw} sc${scIndex(t.scId)} token ${t.token} hook ${hook}: entry validUntil ${validUntil}${frozen ? ' (frozen)' : ''}, balance ${balance}`
      named++
      if (validUntil < now) {
        let note =
          validUntil !== 0n
            ? 'expired entry: nothing for the v3.3 escrow to lose'
            : 'position without membership: no entry to lose'
        if (balance !== 0n) {
          note += includes(spokeAssets, t.token)
            ? '; the rotation moves the balance'
            : '; not a registered asset on this spoke, so the rotation leaves the balance in the retired escrow (recoverTokens-only)'
        }
        this.row('spoke.foreignShareTokens.membershipLapsed', 'info', section, 'arm', cid, 'chain', label, note, {
          knownSettled: true,
        })
        continue
      }
      const { warn, note } = await this.membershipVerdict(site, t.pool, hook)
      if (warn)
        this.row('spoke.foreignShareTokens.escrowNotAdmitted', 'warn', section, 'arm', cid, 'chain', label, note, {
          blocking: true,
        })
      else
        this.row('spoke.foreignShareTokens.escrowAdmitted', 'info', section, 'arm', cid, 'chain', label, note, {
          knownSettled: true,
        })
    }
    this.note(
      'spoke.foreignShareTokens.summary',
      section,
      cid,
      `${named} rows named across ${tokens.length} other pools' tokens`
    )
    await this.crossCheckMemberships(site, escrow, tokens, entries)
  }

  private async membershipVerdict(
    site: PreCheckSite,
    parent: PoolId,
    hook: HexString
  ): Promise<{ warn: boolean; note: string }> {
    const pool = `pool ${parent.raw}`
    if (same(hook, zeroAddress)) return { warn: false, note: 'no transfer hook: membership has no effect' }
    if (await this.isV33Hook(site, hook)) {
      return {
        warn: false,
        note: `${pool} has migrated on this chain: its token is on a v3.3 hook, which admits every v3.3 escrow`,
      }
    }
    const { ours, kind } = await this.ourHookKind(site, hook)
    if (ours && (kind === 0 || kind === 3)) {
      return {
        warn: false,
        note: `${HOOK_KIND_NAMES[kind]} hook: membership has no effect on what the escrow receives`,
      }
    }
    if (!ours || !(await this.hookMapped(site, hook))) {
      return {
        warn: true,
        note: `${ours ? 'one of ours the deployed hook map leaves on the token' : 'a hook not ours, kept on the token'}: it never becomes a v3.3 hook, so migrating ${pool} first does not help; its manager must whitelist the new escrow after this pool's offboard`,
      }
    }
    const parentPhase = await this.spokePhase(site, parent)
    if (parentPhase !== null && parentPhase >= SPOKE_PHASE_ONBOARDED) {
      return {
        warn: true,
        note: `${pool} has migrated on this chain (spoke Onboarded) but its token's hook is not a v3.3 one, so its manager must whitelist the new escrow after this pool's offboard`,
      }
    }
    return {
      warn: true,
      note: `${HOOK_KIND_NAMES[kind]}${kind === 1 ? ' hook, every inbound transfer needs membership: migrate ' : ' hook, issuance and claims need membership: migrate '}${pool} first, or its manager whitelists the new escrow after this pool's offboard`,
    }
  }

  /** Disagreements are gaps: the indexer reads head while the on-chain read may be pinned. */
  private async crossCheckMemberships(
    site: PreCheckSite,
    escrow: HexString,
    tokens: readonly ForeignToken[],
    entries: readonly HexString[]
  ) {
    const section = 'spoke.foreignShareTokens'
    const cid = site.centrifugeId
    let rows = 0
    let agree = 0
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      const indexed = await this.candidates.membership({ poolId: t.pool, scId: t.scId }, cid, escrow)
      const entry = entries[i]!
      if (!indexed) {
        if (BigInt(entry) !== 0n) {
          this.row(
            'spoke.foreignShareTokens.noIndexerEntry',
            'gap',
            section,
            'arm',
            cid,
            'idxchain',
            `pool ${t.pool.raw} sc${scIndex(t.scId)} token ${t.token}`,
            'an on-chain entry for the escrow with no indexer whitelistedInvestors row'
          )
        }
        continue
      }
      rows++
      const { validUntil, frozen } = this.membership(entry)
      if (validUntil === indexed.validUntil && frozen === indexed.isFrozen) {
        agree++
        continue
      }
      this.row(
        'spoke.foreignShareTokens.indexerDisagrees',
        'gap',
        section,
        'arm',
        cid,
        'idxchain',
        `indexer whitelistedInvestors pool ${t.pool.raw} sc${scIndex(t.scId)}`,
        `disagrees with the token: on-chain validUntil ${validUntil}${frozen ? ' frozen' : ''}, indexer validUntil ${indexed.validUntil}${indexed.isFrozen ? ' frozen' : ''}`
      )
    }
    this.note(
      'spoke.foreignShareTokens.crossCheck',
      section,
      cid,
      `indexer cross-check (whitelistedInvestors, at head): ${rows} rows for the escrow, ${agree} agree`
    )
  }

  /** The other direction, for the order: holder escrows that are members on this pool's own tokens here. */
  private async holderMemberships(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    tokens: readonly HexString[],
    pools: readonly PoolId[]
  ) {
    const section = 'spoke.holderMemberships'
    const cid = site.centrifugeId
    const escrowResults = await this.read(
      site,
      pools.map((pool) => this.call(site.v32.poolEscrowFactory, 'escrow', [pool.raw]))
    )
    const escrows = escrowResults.map((result) => answered<HexString>(result, 'v3.2 PoolEscrowFactory.escrow'))
    const calls: Call[] = []
    for (const token of tokens) {
      for (const escrow of escrows)
        calls.push(this.call(token, 'hookDataOf', [escrow]), this.call(token, 'balanceOf', [escrow]))
    }
    const results = await this.read(site, calls)
    const hooks = await this.multiPoolFullRestrictions(site, tokens)
    const now = BigInt(Math.floor(Date.now() / 1000))
    let members = 0
    let exposed = 0
    tokens.forEach((token, t) => {
      pools.forEach((holder, p) => {
        if (holder.raw === this.poolId.raw) return
        const i = (t * pools.length + p) * 2
        const entry = answered<HexString>(results[i]!, 'v3.2 ShareToken.hookDataOf')
        const balance = word(results[i + 1]!)
        const label = `holder pool ${holder.raw}'s escrow ${escrows[p]}`
        const tokenLabel = ` this pool's sc${scIndex(scIds[t]!)} token ${token}`
        const { validUntil } = this.membership(entry)
        if (validUntil >= now) {
          members++
          this.row(
            'spoke.holderMemberships.member',
            'info',
            section,
            'arm',
            cid,
            'chain',
            `${label} is a member on${tokenLabel}`,
            'migrate this pool before that one on this chain'
          )
          return
        }
        const hook = hooks[t]
        if (balance === 0n || !hook) return
        exposed++
        this.row(
          'spoke.holderMemberships.holdsWithoutMembership',
          'warn',
          section,
          'arm',
          cid,
          'chain',
          `${label} holds ${balance} of${tokenLabel} without membership, hook ${hook} (v3.2 FullRestrictions, poolEscrow zero)`,
          'migrating this pool first stops that escrow from receiving the token until the holder migrates too (it can still send)',
          { amount: { raw: balance, decimals: 18, asset: token } }
        )
      })
    })
    this.note(
      'spoke.holderMemberships.summary',
      section,
      cid,
      `${members} holder escrows are members on this pool's ${tokens.length} tokens here; ${exposed} hold this pool's tokens without membership under a multi-pool v3.2 FullRestrictions hook`
    )
  }

  /** Per spoke token, its hook when that is a v3.2 FullRestrictions on the multi-pool path, else null. */
  private async multiPoolFullRestrictions(
    site: PreCheckSite,
    tokens: readonly HexString[]
  ): Promise<(HexString | null)[]> {
    const results = await this.read(
      site,
      tokens.map((token) => this.call(token, 'hook'))
    )
    const read = results.map((result) => answered<HexString>(result, 'v3.2 ShareToken.hook'))
    const hooks: (HexString | null)[] = []
    for (let t = 0; t < tokens.length; t++) {
      const first = read.findIndex((hook) => same(hook, read[t]!))
      if (first < t) {
        hooks.push(hooks[first]!)
        continue
      }
      hooks.push((await this.isMultiPoolFullRestrictions(site, read[t]!)) ? read[t]! : null)
    }
    return hooks
  }

  private async isMultiPoolFullRestrictions(site: PreCheckSite, hook: HexString): Promise<boolean> {
    if (same(hook, zeroAddress) || (await this.isV33Hook(site, hook))) return false
    const { ours, kind } = await this.ourHookKind(site, hook)
    if (!ours || kind !== 1) return false
    const [result] = await this.read(site, [this.call(hook, 'poolEscrow')])
    if (result!.status === 'success') return same(result!.result as HexString, zeroAddress)
    this.row(
      'spoke.holderMemberships.hookUnreadable',
      'gap',
      'spoke.holderMemberships',
      'arm',
      site.centrifugeId,
      'chain',
      `hook ${hook} (v3.2 FullRestrictions)`,
      'does not answer poolEscrow(): holder escrows without membership on its tokens are not judged'
    )
    return false
  }

  // Sizes

  private async poolSize(
    site: PreCheckSite,
    scId: ShareClassId,
    assetId: AssetId,
    amount: bigint,
    decimals: number
  ): Promise<{ label: string; inPoolCurrency?: bigint }> {
    const [markers] = await this.read(site, [
      this.call(site.v32.spoke, 'markersPricePoolPerAsset', [this.poolId.raw, scId.raw, assetId.raw]),
    ])
    if (markers!.status !== 'success')
      return { label: "price unreadable: the v3.2 spoke's price reads revert, so the size is unknown" }
    const [computedAt] = markers!.result as readonly [bigint, bigint, bigint]
    if (BigInt(computedAt) === 0n) return { label: 'no stored v3.2 price: size unknown' }
    const [price] = await this.read(site, [
      this.call(site.v32.spoke, 'pricePoolPerAsset', [this.poolId.raw, scId.raw, assetId.raw, false]),
    ])
    if (price!.status !== 'success')
      return { label: "price unreadable: the v3.2 spoke's price reads revert, so the size is unknown" }
    const size = (amount * BigInt(price!.result as bigint)) / 10n ** BigInt(decimals)
    return { label: `~${units(size, 18)} in pool currency ${await this.poolCurrencyLabel()}`, inPoolCurrency: size }
  }

  private async poolCurrencyLabel(): Promise<string> {
    const currency = await (this.#shared.hubCurrency ??= this.readHubCurrency())
    return currency.id === null ? `(currency id unread: ${currency.unread})` : `id ${currency.id}`
  }

  private async readHubCurrency(): Promise<{ id: bigint | null; unread: string }> {
    const hub = this.hub
    if (!hub) return { id: null, unread: 'no client configured for the hub chain' }
    const [result] = await this.read(hub, [this.call(hub.v32.hubRegistry, 'currency', [this.poolId.raw])])
    return result!.status === 'success'
      ? { id: BigInt(result!.result as bigint), unread: '' }
      : { id: null, unread: 'v3.2 HubRegistry.currency did not answer' }
  }

  /** The same three shape checks `_replayValuation` makes, run here while rollback still exists. */
  private async spokeValuations(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    vaults: readonly MigrationLiveVault[]
  ) {
    const section = 'spoke.valuations'
    const cid = site.centrifugeId
    const results = await this.read(
      site,
      scIds.map((scId) => this.call(site.v32.syncManager, 'valuation', [this.poolId.raw, scId.raw]))
    )
    for (let i = 0; i < scIds.length; i++) {
      const scId = scIds[i]!
      const valuation = answered<HexString>(results[i]!, 'v3.2 SyncManager.valuation')
      if (same(valuation, zeroAddress)) continue
      const label = `sc${scIndex(scId)} valuation ${valuation}`
      if (!vaults.some((vault) => vault.isSync && vault.scId.raw === scId.raw)) {
        this.row(
          'spoke.valuations.notCarried',
          'info',
          section,
          'onboardSpokes',
          cid,
          'chain',
          label,
          'set on a class with no sync vault: not carried (AS10 replays only through a sync vault seed)',
          { knownSettled: true }
        )
        continue
      }
      if (!(await site.reader.hasCode(valuation, site.reader.block))) {
        this.row(
          'spoke.valuations.noCode',
          'warn',
          section,
          'onboardSpokes',
          cid,
          'chain',
          label,
          'no code: ConfigureVaults leaves it unset on v3.3 (ValuationCleared, AS10)'
        )
      } else if (
        (site.v32.identityValuation && same(valuation, site.v32.identityValuation)) ||
        (site.v32.oracleValuation && same(valuation, site.v32.oracleValuation))
      ) {
        this.row(
          'spoke.valuations.stackValuation',
          'warn',
          section,
          'onboardSpokes',
          cid,
          'chain',
          label,
          'v3.2 stack valuation, bound to the retired hub registry: ConfigureVaults leaves it unset on v3.3 (ValuationCleared, AS10)'
        )
      } else {
        const [price] = await this.read(site, [this.call(valuation, 'pricePoolPerShare', [this.poolId.raw, scId.raw])])
        if (price!.status !== 'success') {
          this.row(
            'spoke.valuations.wrongShape',
            'warn',
            section,
            'onboardSpokes',
            cid,
            'chain',
            label,
            'pricePoolPerShare reverts or answers the wrong shape: ConfigureVaults leaves it unset on v3.3 (ValuationCleared, AS10); re-set one after activation'
          )
        } else {
          this.note(
            'spoke.valuations.answers',
            section,
            cid,
            `${label} answers pricePoolPerShare = ${price!.result} (shape only, sanity not checked)`
          )
        }
      }
    }
  }

  private async spokeManagers(site: PreCheckSite, candidates: MigrationSpokeCandidates): Promise<HexString[]> {
    const section = 'spoke.managers'
    const cid = site.centrifugeId
    const [bs, gw] = await Promise.all([
      site.inputs.liveManagers(this.poolId, site.v32.balanceSheet, [
        ...candidates.managers,
        ...candidates.rampInstances,
      ]),
      site.inputs.liveManagers(this.poolId, site.v32.gateway, candidates.managers),
    ])
    for (const who of bs) this.note('spoke.managers.balanceSheet', section, cid, `balance-sheet manager ${who}`)
    for (const who of gw)
      this.row(
        'spoke.managers.liveGatewayManager',
        'warn',
        section,
        'offboard',
        cid,
        'idxchain',
        `gateway manager ${who}`,
        LIVE_GATEWAY_MANAGER
      )
    this.note(
      'spoke.managers.summary',
      section,
      cid,
      `${bs.length} balance-sheet, ${gw.length} gateway managers among ${candidates.managers.length} indexer poolManagers candidates + ${candidates.rampInstances.length} onOffRampManagers rows`
    )
    this.row(
      'spoke.managers.balanceSheetGap',
      'gap',
      section,
      'offboard',
      cid,
      'idxchain',
      'balance-sheet managers',
      'indexer poolManagers candidates re-read on-chain; completeness not provable on-chain'
    )
    if (this.options.gatewayLogsFromBlock !== undefined) await this.gatewayManagerSweep(site, gw)
    else
      this.row(
        'spoke.managers.gatewayGap',
        'gap',
        section,
        'offboard',
        cid,
        'idx',
        'gateway managers',
        "candidate-limited (no indexer entity); options.gatewayLogsFromBlock sweeps the v3.2 Gateway's UpdateManager logs"
      )
    return bs
  }

  /** Every `UpdateManager(poolId, who, _)` the v3.2 Gateway ever emitted for this pool, each `who` re-read now. */
  private async gatewayManagerSweep(site: PreCheckSite, known: readonly HexString[]) {
    const section = 'spoke.managers'
    const cid = site.centrifugeId
    const fromBlock = this.options.gatewayLogsFromBlock!
    const poolTopic = `0x${this.poolId.raw.toString(16).padStart(64, '0')}` as HexString
    const [logs, control] = await Promise.all([
      site.reader.logs({
        address: site.v32.gateway,
        topics: [topicOf('UpdateManager(uint64,address,bool)'), poolTopic],
        fromBlock,
      }),
      site.reader.logs({ address: site.v32.gateway, topics: [topicOf('Rely(address)')], fromBlock }),
    ])
    const who = unique(
      logs
        .filter((log) => log.topics.length >= 3)
        .map((log) => bytes32ToAddress(`0x${log.topics[2]!.slice(26)}` as HexString))
    )
    const live = who.length === 0 ? [] : await site.inputs.liveManagers(this.poolId, site.v32.gateway, who)
    for (const manager of live) {
      if (includes(known, manager)) continue
      this.row(
        'spoke.managers.liveGatewayManager',
        'warn',
        section,
        'offboard',
        cid,
        'logs',
        `gateway manager (log sweep) ${manager}`,
        LIVE_GATEWAY_MANAGER
      )
    }
    if (logs.length === 0 && control.length === 0) {
      this.row(
        'spoke.managers.gatewaySweepEmpty',
        'gap',
        section,
        'offboard',
        cid,
        'logs',
        'gateway managers',
        `the UpdateManager sweep from block ${fromBlock} answered no log and the same range answers no Rely from the gateway either, so its zero is not a measurement; the set rests on the indexer candidates`
      )
      return
    }
    this.note(
      'spoke.managers.gatewaySweep',
      section,
      cid,
      `UpdateManager log sweep from block ${fromBlock}: ${logs.length} logs, ${live.length} live gateway managers`
    )
  }

  private async spokeRamps(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    assets: readonly HexString[],
    assetIds: readonly AssetId[],
    balanceSheetManagers: readonly HexString[],
    candidates: MigrationSpokeCandidates & { rampClasses: { instance: HexString; scId: ShareClassId }[] }
  ) {
    const section = 'spoke.ramps'
    const cid = site.centrifugeId
    const granted = await site.inputs.v32Ramps(this.poolId, balanceSheetManagers)
    const v33 =
      site.v33 && site.v33.onOffRampFactory && site.v33.accountingToken && site.v33.spokeRegistry ? site.v33 : null
    if (!v33 && granted.length !== 0) {
      this.row(
        'spoke.ramps.noV33Stack',
        'gap',
        section,
        'onboardSpokes',
        cid,
        'chain',
        'v3.3 stack',
        'this chain records no v3.3 stack: the previewed v3.3 instance and the accounting-id registrations are not read'
      )
    }
    for (const row of candidates.rampClasses)
      await this.rampRow(site, row.instance, row.scId, granted, balanceSheetManagers)
    for (const instance of granted) await this.ramp(site, instance, scIds, assets, assetIds, candidates, v33)
    await this.poolBoundNonRamps(site, granted, balanceSheetManagers)
    await this.oneRampPerClass(site, granted)
    this.note(
      'spoke.ramps.summary',
      section,
      cid,
      `${granted.length} BS-granted v3.2 instances replayed, ${candidates.rampClasses.length} indexer onOffRampManagers rows`
    )
    if (granted.length !== 0) {
      this.row(
        'spoke.ramps.configGap',
        'gap',
        section,
        'onboardSpokes',
        cid,
        'idxchain',
        'ramp config',
        'onramps read over every registered asset; relayers and offramp receivers are indexer candidates re-read on-chain, so one the indexer never recorded is not replayed'
      )
    }
  }

  private async rampIdentity(
    site: PreCheckSite,
    instance: HexString
  ): Promise<{ poolId: bigint; scId: HexString } | null> {
    const [pool, scId] = await this.read(site, [
      { address: instance, abi: LEGACY_ABI as Abi, functionName: 'poolId' },
      { address: instance, abi: LEGACY_ABI as Abi, functionName: 'scId' },
    ])
    if (pool!.status !== 'success' || scId!.status !== 'success') return null
    return { poolId: BigInt(pool!.result as bigint), scId: scId!.result as HexString }
  }

  /** An indexer row: the instance's own `poolId()`/`scId()` against the pool and the class it is filed under. */
  private async rampRow(
    site: PreCheckSite,
    instance: HexString,
    filed: ShareClassId,
    granted: readonly HexString[],
    balanceSheetManagers: readonly HexString[]
  ) {
    const section = 'spoke.ramps'
    const cid = site.centrifugeId
    const label = `indexer ramp ${instance} filed under sc${scIndex(filed)}`
    if (!includes(balanceSheetManagers, instance)) {
      this.row(
        'spoke.ramps.notGranted',
        'info',
        section,
        'onboardSpokes',
        cid,
        'idxchain',
        label,
        'holds no v3.2 BalanceSheet grant: not replayed, no v3.3 instance is created for it',
        { knownSettled: true }
      )
      return
    }
    const identity = await this.rampIdentity(site, instance)
    if (!identity || identity.poolId !== this.poolId.raw || identity.scId.toLowerCase() !== filed.raw.toLowerCase()) {
      this.row(
        'spoke.ramps.instanceMismatch',
        'stop',
        section,
        'onboardSpokes',
        cid,
        'idxchain',
        label,
        identity
          ? `the instance answers pool ${identity.poolId} sc${scIndex(new ShareClassId(identity.scId))}: RampV32InstanceMismatch at SetupRamps for a seed that names the filed class`
          : 'the instance does not answer poolId()/scId(): RampV32InstanceMismatch at SetupRamps'
      )
      return
    }
    if (!includes(granted, instance)) {
      this.row(
        'spoke.ramps.notBound',
        'stop',
        section,
        'onboardSpokes',
        cid,
        'idxchain',
        label,
        "not bound to this chain's v3.2 BalanceSheet, so the derivation does not seed it, and a seed naming it refuses at SetupRamps"
      )
      return
    }
    this.note('spoke.ramps.replayed', section, cid, `${label}: answers this pool and class, BS-granted, replayed`)
  }

  private async ramp(
    site: PreCheckSite,
    instance: HexString,
    scIds: readonly ShareClassId[],
    assets: readonly HexString[],
    assetIds: readonly AssetId[],
    candidates: MigrationSpokeCandidates,
    v33: PreCheckV33 | null
  ) {
    const section = 'spoke.ramps'
    const cid = site.centrifugeId
    const identity = await this.rampIdentity(site, instance)
    const scId = new ShareClassId(identity?.scId ?? ('0x00000000000000000000000000000000' as HexString))
    const label = `sc${scIndex(scId)} ramp ${instance}`
    if (!scIds.some((known) => known.raw.toLowerCase() === scId.raw.toLowerCase())) {
      this.row(
        'spoke.ramps.classMissing',
        'stop',
        section,
        'onboardSpokes',
        cid,
        'chain',
        label,
        "its class is not on this spoke: SetupRamps's newManager refuses ShareTokenDoesNotExist"
      )
    }
    if (v33) {
      const preview = await this.tryOne<HexString>(site, v33.onOffRampFactory!, 'previewManager', [
        this.poolId.raw,
        scId.raw,
      ])
      this.note(
        'spoke.ramps.preview',
        section,
        cid,
        `${label} -> v3.3 instance ${preview ?? 'unreadable'} (previewManager: what SetupRamps deploys and asserts)`
      )
    }
    const configs = await site.inputs.rampConfigs(instance, candidates.ramp, assets, assetIds)
    for (const config of configs) this.note('spoke.ramps.config', section, cid, `${label} replays config ${config}`)
    if (configs.length === 0) {
      this.row(
        'spoke.ramps.noConfig',
        'info',
        section,
        'onboardSpokes',
        cid,
        'chain',
        label,
        'no live config tuple: the fresh instance is deployed and granted with nothing to replay',
        { knownSettled: true }
      )
    }
    const rampAssets = await site.inputs.rampAssets(instance, candidates.ramp, assets)
    if (!v33) return
    for (const asset of rampAssets) {
      await this.rampAccountingId(site, label, asset, true, v33)
      await this.rampAccountingId(site, label, asset, false, v33)
    }
  }

  /** `SetupRamps` asserts both ids on the spoke registry; the plan registers them before `onboardHub`. */
  private async rampAccountingId(
    site: PreCheckSite,
    label: string,
    asset: HexString,
    liability: boolean,
    v33: PreCheckV33
  ) {
    const section = 'spoke.ramps'
    const cid = site.centrifugeId
    const tokenId = await this.one<bigint>(
      site,
      v33.accountingToken!,
      'toTokenId',
      [this.poolId.raw, asset, liability],
      'v3.3 AccountingToken.toTokenId'
    )
    const [idResult] = await this.read(site, [
      this.call(v33.spokeRegistry!, 'assetToId', [v33.accountingToken!, tokenId]),
    ])
    const id = present(idResult!, 'UnknownAsset', 'v3.3 SpokeRegistry.assetToId')
      ? BigInt((idResult as { result: bigint }).result)
      : 0n
    const row = `${label} asset ${asset}${liability ? ' liability' : ' receipt'} accounting id`
    if (id === 0n) {
      if (await this.localPastOffboard(site))
        this.row(
          'spoke.ramps.assetNotRegistered',
          'stop',
          section,
          'onboardSpokes',
          cid,
          'chain',
          `${row} unregistered`,
          'RampAssetNotRegistered at SetupRamps'
        )
      else
        this.row(
          'spoke.ramps.assetRegisteredLater',
          'info',
          section,
          'onboardSpokes',
          cid,
          'chain',
          `${row} not registered yet`,
          "the plan's registerAsset toward the pool's hub registers it before onboardHub; SetupRamps refuses without it"
        )
      return
    }
    if (this.poolId.centrifugeId !== cid || !v33.hubRegistry) {
      this.note(
        'spoke.ramps.assetOnSpoke',
        section,
        cid,
        `${row} ${id} on the spoke (the pool's hub is another chain: its registry is not read here)`
      )
      return
    }
    if (await this.one<boolean>(site, v33.hubRegistry, 'isRegistered', [id], 'v3.3 HubRegistry.isRegistered')) {
      this.note('spoke.ramps.assetOnSpokeAndHub', section, cid, `${row} ${id} on the spoke and the hub`)
      return
    }
    this.row(
      'spoke.ramps.assetUnknownToHub',
      'warn',
      section,
      'onboardSpokes',
      cid,
      'chain',
      `${row} ${id} unknown to the hub registry`,
      "the spoke registered it but the pool's hub has no record of the id: its registerAsset named another cid or has not landed"
    )
  }

  /** An issuer's contract can answer the pool's `poolId()` and `scId()` like a ramp does. */
  private async poolBoundNonRamps(
    site: PreCheckSite,
    granted: readonly HexString[],
    balanceSheetManagers: readonly HexString[]
  ) {
    for (const who of balanceSheetManagers) {
      if (includes(granted, who)) continue
      const identity = await this.rampIdentity(site, who)
      if (!identity || identity.poolId !== this.poolId.raw) continue
      this.row(
        'spoke.ramps.notRelayer',
        'info',
        'spoke.ramps',
        'onboardSpokes',
        site.centrifugeId,
        'chain',
        `balance-sheet manager ${who}`,
        "answers this pool's poolId() and scId() but not the OnOfframp relayer view: not a ramp, so no v3.3 instance is set up for it and its grant is replayed as it is",
        { knownSettled: true }
      )
    }
  }

  private async oneRampPerClass(site: PreCheckSite, granted: readonly HexString[]) {
    const results = await this.read(
      site,
      granted.map((instance) => ({ address: instance, abi: LEGACY_ABI as Abi, functionName: 'scId' }))
    )
    const classes = results.map((result) =>
      (answered<HexString>(result, 'v3.2 OnOfframp.scId') as string).toLowerCase()
    )
    for (let i = 0; i < granted.length; i++) {
      if (classes.findIndex((scId) => scId === classes[i]) !== i) continue
      const others = granted.filter((_, j) => j !== i && classes[j] === classes[i])
      if (others.length === 0) continue
      this.row(
        'spoke.ramps.twoForOneClass',
        'stop',
        'spoke.ramps',
        'arm',
        site.centrifugeId,
        'chain',
        `sc${scIndex(new ShareClassId(classes[i] as HexString))} ramps ${granted[i]} and ${others.join(' and ')}`,
        "BS-granted v3.2 instances of one class, which v3.3 gives one instance: RampAlreadySetup at SetupRamps for the second; revoke one instance's v3.2 BalanceSheet manager grant before arming"
      )
    }
  }

  private async spokeSyncReserves(site: PreCheckSite, scIds: readonly ShareClassId[], assets: readonly HexString[]) {
    const keys = await site.inputs.syncReserveKeys(this.poolId, [...scIds], assets)
    for (const key of keys)
      this.note(
        'spoke.syncReserves.maxReserve',
        'spoke.syncReserves',
        site.centrifugeId,
        `sc${scIndex(new ShareClassId(key.scId))} asset ${key.asset} carries a non-zero v3.2 maxReserve`
      )
    this.note(
      'spoke.syncReserves.summary',
      'spoke.syncReserves',
      site.centrifugeId,
      `${keys.length} non-zero keys across ${scIds.length * assets.length} (class, asset) pairs probed`
    )
  }

  private async spokeAssetPrices(site: PreCheckSite, scIds: readonly ShareClassId[]): Promise<AssetId[]> {
    const keys = await site.inputs.registeredAssetPriceKeys(this.poolId, [...scIds])
    this.note(
      'spoke.assetPrices.summary',
      'spoke.assetPrices',
      site.centrifugeId,
      `${keys.length} (class, asset id) pairs hold a stored price (computedAt != 0) over ${scIds.length} classes and every id the spoke registered`
    )
    return keys.map((key) => new AssetId(BigInt(key.assetId)))
  }

  /** The ids the vault seeds, price keys and rotation carry, each read on both stacks. */
  private async spokeAssetIds(
    site: PreCheckSite,
    scIds: readonly ShareClassId[],
    vaults: readonly MigrationLiveVault[],
    priceIds: readonly AssetId[],
    assets: readonly HexString[],
    assetIds: readonly AssetId[],
    tokens: readonly HexString[]
  ) {
    const section = 'spoke.assetIds'
    const cid = site.centrifugeId
    const rotated = await site.inputs.rotationAssets(this.poolId, [...scIds], assets, tokens)
    const rotationIds = rotated.map((asset) => assetIds[assets.findIndex((candidate) => same(candidate, asset))]!)
    const ids: AssetId[] = []
    const carriers: number[] = []
    const add = (list: readonly AssetId[], by: number) => {
      for (const id of list) {
        let at = ids.findIndex((known) => known.raw === id.raw)
        if (at === -1) {
          at = ids.length
          ids.push(id)
          carriers.push(0)
        }
        carriers[at]! |= by
      }
    }
    add(
      vaults.map((vault) => vault.assetId),
      CARRIED_BY_VAULT
    )
    add(priceIds, CARRIED_BY_PRICE)
    add(rotationIds, CARRIED_BY_ROTATION)
    const registry = site.v33?.spokeRegistry ?? null
    if (!registry) {
      this.row(
        'spoke.assetIds.noV33Registry',
        'gap',
        section,
        'onboardSpokes',
        cid,
        'chain',
        'v3.3 spoke registry',
        `this chain records no v3.3 spoke registry: the ${ids.length} asset ids the pool's keys carry are not compared with v3.3`
      )
      return
    }
    const [onV32, onV33] = await Promise.all([
      this.read(
        site,
        ids.map((id) => this.call(site.v32.spoke, 'idToAsset', [id.raw]))
      ),
      this.read(
        site,
        ids.map((id) => this.call(registry, 'idToAsset', [id.raw]))
      ),
    ])
    const answer = (result: Result) => {
      if (result.status !== 'success') return 'no answer (reverts)'
      const [asset, tokenId] = result.result as readonly [HexString, bigint]
      return `${asset}${BigInt(tokenId) === 0n ? '' : ` tokenId ${tokenId}`}`
    }
    let sameCount = 0
    ids.forEach((id, i) => {
      const a = answer(onV32[i]!)
      const b = answer(onV33[i]!)
      if (onV32[i]!.status === 'success' && onV33[i]!.status === 'success' && a.toLowerCase() === b.toLowerCase()) {
        sameCount++
        return
      }
      const row = `asset id ${id.raw}: v3.2 ${a}, v3.3 ${b}`
      if ((carriers[i]! & (CARRIED_BY_VAULT | CARRIED_BY_PRICE)) === 0) {
        this.row(
          'spoke.assetIds.renamedOnRotation',
          'warn',
          section,
          'onboardSpokes',
          cid,
          'chain',
          row,
          "carried only by the rotation, which keys by address, so nothing refuses; but v3.3 names another asset under this id, so what v3.3 keys by it (the hub's holding) no longer describes this position"
        )
        return
      }
      const steps: string[] = []
      if (carriers[i]! & CARRIED_BY_VAULT) steps.push("RegisterVaults and ConfigureVaults' pointer restore")
      if (carriers[i]! & CARRIED_BY_PRICE) steps.push('CopyAssetPrice')
      this.row(
        'spoke.assetIds.diverged',
        'stop',
        section,
        'onboardSpokes',
        cid,
        'chain',
        row,
        `AssetIdDiverged at ${steps.join(', ')}`
      )
    })
    this.note(
      'spoke.assetIds.summary',
      section,
      cid,
      `${sameCount} asset ids name the same asset on v3.3 of ${ids.length} carried (vault seeds, price keys, rotation)`
    )
  }

  /** The hook-manager grant set, the one per-token grant no indexer entity carries. */
  private async spokeHookManagers(site: PreCheckSite, scIds: readonly ShareClassId[], tokens: readonly HexString[]) {
    const section = 'spoke.hookManagers'
    const cid = site.centrifugeId
    if (site.inputs.options.hookLogsFromBlock === undefined) {
      const hookResults = await this.read(
        site,
        tokens.map((token) => this.call(token, 'hook'))
      )
      const hooked = hookResults.filter(
        (result) => result.status === 'success' && !same(result.result as HexString, zeroAddress)
      ).length
      if (hooked === 0) {
        this.note(
          'spoke.hookManagers.noHooks',
          section,
          cid,
          'no class on this spoke carries a v3.2 hook: there is no grant to enumerate'
        )
        return
      }
      this.row(
        'spoke.hookManagers.notEnumerated',
        'gap',
        section,
        'onboardSpokes',
        cid,
        'skipped',
        'hook managers',
        `the grants on the ${hooked} of ${tokens.length} classes with a v3.2 hook are not enumerated (no indexer entity, log sweep off) and are assumed none, so OnboardSpokeInput.hookManagers is empty; the pool manager re-grants one after activation through a hub managerCall. options.hookLogsFromBlock sweeps the UpdateHookManager logs`
      )
      return
    }
    const grants = await site.inputs.hookGrants([...scIds], tokens)
    let total = 0
    let kept = 0
    for (const grant of grants) {
      const keeps = !(await this.hookMapped(site, grant.v32Hook))
      if (keeps) kept += grant.managers.length
      else total += grant.managers.length
      for (const manager of grant.managers) {
        this.note(
          'spoke.hookManagers.grant',
          section,
          cid,
          `sc${scIndex(grant.scId)} hook ${grant.v32Hook} manager ${manager}${keeps ? ' (kept hook: the grant stays on it, none is sent)' : ''}`
        )
      }
    }
    this.note(
      'spoke.hookManagers.summary',
      section,
      cid,
      `${total} live grants to replay across ${grants.length} of ${scIds.length} classes${kept !== 0 ? `; ${kept} more on kept hooks, left out of the input` : ''}`
    )
    this.row(
      'spoke.hookManagers.sweepGap',
      'gap',
      section,
      'onboardSpokes',
      cid,
      'logs',
      'hook managers',
      'UpdateHookManager log sweep per (hook, token); an RPC that caps the range answers short'
    )
  }
}

/** The class counter of a share class id: the low 64 bits, as `ShareClassId.index()` reads it. */
export function scIndex(scId: ShareClassId): number {
  return Number(BigInt(scId.raw) & ((1n << 64n) - 1n))
}

function pairLabel(scId: ShareClassId, assetId: AssetId): string {
  return `sc${scIndex(scId)} asset ${assetId.raw}`
}

/** Whole units with four fraction digits, for a human reading the row next to the raw figure. */
export function units(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const fraction = ((amount % scale) * 10_000n) / scale
  return `${whole}.${fraction.toString().padStart(4, '0')}`
}

function uniqueCids(cids: readonly CentrifugeId[]): CentrifugeId[] {
  return [...new Set(cids)].sort((a, b) => a - b)
}
