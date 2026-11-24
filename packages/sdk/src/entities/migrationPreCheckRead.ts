import { ProtocolVersionResolutionError, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import type {
  InvestOrderRow,
  InvestOrderState,
  OnOffRampManagerRow,
  PoolManagerRow,
  PoolMigrationRow,
  RedeemOrderRow,
  RedeemOrderState,
  TokenInstancePositionRow,
  WhitelistedInvestorRow,
  WhitelistedInvestorsPage,
} from '@centrifuge/queries/core'
import { defer, firstValueFrom, map, of, switchMap, type Observable } from 'rxjs'
import { zeroAddress, type PublicClient } from 'viem'
import type { Centrifuge, SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'
import { queryCrosschainMessages, type CrosschainMessage, type CrosschainMessagesFilter } from './crosschainMessages.js'
import {
  clientReader,
  MigrationInputsDerivation,
  v32RefsOf,
  type MigrationInputsOptions,
  type V33Refs,
} from './MigrationInputs.js'
import { spokeCandidates } from './migrationInputsRead.js'
import {
  migratedPreCheckReport,
  MigrationPreCheck,
  type MigrationClaimables,
  type PreCheckCandidates,
  type PreCheckInvestorKey,
  type PreCheckMessage,
  type PreCheckOptions,
  type PreCheckReport,
  type PreCheckSite,
  type PreCheckV33,
} from './MigrationPreCheck.js'
import type { Pool } from './Pool.js'
import { migrationFacadeOf } from './PoolMigration.js'
import { activeSpokesOf, unreadableSpokesOf } from './migrationSpokes.js'
import { isV3_3 } from '../utils/protocolVersion.js'

export type MigrationPreCheckOptions = PreCheckOptions &
  Pick<MigrationInputsOptions, 'hookLogsFromBlock' | 'hookMap'> & {
    /** The chains to read; every active network of the pool plus its hub by default. */
    centrifugeIds?: CentrifugeId[]
  }

/** @internal */
export function migrationPreCheckKey(options: MigrationPreCheckOptions): string {
  return [
    options.centrifugeIds?.join(',') ?? '',
    options.hookLogsFromBlock?.toString() ?? '',
    options.hookMap?.v32.join(',') ?? '',
    options.hookMap?.v33.join(',') ?? '',
    options.gatewayLogsFromBlock?.toString() ?? '',
    String(options.bridgeCircuitBreaker ?? ''),
    [options.poolProbe?.cidMax, options.poolProbe?.counterMax, options.poolProbe?.classMax]
      .map((n) => n ?? '')
      .join('x'),
  ].join('|')
}

const optional = (ctx: SdkProtocolContext | null, name: string): HexString | null => {
  const value = ctx ? ((ctx as unknown as Record<string, unknown>)[name] as HexString | undefined) : undefined
  return value && value !== zeroAddress ? value : null
}

async function siteFor(
  root: Centrifuge,
  poolId: PoolId,
  centrifugeId: CentrifugeId,
  options: MigrationPreCheckOptions
): Promise<PreCheckSite> {
  const [ctx, client] = await Promise.all([
    firstValueFrom(root.protocolContext({ poolId, centrifugeId })),
    firstValueFrom(root.getClient(centrifugeId)) as Promise<PublicClient>,
  ])
  let ctx33: SdkProtocolContext | null = null
  try {
    ctx33 = await firstValueFrom(root.protocolContext({ centrifugeId, protocolVersion: '3.3' }))
  } catch (error) {
    if (!(error instanceof ProtocolVersionResolutionError || error instanceof UnsupportedForProtocolVersionError))
      throw error
    ctx33 = null
  }
  const block = await client.getBlockNumber()
  const v33Refs: V33Refs = {
    asyncRequestManager: optional(ctx33, 'asyncRequestManager') ?? zeroAddress,
    syncManager: optional(ctx33, 'syncManager') ?? zeroAddress,
    asyncVaultFactory: optional(ctx33, 'asyncVaultFactory') ?? zeroAddress,
    syncDepositVaultFactory: optional(ctx33, 'syncDepositVaultFactory') ?? zeroAddress,
    onOffRampFactory: optional(ctx33, 'onOffRampFactory') ?? zeroAddress,
  }
  const inputsOptions: MigrationInputsOptions = {
    ...(options.hookLogsFromBlock !== undefined ? { hookLogsFromBlock: options.hookLogsFromBlock } : {}),
    ...(options.hookMap ? { hookMap: options.hookMap } : {}),
  }
  const reader = clientReader(client, block)
  const hookNames = ['freezeOnlyHook', 'fullRestrictionsHook', 'freelyTransferableHook', 'redemptionRestrictionsHook']
  const v33: PreCheckV33 | null = ctx33
    ? {
        hubRegistry: optional(ctx33, 'hubRegistry'),
        spokeRegistry: optional(ctx33, 'spokeRegistry'),
        accountingToken: optional(ctx33, 'accountingToken'),
        onOffRampFactory: optional(ctx33, 'onOffRampFactory'),
        multiAdapter: optional(ctx33, 'multiAdapter'),
        layerZeroAdapter: optional(ctx33, 'layerZeroAdapter'),
        chainlinkAdapter: optional(ctx33, 'chainlinkAdapter'),
        hooks: hookNames.map((name) => optional(ctx33, name)),
      }
    : null
  const migration: PreCheckSite['migration'] = migrationFacadeOf(centrifugeId, root.config.environment)
  return {
    centrifugeId,
    reader,
    inputs: new MigrationInputsDerivation(
      reader,
      v32RefsOf(ctx),
      v33Refs,
      ctx.contractAbis,
      centrifugeId,
      inputsOptions
    ),
    v32: {
      ...v32RefsOf(ctx),
      hub: optional(ctx, 'hub'),
      hooks: hookNames.map((name) => optional(ctx, name)),
      identityValuation: optional(ctx, 'identityValuation'),
      oracleValuation: optional(ctx, 'oracleValuation'),
      accountingToken: optional(ctx, 'accountingToken'),
    },
    v33,
    migration,
  }
}

const PAGE = 1000
const MAX_PAGES = 50

/** Every payload the filter matches, page after page by cursor; a gap names what was left past the page cap. */
async function allPayloads(
  root: Centrifuge,
  filter: Omit<CrosschainMessagesFilter, 'limit' | 'after' | 'before'>,
  what: string
): Promise<{ items: CrosschainMessage[]; gaps: string[] }> {
  const items: CrosschainMessage[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await firstValueFrom(
      queryCrosschainMessages(root, { ...filter, limit: PAGE, ...(after ? { after } : {}) })
    )
    items.push(...result.items)
    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) return { items, gaps: [] }
    after = result.pageInfo.endCursor
  }
  return {
    items,
    gaps: [
      `${what}: ${items.length} payloads read over ${MAX_PAGES} pages and more remain; the rows past them are not checked`,
    ],
  }
}

/** Every row of an offset-paged table, held to its `totalCount`. */
async function allRows<T>(
  fetch: (offset: number) => Promise<{ items: T[]; totalCount: number }>,
  what: string
): Promise<{ items: T[]; gaps: string[] }> {
  const items: T[] = []
  let total = Infinity
  for (let page = 0; page < MAX_PAGES && items.length < total; page++) {
    const result = await fetch(page * PAGE)
    total = result.totalCount
    items.push(...result.items)
    if (result.items.length === 0) break
  }
  if (items.length < total)
    return { items, gaps: [`${what}: ${items.length} of ${total} rows read; the rest are not checked`] }
  return { items, gaps: [] }
}

function validUntilSeconds(row: WhitelistedInvestorRow): bigint {
  const value = row.validUntil
  if (/^\d+$/.test(value)) return BigInt(value)
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0n : BigInt(Math.floor(ms / 1000))
}

/** @internal */
export function candidatesFor(root: Centrifuge, pool: Pool): PreCheckCandidates {
  const poolId = pool.id
  const lower = (address: string) => address.toLowerCase() as HexString
  const orderKeys = async (
    scId: ShareClassId
  ): Promise<{ keys: { account: HexString; assetId: string; centrifugeId: CentrifugeId }[]; gaps: string[] }> => {
    const tokenId = scId.raw
    const [invest, redeem, closedInvest, closedRedeem] = await Promise.all([
      root._queryDataOnce<InvestOrderState>('investOrderState', { tokenId, limit: PAGE }),
      root._queryDataOnce<RedeemOrderState>('redeemOrderState', { tokenId, limit: PAGE }),
      root._queryDataOnce<InvestOrderRow[]>('closedInvestOrders', { tokenId }),
      root._queryDataOnce<RedeemOrderRow[]>('closedRedeemOrders', { tokenId }),
    ])
    const key = (account: string, assetId: string, cid?: string) => ({
      account: lower(account),
      assetId,
      centrifugeId: Number(cid ?? assetCentrifugeId(assetId)) as CentrifugeId,
    })
    const lists: [string, { length: number }][] = [
      ['pendingInvestOrders', invest.pendingInvestOrders],
      ['investOrders', invest.investOrders],
      ['pendingRedeemOrders', redeem.pendingRedeemOrders],
      ['redeemOrders', redeem.redeemOrders],
      ['closedInvestOrders', closedInvest],
      ['closedRedeemOrders', closedRedeem],
    ]
    const gaps = lists
      .filter(([, list]) => list.length >= PAGE)
      .map(
        ([name]) =>
          `class ${scId.raw}: ${name} answered ${PAGE} rows, the page ceiling, so the investor set may be short`
      )
    return {
      keys: [
        ...invest.pendingInvestOrders.map((row) => key(row.account, row.assetId)),
        ...invest.investOrders.map((row) => key(row.account, row.assetId, row.asset.centrifugeId)),
        ...redeem.pendingRedeemOrders.map((row) => key(row.account, row.assetId)),
        ...redeem.redeemOrders.map((row) => key(row.account, row.assetId, row.asset.centrifugeId)),
        ...closedInvest.map((row) => key(row.account, row.assetId)),
        ...closedRedeem.map((row) => key(row.account, row.assetId)),
      ],
      gaps,
    }
  }
  const members = (scId: ShareClassId) =>
    allRows<WhitelistedInvestorRow>(
      (offset) =>
        root._queryDataOnce<WhitelistedInvestorsPage>('whitelistedInvestors', {
          tokenId: scId.raw,
          limit: PAGE,
          offset,
        }),
      `class ${scId.raw} members`
    )
  const holders = (scId: ShareClassId, centrifugeId: CentrifugeId) =>
    allRows<TokenInstancePositionRow>(
      (offset) =>
        root._queryDataOnce<{ items: TokenInstancePositionRow[]; totalCount: number }>('tokenInstancePositions', {
          tokenId: scId.raw,
          limit: PAGE,
          offset,
          orderBy: 'balance',
          orderDirection: 'desc',
          excludedAddresses: [],
          centrifugeIds: [String(centrifugeId)],
        }),
      `class ${scId.raw} holders on cid ${centrifugeId}`
    )
  let messages: Promise<Awaited<ReturnType<PreCheckCandidates['messages']>>> | null = null
  let spokeSetRead: ReturnType<Pool['migrationSpokeCandidates']> | null = null
  const spokeSet = () => (spokeSetRead ??= pool.migrationSpokeCandidates())
  return {
    async spokes() {
      return activeSpokesOf(await spokeSet())
    },
    async unreadableSpokes() {
      return unreadableSpokesOf(await spokeSet())
    },
    async managers() {
      const rows = await root._queryDataOnce<PoolManagerRow[]>('poolManagers', { poolId: poolId.toString() })
      return rows.map((row) => ({
        address: lower(row.address),
        centrifugeId: Number(row.centrifugeId) as CentrifugeId,
      }))
    },
    async spoke(centrifugeId, scIds) {
      const base = await spokeCandidates(root, poolId, centrifugeId, scIds)
      const rampClasses: { instance: HexString; scId: ShareClassId }[] = []
      for (const scId of scIds) {
        const rows = await root._queryDataOnce<OnOffRampManagerRow[]>('onOffRampManagers', {
          tokenId: scId.raw,
          centrifugeId: String(centrifugeId),
        })
        for (const row of rows) rampClasses.push({ instance: lower(row.address), scId })
      }
      return { ...base, rampClasses }
    },
    async hubInvestors(scIds) {
      const keys: PreCheckInvestorKey[] = []
      const gaps = [
        'investor set: pending, open and closed order rows; a request cancelled before its approval has no row here (investorTransactions is keyed by account on public-api)',
      ]
      for (const scId of scIds) {
        const orders = await orderKeys(scId)
        gaps.push(...orders.gaps)
        for (const row of orders.keys)
          keys.push({ scId, assetId: new AssetId(BigInt(row.assetId)), investor: row.account })
      }
      return { keys, gaps }
    },
    async spokeInvestors(centrifugeId, scIds) {
      const byClass: { scId: ShareClassId; investors: HexString[] }[] = []
      const gaps: string[] = []
      for (const scId of scIds) {
        const found = new Set<HexString>()
        const [orders, memberRows, holderRows] = await Promise.all([
          orderKeys(scId),
          members(scId),
          holders(scId, centrifugeId),
        ])
        gaps.push(...orders.gaps, ...memberRows.gaps, ...holderRows.gaps)
        for (const row of orders.keys) if (row.centrifugeId === centrifugeId) found.add(row.account)
        for (const row of memberRows.items)
          if (Number(row.centrifugeId) === centrifugeId) found.add(lower(row.accountAddress))
        for (const row of holderRows.items) found.add(lower(row.accountAddress))
        byClass.push({ scId, investors: [...found] })
      }
      return { byClass, gaps }
    },
    messages() {
      if (!messages) {
        messages = (async () => {
          const [ofPool, fleet] = await Promise.all([
            allPayloads(root, { poolId, include: { innerMessages: true } }, "the pool's cross-chain payloads"),
            allPayloads(
              root,
              { status: ['Underpaid', 'InTransit', 'Delivered', 'PartiallyFailed'], include: { innerMessages: true } },
              'the fleet-wide unfinished payloads (SetPoolAdapters)'
            ),
          ])
          const toRow = (m: NonNullable<(typeof ofPool.items)[number]['innerMessages']>[number]): PreCheckMessage => ({
            hash: m.id,
            messageType: m.messageType,
            status: m.status,
            fromCentrifugeId: m.fromCentrifugeId,
            toCentrifugeId: m.toCentrifugeId,
            poolId: m.poolId === null ? null : BigInt(m.poolId),
            rawData: m.rawData ?? null,
          })
          const inner = ofPool.items.flatMap((payload) => payload.innerMessages ?? [])
          const executed = inner.filter((m) => m.status === 'Executed')
          const pending = inner.filter((m) => m.status !== 'Executed' && m.status !== 'Cleared').map(toRow)
          const setPoolAdapters = fleet.items
            .flatMap((payload) => payload.innerMessages ?? [])
            .filter((m) => m.messageType === 'SetPoolAdapters' && m.status !== 'Executed' && m.status !== 'Cleared')
            .map(toRow)
          return {
            pool: pending,
            setPoolAdapters,
            gaps: [...ofPool.gaps, ...fleet.gaps],
            executedOnLane: (cid: CentrifugeId) =>
              executed.filter((m) => m.fromCentrifugeId === poolId.centrifugeId && m.toCentrifugeId === cid).length,
          }
        })()
      }
      return messages
    },
    async membership(token, centrifugeId, account) {
      const row = await root._queryDataOnce<WhitelistedInvestorRow | null>('whitelistedInvestor', {
        tokenId: token.scId.raw,
        centrifugeId: String(centrifugeId),
        accountAddress: account.toLowerCase(),
      })
      return row ? { validUntil: validUntilSeconds(row), isFrozen: row.isFrozen } : null
    },
  }
}

function assetCentrifugeId(assetId: string): number {
  return Number(BigInt(assetId) >> 112n)
}

/** @internal */
export function deriveMigrationPreCheck(
  root: Centrifuge,
  pool: Pool,
  options: MigrationPreCheckOptions = {}
): Observable<PreCheckReport> {
  return root
    .protocolContext(pool.id)
    .pipe(
      switchMap((ctx) =>
        isV3_3(ctx)
          ? root
              ._queryData<PoolMigrationRow | null>('poolMigration', { poolId: pool.id.toString() })
              .pipe(
                map((row) =>
                  migratedPreCheckReport(
                    pool.id,
                    row,
                    migrationFacadeOf(pool.centrifugeId, root.config.environment)?.address ?? null
                  )
                )
              )
          : defer(() => preCheckOnV32(root, pool, options))
      )
    )
}

async function preCheckOnV32(root: Centrifuge, pool: Pool, options: MigrationPreCheckOptions): Promise<PreCheckReport> {
  const candidates = candidatesFor(root, pool)
  const cids = options.centrifugeIds ?? [...new Set([pool.centrifugeId, ...(await candidates.spokes())])]
  const sites = new Map<CentrifugeId, PreCheckSite>(
    await Promise.all(cids.map(async (cid) => [cid, await siteFor(root, pool.id, cid, options)] as const))
  )
  return new MigrationPreCheck(pool.id, sites, candidates, options, (cid) => siteFor(root, pool.id, cid, options)).run()
}

/** @internal */
export function deriveMigrationClaimables(
  root: Centrifuge,
  pool: Pool,
  centrifugeId: CentrifugeId
): Observable<MigrationClaimables> {
  return root.protocolContext(pool.id).pipe(
    switchMap((ctx) =>
      isV3_3(ctx)
        ? of<MigrationClaimables>({ centrifugeId, items: [], gaps: [] })
        : defer(async () => {
            const sites = new Map<CentrifugeId, PreCheckSite>()
            for (const cid of new Set([pool.centrifugeId, centrifugeId])) {
              sites.set(cid, await siteFor(root, pool.id, cid, {}))
            }
            return new MigrationPreCheck(pool.id, sites, candidatesFor(root, pool)).claimables(centrifugeId)
          })
    )
  )
}
