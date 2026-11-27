import { ABIS_V3_2, V33_MIGRATION_ABI_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { firstValueFrom, isObservable, of, Subject, throwError, type Observable } from 'rxjs'
import sinon from 'sinon'
import type { PoolMigrationRow } from '@centrifuge/queries/core'
import { Centrifuge } from '../Centrifuge.js'
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeFunctionData,
  zeroAddress,
  type Abi,
} from 'viem'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId, type CentrifugeId } from '../utils/types.js'
import { MigrationInputsDerivation, MigrationInputsReadError, type MigrationInputsReader } from './MigrationInputs.js'
import { spokeCandidates } from './migrationInputsRead.js'
import { deriveMigrationClaimables, deriveMigrationPreCheck } from './migrationPreCheckRead.js'
import { Pool } from './Pool.js'
import {
  differsOnlyInAddresses,
  migratedPreCheckReport,
  MigrationPreCheck,
  PRECHECK_CODES,
  orderVerdicts,
  type PreCheckCandidates,
  type PreCheckReport,
  type PreCheckRow,
  type PreCheckSite,
} from './MigrationPreCheck.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB = 1 as CentrifugeId
const SPOKE = 2 as CentrifugeId
const POOL = PoolId.from(HUB, 7)
const OTHER_POOL = PoolId.from(HUB, 9)
const sc1 = ShareClassId.from(POOL, 1)
const USDC_ID = AssetId.from(SPOKE, 1)
const USDC = addr(0xa1)
const TOKEN = addr(0x70)
const OTHER_TOKEN = addr(0x71)
const ESCROW = addr(0xe5)
const OTHER_ESCROW = addr(0xe6)
const ADMIN = addr(0xad)
const MIGRATION = addr(0x33)
const LAYER_ZERO = addr(0x12)
const CHAINLINK = addr(0x13)
const FULL_RESTRICTIONS = addr(0xf1)
const V33_FULL_RESTRICTIONS = addr(0xf3)

const v32 = {
  spoke: addr(0x32_01),
  gateway: addr(0x32_02),
  holdings: addr(0x32_03),
  hubRegistry: addr(0x32_04),
  balanceSheet: addr(0x32_05),
  syncManager: addr(0x32_06),
  vaultRegistry: addr(0x32_07),
  poolEscrowFactory: addr(0x32_08),
  shareClassManager: addr(0x32_09),
  asyncRequestManager: addr(0x32_0a),
  batchRequestManager: addr(0x32_0b),
}
const v33Refs = {
  asyncRequestManager: addr(0x33_0a),
  syncManager: addr(0x33_06),
  asyncVaultFactory: addr(0x33_0c),
  syncDepositVaultFactory: addr(0x33_0d),
  onOffRampFactory: addr(0x33_0e),
}
const v33 = {
  hubRegistry: addr(0x33_04),
  spokeRegistry: addr(0x33_01),
  accountingToken: addr(0x33_0f),
  onOffRampFactory: v33Refs.onOffRampFactory,
  multiAdapter: addr(0x33_10),
  layerZeroAdapter: LAYER_ZERO,
  chainlinkAdapter: CHAINLINK,
  hooks: [null, V33_FULL_RESTRICTIONS, null, null] as (HexString | null)[],
}

class Revert {
  constructor(readonly errorName: string) {}
}
class Fail {}

type Script = (address: HexString, functionName: string, args: readonly unknown[]) => unknown

type AbiError = Extract<Abi[number], { type: 'error' }>

const KNOWN_ERRORS = Object.values(ABIS_V3_2).flatMap((abi) =>
  (abi as Abi).filter((item): item is AbiError => item.type === 'error')
)

function revertError(errorName: string, abi: Abi, functionName: string) {
  const error = KNOWN_ERRORS.find((item) => item.name === errorName && item.inputs.length === 0)
  if (!error) throw new Error(`no zero-argument error ${errorName} in the v3.2 ABIs`)
  const data = encodeErrorResult({ abi: [error], errorName })
  return new BaseError('reverted', { cause: new ContractFunctionRevertedError({ abi, data, functionName }) })
}

const same = (a: HexString, b: HexString) => a.toLowerCase() === b.toLowerCase()
const eqId = (a: unknown, b: bigint) => BigInt(a as bigint) === b

type World = {
  hubPhase: number
  spokePhase: Record<string, number>
  armed: CentrifugeId[]
  operator: HexString
  poolActive: Record<number, boolean>
  record: CentrifugeId[]
  admins: HexString[]
  v33Reserved: { exists: boolean; manager: boolean }
  laneSession: Record<number, number>
  globalAdapters: Record<number, HexString[]>
  pointer: HexString
  escrowBalance: bigint
  ledger: [bigint, bigint]
  rotated: boolean
  hookOf: Record<string, HexString>
  hookMap: Record<string, HexString>
  codes: Record<string, HexString>
  hookData: Record<string, HexString>
  otherPools: PoolId[]
  ramps: HexString[]
  v33Asset: Record<string, [HexString, bigint] | Revert>
  vaults: HexString[]
  probeFails: boolean
  investments: Record<string, bigint[]>
  claimable: Record<string, [bigint, bigint]>
  noDecimals: boolean
  hubOrder: { deposit: bigint; redeem: bigint; claims: number }
}

function world(over: Partial<World> = {}): World {
  return {
    hubPhase: 0,
    spokePhase: {},
    armed: [],
    operator: zeroAddress,
    poolActive: { [SPOKE]: true },
    record: [SPOKE],
    admins: [ADMIN],
    v33Reserved: { exists: true, manager: true },
    laneSession: {},
    globalAdapters: { [HUB]: [LAYER_ZERO], [SPOKE]: [LAYER_ZERO] },
    pointer: v32.asyncRequestManager,
    escrowBalance: 0n,
    ledger: [0n, 0n],
    rotated: false,
    hookOf: {},
    hookMap: {},
    codes: {},
    hookData: {},
    otherPools: [],
    ramps: [],
    v33Asset: { [USDC_ID.raw.toString()]: [USDC, 0n] },
    vaults: [],
    probeFails: false,
    investments: {},
    claimable: {},
    noDecimals: false,
    hubOrder: { deposit: 0n, redeem: 0n, claims: 0 },
    ...over,
  }
}

function scriptFor(w: World, cid: CentrifugeId): Script {
  return (address, fn, args) => {
    switch (fn) {
      // facade
      case 'hubPhase':
        return w.hubPhase
      case 'spokePhase':
        return w.spokePhase[`${cid}:${args[0]}`] ?? 0
      case 'armedSpokes':
        return w.armed
      case 'operator':
        return w.operator
      case 'hookMap':
        return w.hookMap[(args[0] as string).toLowerCase()] ?? zeroAddress
      case 'assetRotated':
        return w.rotated
      case 'vaultConfigured':
        return false
      case 'unlinkedVaults':
      case 'rotatedAssets':
      case 'removedManagers':
        return 0
      case 'removedHubAdmins':
        return []
      // v3.2 hub
      case 'exists':
        if (same(address, v33.hubRegistry)) return w.v33Reserved.exists
        return true
      case 'manager':
        if (same(address, v33.hubRegistry)) return w.v33Reserved.manager
        if (same(address, v32.hubRegistry)) return w.admins.some((admin) => same(admin, args[1] as HexString))
        if (same(address, v32.balanceSheet)) return w.ramps.some((ramp) => same(ramp, args[1] as HexString))
        return false
      case 'currency':
        return 840n
      case 'shareClassCount':
        return 1
      case 'hubRequestManager':
        return w.record.includes(Number(args[1]) as CentrifugeId) ? addr(0x99) : zeroAddress
      case 'isRegistered':
        return eqId(args[0], USDC_ID.raw)
      case 'epochId':
        return [0, 0, 0, 0]
      case 'pendingDeposit':
      case 'pendingRedeem':
        return 0n
      case 'holding':
        if (same(address, v32.holdings)) return [0n, 0n, zeroAddress, false]
        return w.ledger
      case 'hubRegistry':
        return new Fail()
      case 'hub':
        return new Fail()
      // lanes
      case 'activeSessionId': {
        const toCid = Number(args[0])
        if (eqId(args[1], 0n)) return 1
        return w.laneSession[`${cid}->${toCid}` as unknown as number] ?? 0
      }
      case 'quorum':
        return (w.globalAdapters[cid] ?? []).length
      case 'adapters':
        return (w.globalAdapters[cid] ?? [])[Number(args[3])] ?? zeroAddress
      case 'estimate':
        return 1n
      // spoke
      case 'isPoolActive': {
        const pool = BigInt(args[0] as bigint)
        if (pool === POOL.raw) return w.poolActive[cid] ?? false
        if (w.probeFails) return new Fail()
        return w.otherPools.some((other) => other.raw === pool)
      }
      case 'requestManager':
        return w.pointer
      case 'shareToken': {
        const pool = BigInt(args[0] as bigint)
        const scId = (args[1] as string).toLowerCase()
        if (pool === POOL.raw) return scId === sc1.raw.toLowerCase() ? TOKEN : new Revert('ShareTokenDoesNotExist')
        if (pool === OTHER_POOL.raw && scId === ShareClassId.from(OTHER_POOL, 1).raw.toLowerCase()) return OTHER_TOKEN
        return new Revert('ShareTokenDoesNotExist')
      }
      case 'totalSupply':
        return 1000n
      case 'hook':
        return w.hookOf[address.toLowerCase()] ?? zeroAddress
      case 'hookDataOf':
        return w.hookData[`${address.toLowerCase()}:${(args[0] as string).toLowerCase()}`] ?? `0x${'0'.repeat(32)}`
      case 'checkERC20Transfer': {
        const to = (args[1] as string).toLowerCase()
        if (to === '0x000000000000000000000000000000000001cf60') return false
        if (to === zeroAddress) return true
        return false
      }
      case 'poolEscrow':
        return zeroAddress
      case 'vault':
        if (same(address, v32.vaultRegistry)) return zeroAddress
        return new Fail()
      case 'vaultDetails':
        return w.vaults.some((vault) => same(vault, args[0] as HexString))
          ? { assetId: USDC_ID.raw, asset: USDC, tokenId: 0n, isLinked: true }
          : new Revert('UnknownVault')
      case 'poolId':
        if (w.vaults.some((vault) => same(vault, address))) return POOL.raw
        if (w.ramps.some((ramp) => same(ramp, address))) return POOL.raw
        return new Fail()
      case 'scId':
        if (w.vaults.some((vault) => same(vault, address)) || w.ramps.some((ramp) => same(ramp, address)))
          return sc1.raw
        return new Fail()
      case 'syncDepositManager':
        return new Fail()
      case 'balanceSheet':
        return w.ramps.some((ramp) => same(ramp, address)) ? v32.balanceSheet : new Fail()
      case 'relayer':
        return w.ramps.some((ramp) => same(ramp, address)) ? false : new Fail()
      case 'onramp':
      case 'offramp':
        return false
      case 'wards':
        return 1n
      case 'idToAsset': {
        const id = BigInt(args[0] as bigint).toString()
        if (same(address, v33.spokeRegistry)) {
          const answer = w.v33Asset[id]
          return answer ?? new Revert('UnknownAsset')
        }
        return id === USDC_ID.raw.toString() ? [USDC, 0n] : new Revert('UnknownAsset')
      }
      case 'assetToId':
        return 0n
      case 'toTokenId':
        return 1n
      case 'previewManager':
        return addr(0x77)
      case 'escrow': {
        const pool = BigInt(args[0] as bigint)
        return pool === POOL.raw ? ESCROW : OTHER_ESCROW
      }
      case 'balanceOf':
        return same(address, USDC) && same(args[0] as HexString, ESCROW) ? w.escrowBalance : 0n
      case 'decimals':
        if (w.noDecimals) return new Fail()
        if (same(address, v32.hubRegistry)) return eqId(args[0], POOL.raw) ? 18 : 6
        return same(address, TOKEN) ? 18 : 6
      case 'depositRequest':
        return [w.hubOrder.deposit, 0]
      case 'redeemRequest':
        return [w.hubOrder.redeem, 0]
      case 'queuedDepositRequest':
      case 'queuedRedeemRequest':
        return [false, 0n]
      case 'maxDepositClaims':
        return w.hubOrder.claims
      case 'maxRedeemClaims':
        return 0
      case 'shareTokenDetails':
        if (same(address, v32.spoke) && same(args[0] as HexString, OTHER_TOKEN))
          return [OTHER_POOL.raw, ShareClassId.from(OTHER_POOL, 1).raw]
        return new Fail()
      case 'valuation':
        return zeroAddress
      case 'maxReserve':
        return 0n
      case 'markersPricePoolPerAsset':
        return [0n, 0n, 0n]
      case 'investments': {
        const state = w.investments[(args[1] as string).toLowerCase()]
        return state ?? new Fail()
      }
      case 'maxMint':
      case 'maxWithdraw': {
        const who = (args[1] as string).toLowerCase()
        if (!w.investments[who]) return new Fail()
        return w.claimable[who]?.[fn === 'maxMint' ? 0 : 1] ?? 0n
      }
      case 'isLinked':
        return false
      default:
        return new Fail()
    }
  }
}

function reader(w: World, cid: CentrifugeId): MigrationInputsReader & { calls: string[] } {
  const script = scriptFor(w, cid)
  const calls: string[] = []
  return {
    block: 100n,
    calls,
    async read(requested) {
      return requested.map((call) => {
        calls.push(call.functionName)
        encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] })
        const value = script(call.address, call.functionName, call.args ?? [])
        if (value instanceof Revert)
          return { status: 'failure', error: revertError(value.errorName, call.abi, call.functionName) }
        if (value instanceof Fail) return { status: 'failure', error: new Error('failed') }
        return { status: 'success', result: value }
      })
    },
    async logs() {
      return []
    },
    async hasCode(address) {
      return (w.codes[address.toLowerCase()] ?? '0x') !== '0x'
    },
    async code(address) {
      return w.codes[address.toLowerCase()] ?? ('0x' as HexString)
    },
  }
}

function site(w: World, cid: CentrifugeId, withMigration = true): PreCheckSite {
  const r = reader(w, cid)
  return {
    centrifugeId: cid,
    reader: r,
    inputs: new MigrationInputsDerivation(r, v32, v33Refs, ABIS_V3_2 as any, cid, {}),
    v32: {
      ...v32,
      hub: addr(0x32_00),
      hooks: [null, FULL_RESTRICTIONS, null, null],
      identityValuation: null,
      oracleValuation: null,
      accountingToken: null,
    },
    v33,
    migration: withMigration ? { address: MIGRATION, abi: V33_MIGRATION_ABI_V3_3 as unknown as Abi } : null,
  }
}

function candidates(over: Partial<PreCheckCandidates> = {}): PreCheckCandidates {
  return {
    spokes: async () => [SPOKE],
    unreadableSpokes: async () => [],
    managers: async () => [{ address: ADMIN, centrifugeId: HUB }],
    spoke: async () => ({
      managers: [],
      vaults: [],
      rampInstances: [],
      ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
      rampClasses: [],
    }),
    hubInvestors: async () => ({ keys: [], gaps: [] }),
    spokeInvestors: async () => ({ byClass: [], gaps: [] }),
    messages: async () => ({ pool: [], setPoolAdapters: [], gaps: [], executedOnLane: () => 1 }),
    membership: async () => null,
    ...over,
  }
}

async function run(w: World, over: Partial<PreCheckCandidates> = {}, options = {}): Promise<PreCheckReport> {
  const sites = new Map<CentrifugeId, PreCheckSite>([
    [HUB, site(w, HUB)],
    [SPOKE, site(w, SPOKE)],
  ])
  return new MigrationPreCheck(POOL, sites, candidates(over), {
    poolProbe: { cidMax: 1, counterMax: 10, classMax: 2 },
    ...options,
  }).run()
}

const stops = (report: PreCheckReport) => report.rows.filter((row) => row.severity === 'stop')
const inSection = (rows: readonly PreCheckRow[], section: string) => rows.filter((row) => row.section === section)

describe('orderVerdicts', () => {
  it('blocks a desynced pair before the offboard and carries it after', () => {
    const before = orderVerdicts(0n, 0n, { deposit: 3, issue: 2, redeem: 1, revoke: 1 }, SPOKE, false, 'unseen')
    expect(before).to.have.length(1)
    expect(before[0]!.blocking).to.equal(true)
    expect(before[0]!.consequence).to.match(/EpochsNotSynced at relayOffboard toward centrifugeId 2/)
    const after = orderVerdicts(0n, 0n, { deposit: 3, issue: 2, redeem: 1, revoke: 1 }, SPOKE, true, 'unseen')
    expect(after[0]!.blocking).to.equal(false)
    expect(after[0]!.consequence).to.match(/zero-amount issueShares/)
  })

  it('names the settle helper only while the window is open', () => {
    const open = orderVerdicts(5n, 0n, { deposit: 0, issue: 0, redeem: 0, revoke: 0 }, HUB, false, 'open')
    expect(open[0]!.consequence).to.match(/settleDeposit\(\.\.\), hub manager$/)
    const closed = orderVerdicts(5n, 0n, { deposit: 0, issue: 0, redeem: 0, revoke: 0 }, HUB, false, 'closed')
    expect(closed[0]!.consequence).to.match(/VaultNotLinked/)
    const unseen = orderVerdicts(0n, 5n, { deposit: 0, issue: 0, redeem: 0, revoke: 0 }, SPOKE, false, 'unseen')
    expect(unseen[0]!.row).to.equal('pendingRedeem = 5')
    expect(unseen[0]!.consequence).to.match(/gates on StepRelayed/)
  })
})

describe('pre-check codes', () => {
  it('lists every code once, each under a section', () => {
    expect(new Set(PRECHECK_CODES).size).to.equal(PRECHECK_CODES.length)
    for (const code of PRECHECK_CODES) expect(code).to.match(/^[a-z0-9]+(\.[a-zA-Z0-9]+)+$/)
  })

  it('codes each order verdict by kind, so a desync before and after the offboard read apart', () => {
    const epochs = { deposit: 3, issue: 2, redeem: 4, revoke: 1 }
    const codes = (past: boolean) => orderVerdicts(5n, 6n, epochs, SPOKE, past, 'unseen').map((verdict) => verdict.code)
    expect(codes(false)).to.deep.equal([
      'hub.orders.depositNotIssued',
      'hub.orders.redeemNotRevoked',
      'hub.orders.pendingDeposit',
      'hub.orders.pendingRedeem',
    ])
    expect(codes(true).slice(0, 2)).to.deep.equal(['hub.orders.depositEpochsCarried', 'hub.orders.redeemEpochsCarried'])
  })

  it('codes the note of a pool already on v3.3', () => {
    const report = migratedPreCheckReport(POOL, null, null)
    expect(report.notes.map((note) => note.code)).to.deep.equal(['migration.onV33'])
  })
})

describe('differsOnlyInAddresses', () => {
  const push32 = (address: HexString) => `7f${'00'.repeat(12)}${address.slice(2)}`
  it('accepts one immutable address swapped and refuses any other byte', () => {
    const book = `0x6080${push32(addr(0xaa))}5050${push32(addr(0xaa))}00` as HexString
    const twin = `0x6080${push32(addr(0xbb))}5050${push32(addr(0xbb))}00` as HexString
    const mixed = `0x6080${push32(addr(0xbb))}5050${push32(addr(0xcc))}00` as HexString
    const other = `0x6081${push32(addr(0xaa))}5050${push32(addr(0xaa))}00` as HexString
    expect(differsOnlyInAddresses(twin, book)).to.equal(true)
    expect(differsOnlyInAddresses(mixed, book)).to.equal(false)
    expect(differsOnlyInAddresses(other, book)).to.equal(false)
    expect(differsOnlyInAddresses(`0x00`, book)).to.equal(false)
  })
})

describe('MigrationPreCheck', () => {
  it('names an unreadable chain and a lost hub record as stops on the arm instead of dropping them', async () => {
    const report = await run(world(), {
      unreadableSpokes: async () => [
        { centrifugeId: 3 as CentrifugeId, reason: 'the activity read timed out after 5000 ms' },
        { centrifugeId: null, reason: "the v3.2 hub's spoke record could not be read: rpc down" },
      ],
    })
    const rows = inSection(stops(report), 'hub.spokes')
    expect(rows.map((row) => [row.step, row.centrifugeId, row.source])).to.deep.equal([
      ['arm', 3, 'chain'],
      ['arm', HUB, 'record'],
    ])
    expect(rows[0]!.message).to.contain('timed out').and.contain('holds the arm and stops onboardHub')
    expect(rows[1]!.message).to.contain('rpc down')
  })

  it('reports in the same order whichever chain answers first, since the hub and spoke reports run side by side', async () => {
    const slowed = (w: World, slow: CentrifugeId, reads: { cid: CentrifugeId; start: number; end: number }[]) => {
      const sites = new Map<CentrifugeId, PreCheckSite>()
      for (const cid of [HUB, SPOKE]) {
        const base = site(w, cid)
        const read = base.reader.read.bind(base.reader)
        base.reader.read = async (calls) => {
          const start = performance.now()
          if (cid === slow) await new Promise((resolve) => setTimeout(resolve, 2))
          const result = await read(calls)
          reads.push({ cid, start, end: performance.now() })
          return result
        }
        sites.set(cid, base)
      }
      return new MigrationPreCheck(POOL, sites, candidates(), {
        poolProbe: { cidMax: 1, counterMax: 10, classMax: 2 },
      }).run()
    }
    const hubFirst: { cid: CentrifugeId; start: number; end: number }[] = []
    const spokeFirst: typeof hubFirst = []
    const [slowSpoke, slowHub] = await Promise.all([slowed(world(), SPOKE, hubFirst), slowed(world(), HUB, spokeFirst)])
    const order = (report: PreCheckReport) => report.rows.map((row) => [row.section, row.centrifugeId, row.subject])
    expect(order(slowHub)).to.deep.equal(order(slowSpoke))
    expect(slowHub.notes).to.deep.equal(slowSpoke.notes)
    const hubReads = spokeFirst.filter((read) => read.cid === HUB)
    const duringHubRead = spokeFirst.filter(
      (read) => read.cid === SPOKE && hubReads.some((hub) => read.start > hub.start && read.start < hub.end)
    )
    expect(duringHubRead).to.not.be.empty
  })

  it('turns a spoke read that throws into a stop on the arm naming it, and still reports the hub', async () => {
    const report = await run(world(), {
      spoke: async () => {
        throw new TypeError('o.map is not a function or its return value is not iterable')
      },
    })
    const rows = inSection(stops(report), 'spoke.report')
    expect(rows.map((row) => [row.step, row.centrifugeId, row.blocking])).to.deep.equal([['arm', SPOKE, true]])
    expect(rows[0]!.message).to.contain('TypeError: o.map is not a function')
    expect(report.rows.some((row) => row.centrifugeId === HUB && row.section !== 'spoke.report')).to.equal(true)
    expect(report.chains.map((chain) => chain.centrifugeId)).to.deep.equal([HUB, SPOKE])
  })

  it('refuses an indexer answer that is not a list by the read that gave it', async () => {
    const root = {
      _queryData: (name: string) => of(name === 'allVaults' ? { items: [] } : []),
    } as unknown as Centrifuge
    const read = spokeCandidates(root, POOL, SPOKE, [ShareClassId.from(POOL, 1)])
    const error = await read.catch((e: unknown) => e)
    expect(error).to.be.instanceOf(MigrationInputsReadError)
    expect((error as Error).message).to.equal(
      '[GAP] spokeCandidates: allVaults: the indexer answered something other than a list'
    )
    const clean = { _queryData: () => of([]) } as unknown as Centrifuge
    expect((await spokeCandidates(clean, POOL, SPOKE, [ShareClassId.from(POOL, 1)])).vaults).to.deep.equal([])
  })

  it('names the indexer read whose answer is not a list', async () => {
    const report = await run(world(), {
      spoke: async () => {
        throw new MigrationInputsReadError(
          'spokeCandidates: allVaults',
          'the indexer answered something other than a list'
        )
      },
    })
    expect(inSection(stops(report), 'spoke.report')[0]!.message).to.contain('spokeCandidates: allVaults')
  })

  it('reports both chains, their roles and the counts, with nothing blocking on a clean pool', async () => {
    const report = await run(world())
    expect(report.chains).to.deep.equal([
      { centrifugeId: HUB, block: 100n, roles: ['hub'] },
      { centrifugeId: SPOKE, block: 100n, roles: ['spoke'] },
    ])
    expect(stops(report)).to.deep.equal([])
    expect(report.blockingRows).to.deep.equal([])
    expect(report.counts.stop).to.equal(0)
    expect(report.hubPhase).to.equal(0)
    expect(report.rows.every((row) => row.blocking === (row.severity === 'stop'))).to.equal(true)
  })

  it('stops on a request-manager pointer that is neither the ARM nor zero, and knows a frozen one', async () => {
    const stopped = await run(world({ pointer: addr(0x55) }))
    expect(inSection(stops(stopped), 'spoke.pointer')[0]!.message).to.match(/PointerNotArm/)
    const frozen = await run(world({ pointer: MIGRATION }))
    const row = inSection(frozen.rows, 'spoke.pointer')[0]!
    expect(row.severity).to.equal('info')
    expect(row.knownSettled).to.equal(true)
    const vaultless = await run(world({ pointer: zeroAddress }))
    expect(inSection(vaultless.rows, 'spoke.pointer')[0]!.message).to.match(/AS36/)
  })

  it('stops before initiateMigration when the v3.3 registry has no reservation, and skips the read once armed', async () => {
    const unreserved = await run(world({ v33Reserved: { exists: true, manager: false } }))
    const row = inSection(stops(unreserved), 'hub.reservation')[0]!
    expect(row.message).to.match(/PoolNotReserved/)
    expect(row.step).to.equal('arm')
    const armed = await run(world({ hubPhase: 1, v33Reserved: { exists: false, manager: false }, operator: ADMIN }))
    expect(inSection(armed.rows, 'hub.reservation')).to.deep.equal([])
  })

  it('stops the hub onboard when the v3.2 hub names a spoke nothing can arm', async () => {
    const report = await run(world({ poolActive: { [SPOKE]: false } }))
    const row = inSection(stops(report), 'hub.spokes')[0]!
    expect(row.step).to.equal('onboardHub')
    expect(row.message).to.match(/NoArmedSpokes.*SpokeNotArmed\(2\)/)
  })

  it('holds the hub onboard on a live spoke missing from the arming record (AS43) while Armed', async () => {
    const report = await run(world({ hubPhase: 1, operator: ADMIN }))
    const row = inSection(report.rows, 'hub.armingRecord')[0]!
    expect(row.severity).to.equal('warn')
    expect(row.blocking).to.equal(true)
    expect(row.step).to.equal('onboardHub')
    expect(report.blockingRows).to.include(row)
    const past = await run(world({ hubPhase: 2, operator: ADMIN }))
    expect(inSection(past.rows, 'hub.armingRecord')[0]!.blocking).to.equal(false)
    const recorded = await run(world({ hubPhase: 1, operator: ADMIN, armed: [SPOKE] }))
    expect(inSection(recorded.rows, 'hub.armingRecord')).to.deep.equal([])
  })

  describe('a spoke only the v3.2 hub record names', () => {
    const OTHER = 3 as CentrifugeId
    const runWith = (w: World, openSite?: (cid: CentrifugeId) => Promise<PreCheckSite>) =>
      new MigrationPreCheck(
        POOL,
        new Map<CentrifugeId, PreCheckSite>([
          [HUB, site(w, HUB)],
          [SPOKE, site(w, SPOKE)],
        ]),
        candidates(),
        { poolProbe: { cidMax: 1, counterMax: 10, classMax: 2 } },
        openSite
      ).run()
    const recordOnly = (over: Partial<World>) =>
      world({ hubPhase: 1, operator: ADMIN, armed: [SPOKE], record: [SPOKE, OTHER], ...over })
    const rowFor = (report: PreCheckReport) =>
      inSection(report.rows, 'hub.armingRecord').find((row) => row.centrifugeId === OTHER)

    it('is read, so a leftover record whose v3.2 pool is not live holds nothing', async () => {
      const w = recordOnly({ poolActive: { [SPOKE]: true, [OTHER]: false } })
      const report = await runWith(w, async (cid) => site(w, cid))
      expect(rowFor(report)).to.equal(undefined)
      expect(report.blockingRows).to.deep.equal([])
    })

    it('still holds the hub onboard when its v3.2 pool is live, naming the chain', async () => {
      const w = recordOnly({ poolActive: { [SPOKE]: true, [OTHER]: true } })
      const row = rowFor(await runWith(w, async (cid) => site(w, cid)))!
      expect(row.blocking).to.equal(true)
      expect(row.subject).to.match(/spoke cid 3 \(named by hub record\) active on its v3.2 Spoke/)
    })

    it('says why it was not read when it cannot be opened, and holds the onboard on it', async () => {
      const w = recordOnly({ poolActive: { [SPOKE]: true } })
      const failed = rowFor(await runWith(w, async () => Promise.reject(new Error('rpc down'))))!
      expect(failed.blocking).to.equal(true)
      expect(failed.subject).to.match(/not read: rpc down/)
      const outside = rowFor(await runWith(w))!
      expect(outside.subject).to.match(/not read: its chain is outside this run/)
    })
  })

  it('reads both lane halves and stops when their kinds disagree', async () => {
    const agree = await run(world())
    const laneRows = inSection(agree.rows, 'lanes')
    expect(laneRows.filter((row) => row.severity === 'stop')).to.deep.equal([])
    expect(laneRows.some((row) => row.severity === 'warn' && /LayerZero-only/.test(row.message))).to.equal(true)
    const disagree = await run(world({ globalAdapters: { [HUB]: [LAYER_ZERO], [SPOKE]: [CHAINLINK] } }))
    expect(inSection(stops(disagree), 'lanes').map((row) => row.message)).to.include(
      "the two halves disagree by kind: a message one side sends cannot meet the other side's threshold"
    )
    const empty = await run(world({ globalAdapters: { [HUB]: [], [SPOKE]: [LAYER_ZERO] } }))
    expect(inSection(stops(empty), 'lanes')[0]!.message).to.match(/NoPoolAdapters/)
  })

  it('stops when no live v3.2 hub admin is left and when the pinned operator lost the role', async () => {
    const nobody = await run(world({ admins: [] }))
    expect(inSection(stops(nobody), 'hub.admins')[0]!.message).to.match(/NotV32HubManager/)
    const onboarded = await run(world({ admins: [], hubPhase: 2 }))
    expect(inSection(stops(onboarded), 'hub.admins')).to.deep.equal([])
    expect(inSection(onboarded.rows, 'hub.admins')[0]!.knownSettled).to.equal(true)
    const lost = await run(world({ hubPhase: 1, operator: addr(0xbe), armed: [SPOKE] }))
    expect(inSection(stops(lost), 'hub.operator')[0]!.message).to.match(/NotV32HubManager/)
    const unnamed = await run(
      world({ hubPhase: 1, operator: addr(0xbe), admins: [ADMIN, addr(0xbe)], armed: [SPOKE] }),
      {
        managers: async () => [{ address: ADMIN, centrifugeId: HUB }],
      }
    )
    expect(inSection(stops(unnamed), 'hub.operator')[0]!.message).to.match(/AdminsMissingOperator/)
  })

  it('stops a rotation the escrow cannot back and reads the same figures as a footprint once rotated', async () => {
    const short = await run(world({ escrowBalance: 5n, ledger: [10n, 3n] }))
    const rows = inSection(short.rows, 'spoke.escrow')
    expect(rows.find((row) => row.severity === 'stop')!.message).to.match(/BalanceBelowRecordedTotals/)
    const reserved = rows.find((row) => /reserved = 3/.test(row.subject))!
    expect(reserved.severity).to.equal('warn')
    expect(reserved.amount).to.deep.include({ raw: 3n, decimals: 6, asset: USDC })
    const rotated = await run(world({ escrowBalance: 5n, ledger: [10n, 3n], rotated: true }))
    const after = inSection(rotated.rows, 'spoke.escrow')
    expect(after.filter((row) => row.severity === 'stop')).to.deep.equal([])
    expect(after.every((row) => row.knownSettled)).to.equal(true)
    const unread = await run(world({ escrowBalance: 5n, ledger: [10n, 3n], noDecimals: true }))
    const unsized = inSection(unread.rows, 'spoke.escrow').find((row) => /reserved = 3/.test(row.subject))!
    expect(unsized.subject).to.match(/decimals unread/)
    expect(unsized.amount!.decimals).to.equal(null)
    expect(unsized.amount!.inPoolCurrency).to.equal(undefined)
    const surplus = await run(world({ escrowBalance: 12n, ledger: [10n, 0n] }))
    expect(inSection(surplus.rows, 'spoke.escrow')[0]!.message).to.match(/recordedSurplus/)
  })

  it("reads another pool's empty share class slot as absent, so the foreign-token probe finishes instead of stopping the spoke", async () => {
    const report = await run(world({ otherPools: [OTHER_POOL] }))
    expect(report.rows.filter((row) => row.code === 'spoke.report.stopped')).to.deep.equal([])
    const probe = report.notes.find((note) => note.code === 'spoke.foreignShareTokens.probeSource')!
    expect(probe.text).to.match(/\(1 other pools' tokens\)/)
  })

  it("holds the arm on another pool's live membership under a mapped FullRestrictions hook (AS38)", async () => {
    const future = ((BigInt(Math.floor(Date.now() / 1000)) + 100_000n) << 64n).toString(16).padStart(32, '0')
    const w = world({
      otherPools: [OTHER_POOL],
      hookOf: { [OTHER_TOKEN.toLowerCase()]: FULL_RESTRICTIONS },
      hookMap: { [FULL_RESTRICTIONS.toLowerCase()]: V33_FULL_RESTRICTIONS },
      codes: { [FULL_RESTRICTIONS.toLowerCase()]: '0x6080' as HexString },
      hookData: { [`${OTHER_TOKEN.toLowerCase()}:${ESCROW.toLowerCase()}`]: `0x${future}` as HexString },
    })
    const report = await run(w)
    const row = inSection(report.rows, 'spoke.foreignShareTokens').find((r) => r.severity === 'warn')!
    expect(row.blocking).to.equal(true)
    expect(row.step).to.equal('arm')
    expect(row.message).to.match(/migrate pool 281474976710665 first/)
    expect(report.blockingRows).to.include(row)
    const migrated = await run({ ...w, spokePhase: { [`${SPOKE}:${OTHER_POOL.raw}`]: 4 } })
    expect(inSection(migrated.rows, 'spoke.foreignShareTokens').find((r) => r.severity === 'warn')!.message).to.match(
      /spoke Onboarded/
    )
    const expired = await run({
      ...w,
      hookData: {
        [`${OTHER_TOKEN.toLowerCase()}:${ESCROW.toLowerCase()}`]:
          `0x${(1n << 64n).toString(16).padStart(32, '0')}` as HexString,
      },
    })
    const info = inSection(expired.rows, 'spoke.foreignShareTokens').find((r) => /expired entry/.test(r.message))!
    expect(info.severity).to.equal('info')
    expect(info.knownSettled).to.equal(true)
  })

  it('stops two BS-granted v3.2 ramp instances of one class before arming', async () => {
    const ramps = [addr(0xc1), addr(0xc2)]
    const report = await run(world({ ramps }), {
      spoke: async () => ({
        managers: ramps,
        vaults: [],
        rampInstances: ramps,
        ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
        rampClasses: ramps.map((instance) => ({ instance, scId: sc1 })),
      }),
    })
    const row = inSection(stops(report), 'spoke.ramps').find((r) => /RampAlreadySetup/.test(r.message))!
    expect(row.step).to.equal('arm')
    expect(row.subject).to.match(/sc1 ramps/)
  })

  it('stops a vault-carried asset id that names another asset on v3.3 and warns a rotation-only one', async () => {
    const vault = addr(0xd1)
    const diverged = await run(world({ vaults: [vault], v33Asset: { [USDC_ID.raw.toString()]: [addr(0xa9), 0n] } }), {
      spoke: async () => ({
        managers: [],
        vaults: [vault],
        rampInstances: [],
        ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
        rampClasses: [],
      }),
    })
    const stop = inSection(stops(diverged), 'spoke.assetIds')[0]!
    expect(stop.message).to.match(/AssetIdDiverged at RegisterVaults/)
    const rotationOnly = await run(
      world({ escrowBalance: 7n, v33Asset: { [USDC_ID.raw.toString()]: [addr(0xa9), 0n] } })
    )
    const warn = inSection(rotationOnly.rows, 'spoke.assetIds')[0]!
    expect(warn.severity).to.equal('warn')
    expect(warn.message).to.match(/carried only by the rotation/)
    const agree = await run(world({ escrowBalance: 7n }))
    expect(inSection(agree.rows, 'spoke.assetIds')).to.deep.equal([])
  })

  it('warns on every non-executed message of the pool and keeps the AS39 parked transfers as known', async () => {
    const report = await run(world(), {
      messages: async () => ({
        pool: [
          {
            hash: '0x9823a1900cbe0f27856f90eb5e4d3d791e77fbb61c59ef717bd5d855e360f3b8',
            messageType: 'InitiateTransferShares',
            status: 'Failed',
            fromCentrifugeId: 1 as CentrifugeId,
            toCentrifugeId: 4 as CentrifugeId,
            poolId: 281474976710662n,
            rawData: null,
          },
          {
            hash: addr(1),
            messageType: 'FulfilledDepositRequest',
            status: 'Failed',
            fromCentrifugeId: HUB,
            toCentrifugeId: SPOKE,
            poolId: POOL.raw,
            rawData: null,
          },
          {
            hash: addr(2),
            messageType: 'NotifyPricePoolPerShare',
            status: 'Failed',
            fromCentrifugeId: HUB,
            toCentrifugeId: SPOKE,
            poolId: POOL.raw,
            rawData: null,
          },
        ],
        setPoolAdapters: [
          {
            hash: addr(3),
            messageType: 'SetPoolAdapters',
            status: 'Failed',
            fromCentrifugeId: HUB,
            toCentrifugeId: SPOKE,
            poolId: null,
            rawData: `0x05${POOL.raw.toString(16).padStart(16, '0')}00` as HexString,
          },
        ],
        gaps: [],
        executedOnLane: () => 0,
      }),
    })
    const quiet = inSection(report.rows, 'gateway.quiet')
    expect(quiet.find((row) => /SetPoolAdapters/.test(row.subject))!.severity).to.equal('warn')
    expect(quiet.find((row) => /InitiateTransferShares/.test(row.subject))!.severity).to.equal('warn')
    const lane = inSection(report.rows, 'gateway.hubToSpoke')
    expect(lane.find((row) => /FulfilledDepositRequest/.test(row.subject))!.message).to.match(/VaultNotLinked/)
    expect(lane.some((row) => /NotifyPricePoolPerShare/.test(row.subject))).to.equal(false)
    expect(lane.find((row) => row.severity === 'gap')!.message).to.match(/not a measurement/)
  })

  it('fails loud when the foreign pool probe does not answer instead of reading the pools as inactive', async () => {
    const rows = inSection(stops(await run(world({ probeFails: true }))), 'spoke.report')
    expect(rows.map((row) => [row.step, row.centrifugeId, row.blocking])).to.deep.equal([['arm', SPOKE, true]])
    expect(rows[0]!.message).to.match(/foreign pools: v3\.2 Spoke\.isPoolActive/)
  })

  it('pairs each investor with the vaults of its own class and sizes nothing it cannot read', async () => {
    const vault = addr(0xd1)
    const investor = addr(0x1a)
    const other = addr(0x1b)
    const sc2 = ShareClassId.from(POOL, 2)
    const w = world({ vaults: [vault], investments: { [investor]: [5n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] } })
    const report = await run(w, {
      spoke: async () => ({
        managers: [],
        vaults: [vault],
        rampInstances: [],
        ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
        rampClasses: [],
      }),
      spokeInvestors: async () => ({
        byClass: [
          { scId: sc1, investors: [investor] },
          { scId: sc2, investors: [other] },
        ],
        gaps: ['class members: 1000 of 1200 rows read; the rest are not checked'],
      }),
    })
    const claims = inSection(report.rows, 'spoke.claimables')
    expect(claims.find((row) => row.severity === 'warn')!.subject).to.match(/investor 0x0+1a maxMint = 5/)
    expect(claims.some((row) => /0x0+1b/.test(row.subject))).to.equal(false)
    expect(claims.find((row) => row.severity === 'gap' && /1000 of 1200/.test(row.message))).to.not.equal(undefined)
    expect(report.notes.find((note) => /keys re-read on the v3.2 ARM/.test(note.text))!.text).to.match(
      /^1 \(vault, investor\)/
    )
  })

  describe('codes', () => {
    const vault = addr(0xd1)
    const investor = addr(0x1a)
    const claimableWorld = () =>
      world({ vaults: [vault], investments: { [investor]: [5n, 7n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] } })
    const claimableCandidates = {
      spoke: async () => ({
        managers: [],
        vaults: [vault],
        rampInstances: [],
        ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
        rampClasses: [],
      }),
      spokeInvestors: async () => ({ byClass: [{ scId: sc1, investors: [investor] }], gaps: [] }),
    }

    it('gives every row and note a listed code under its own section, one section per code', async () => {
      const reports = await Promise.all([
        run(world()),
        run(claimableWorld(), claimableCandidates),
        run(world({ escrowBalance: 5n, ledger: [3n, 1n] })),
        run(world(), {
          unreadableSpokes: async () => [{ centrifugeId: 3 as CentrifugeId, reason: 'timed out' }],
        }),
      ])
      const sectionOf = new Map<string, string>()
      const items = reports.flatMap((report) => [...report.rows, ...report.notes])
      expect(items).to.not.be.empty
      for (const item of items) {
        expect(PRECHECK_CODES, item.section).to.include(item.code)
        expect(item.code.startsWith(`${item.section}.`), `${item.code} in ${item.section}`).to.equal(true)
        expect(sectionOf.get(item.code) ?? item.section).to.equal(item.section)
        sectionOf.set(item.code, item.section)
      }
    })

    it('names the vault, investor and field of a claimable row, so nothing parses its subject', async () => {
      const report = await run(claimableWorld(), claimableCandidates)
      const rows = inSection(report.rows, 'spoke.claimables').filter((row) => row.severity === 'warn')
      expect(rows.map((row) => [row.code, row.refs])).to.deep.equal([
        ['spoke.claimables.maxMint', { vault, investor, field: 'maxMint' }],
        ['spoke.claimables.maxWithdraw', { vault, investor, field: 'maxWithdraw' }],
      ])
    })

    it('names the address of each v3.2 hub admin note, so nothing parses its text', async () => {
      const report = await run(world())
      const admins = report.notes.filter((note) => note.code === 'hub.admins.admin')
      expect(admins.map((note) => note.refs)).to.deep.equal([{ address: ADMIN }])
    })
  })

  describe('amounts', () => {
    const investor = addr(0x1a)
    const vault = addr(0xd1)
    const withOrders = (w: World) =>
      run(w, {
        hubInvestors: async () => ({ keys: [{ scId: sc1, assetId: USDC_ID, investor }], gaps: [] }),
        spoke: async () => ({
          managers: [],
          vaults: [vault],
          rampInstances: [],
          ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
          rampClasses: [],
        }),
        spokeInvestors: async () => ({ byClass: [{ scId: sc1, investors: [investor] }], gaps: [] }),
      })
    const amountOf = (rows: readonly PreCheckRow[], field: string) =>
      rows.find((row) => row.subject.includes(` ${field} = `))?.amount

    it('counts a 6-decimal asset and an 18-decimal share in their own decimals, so 1,000 USDC reads 1,000', async () => {
      const report = await withOrders(
        world({
          vaults: [vault],
          hubOrder: { deposit: 1_000_000_000n, redeem: 5n * 10n ** 18n, claims: 0 },
          investments: { [investor]: [5n * 10n ** 18n, 2_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] },
        })
      )
      const hub = inSection(report.rows, 'hub.investorOrders')
      expect(amountOf(hub, 'depositRequest.pending')).to.deep.equal({ raw: 1_000_000_000n, decimals: 6 })
      expect(amountOf(hub, 'redeemRequest.pending')).to.deep.equal({ raw: 5n * 10n ** 18n, decimals: 18 })
      const spoke = inSection(report.rows, 'spoke.claimables')
      expect(amountOf(spoke, 'maxMint')).to.deep.equal({ raw: 5n * 10n ** 18n, decimals: 18, asset: TOKEN })
      expect(amountOf(spoke, 'maxWithdraw')).to.deep.equal({ raw: 2_000_000n, decimals: 6, asset: USDC })
    })

    it('reports unclaimed rounds as a count in the subject, not as a token amount', async () => {
      const report = await withOrders(world({ hubOrder: { deposit: 0n, redeem: 0n, claims: 2 } }))
      const row = inSection(report.rows, 'hub.investorOrders').find((r) => r.subject.includes('maxDepositClaims'))!
      expect(row.subject).to.match(/maxDepositClaims = 2$/)
      expect(row.amount).to.equal(undefined)
    })

    it('reports decimals as unread instead of 0 when the token does not answer', async () => {
      const report = await withOrders(
        world({
          vaults: [vault],
          noDecimals: true,
          hubOrder: { deposit: 1_000_000_000n, redeem: 0n, claims: 0 },
          investments: { [investor]: [0n, 2_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] },
        })
      )
      expect(amountOf(inSection(report.rows, 'hub.investorOrders'), 'depositRequest.pending')!.decimals).to.equal(null)
      expect(amountOf(inSection(report.rows, 'spoke.claimables'), 'maxWithdraw')!.decimals).to.equal(null)
    })
  })

  it('reports the hub-only shape without a spoke report when the hub chain carries no spoke', async () => {
    const w = world({ poolActive: {}, record: [] })
    const sites = new Map<CentrifugeId, PreCheckSite>([[HUB, site(w, HUB)]])
    const report = await new MigrationPreCheck(POOL, sites, candidates({ spokes: async () => [] }), {}).run()
    expect(report.chains).to.deep.equal([{ centrifugeId: HUB, block: 100n, roles: ['hub'] }])
    expect(report.rows.some((row) => row.section.startsWith('spoke.'))).to.equal(false)
    expect(report.notes.some((note) => /same-chain spoke's callbacks are synchronous/.test(note.text))).to.equal(true)
  })
})

describe('MigrationPreCheck.claimables', () => {
  const vault = addr(0xd1)
  const depositor = addr(0x1a)
  const redeemer = addr(0x1b)
  const pending = addr(0x1c)
  const otherClass = addr(0x1d)
  const sc2 = ShareClassId.from(POOL, 2)
  const zeros = (over: Record<number, bigint>) => Array.from({ length: 10 }, (_, i) => over[i] ?? 0n)
  const spokeWithVault: Partial<PreCheckCandidates> = {
    spoke: async () => ({
      managers: [],
      vaults: [vault],
      rampInstances: [],
      ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
      rampClasses: [],
    }),
  }
  const claimablesOf = (w: World, over: Partial<PreCheckCandidates>) =>
    new MigrationPreCheck(
      POOL,
      new Map<CentrifugeId, PreCheckSite>([
        [HUB, site(w, HUB)],
        [SPOKE, site(w, SPOKE)],
      ]),
      candidates({ ...spokeWithVault, ...over })
    ).claimables(SPOKE)

  it('lists an unclaimed deposit and an unclaimed redeem payout, and leaves out open requests', async () => {
    const w = world({
      vaults: [vault],
      investments: {
        [depositor]: zeros({ 0: 5n }),
        [redeemer]: zeros({ 1: 7n }),
        [pending]: zeros({ 4: 9n }),
        [otherClass]: zeros({ 0: 3n }),
      },
      claimable: { [depositor]: [5n, 0n], [redeemer]: [0n, 7n] },
    })
    const result = await claimablesOf(w, {
      spokeInvestors: async () => ({
        byClass: [
          { scId: sc1, investors: [depositor, redeemer, pending] },
          { scId: sc2, investors: [otherClass] },
        ],
        gaps: [],
      }),
    })
    expect(result.centrifugeId).to.equal(SPOKE)
    expect(
      result.items.map(({ investor, kind, amount, refusedByHook }) => ({ investor, kind, amount, refusedByHook }))
    ).to.deep.equal([
      { investor: depositor, kind: 'deposit', amount: 5n, refusedByHook: false },
      { investor: redeemer, kind: 'redeem', amount: 7n, refusedByHook: false },
    ])
    expect(result.items[0]!.vault).to.equal(vault)
    expect(result.items[0]!.shareClassId.equals(sc1)).to.equal(true)
  })

  it('marks a claim the share hook refuses, since the investor cannot take it until the manager resolves it', async () => {
    const w = world({ vaults: [vault], investments: { [depositor]: zeros({ 0: 5n }) } })
    const result = await claimablesOf(w, {
      spokeInvestors: async () => ({ byClass: [{ scId: sc1, investors: [depositor] }], gaps: [] }),
    })
    expect(result.items).to.have.length(1)
    expect(result.items[0]!.refusedByHook).to.equal(true)
  })

  it('passes on where the investor set may be short', async () => {
    const w = world({ vaults: [vault] })
    const result = await claimablesOf(w, {
      spokeInvestors: async () => ({
        byClass: [{ scId: sc1, investors: [] }],
        gaps: ['class members: 1000 of 1200 rows read; the rest are not checked'],
      }),
    })
    expect(result.items).to.deep.equal([])
    expect(result.gaps).to.deep.equal(['class members: 1000 of 1200 rows read; the rest are not checked'])
  })

  describe('deriveMigrationClaimables', () => {
    afterEach(() => sinon.restore())

    const setup = (version: string) => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(centrifuge, 'protocolContext').returns(of({ protocolVersion: version }) as any)
      const getClient = sinon
        .stub(centrifuge, 'getClient')
        .returns(throwError(() => new Error('sentinel: a chain was read')) as any)
      return { centrifuge, pool: new Pool(centrifuge, POOL.toString()), getClient }
    }

    it('answers nothing to claim on a v3.3 pool and reads no chain', async () => {
      const { centrifuge, pool, getClient } = setup('3.3')
      const result = await firstValueFrom(deriveMigrationClaimables(centrifuge, pool, SPOKE))
      expect(result).to.deep.equal({ centrifugeId: SPOKE, items: [], gaps: [] })
      expect(getClient.called).to.equal(false)
    })

    it('reads the v3.2 chains on a v3.2 pool', async () => {
      const { centrifuge, pool } = setup('3.2')
      await firstValueFrom(deriveMigrationClaimables(centrifuge, pool, SPOKE)).then(
        () => expect.fail('expected the v3.2 sites to be read'),
        (error: Error) => expect(error.message).to.match(/sentinel: a chain was read/)
      )
    })
  })
})

describe('migratedPreCheckReport', () => {
  const activated: PoolMigrationRow = {
    migrationId: 'm1',
    poolId: POOL.toString(),
    targetVersion: '3.3',
    hubPhase: 'Activated',
    operator: ADMIN,
    startedAt: '2026-10-17T07:33:00.000Z',
    spokes: [
      { centrifugeId: String(HUB), phase: 'Onboarded', freezeGeneration: '1' },
      { centrifugeId: String(SPOKE), phase: 'Onboarded', freezeGeneration: '1' },
    ],
  }

  it('answers an activated migration from its row, with nothing to read and nothing blocking', () => {
    const report = migratedPreCheckReport(POOL, activated, MIGRATION)
    expect(report.hubPhase).to.equal(3)
    expect(report.spokePhases).to.deep.equal({ [HUB]: 4, [SPOKE]: 4 })
    expect(report.operator).to.equal(ADMIN)
    expect(report.armedSpokes).to.deep.equal([HUB, SPOKE])
    expect(report.migration).to.equal(MIGRATION)
    expect(report.chains).to.deep.equal([])
    expect(report.rows).to.deep.equal([])
    expect(report.blockingRows).to.deep.equal([])
    expect(report.counts).to.deep.equal({ stop: 0, warn: 0, gap: 0, info: 0 })
    expect(report.notes).to.have.length(1)
    expect(report.notes[0]!.text).to.match(
      /on v3.3 and its migration is activated \(started 2026-10-17T07:33:00.000Z, operator 0x/
    )
  })

  it('says when the row is missing or behind the version', () => {
    const native = migratedPreCheckReport(POOL, null, null)
    expect(native.hubPhase).to.equal(null)
    expect(native.operator).to.equal(null)
    expect(native.armedSpokes).to.deep.equal([])
    expect(native.notes[0]!.text).to.match(/no migration row/)
    const behind = migratedPreCheckReport(POOL, { ...activated, hubPhase: 'HubOnboarded' }, MIGRATION)
    expect(behind.hubPhase).to.equal(2)
    expect(behind.notes[0]!.text).to.match(/reads v3.3 while its migration row reads hubOnboarded/)
  })

  it('counts as armed only the row spokes past None', () => {
    const aborted = {
      ...activated,
      spokes: [...activated.spokes, { centrifugeId: '3', phase: 'None', freezeGeneration: '1' }],
    }
    const report = migratedPreCheckReport(POOL, aborted, MIGRATION)
    expect(report.armedSpokes).to.deep.equal([HUB, SPOKE])
    expect(report.spokePhases).to.deep.equal({ [HUB]: 4, [SPOKE]: 4, 3: 0 })
  })

  describe('deriveMigrationPreCheck', () => {
    afterEach(() => sinon.restore())

    const setup = (version: string, row: PoolMigrationRow | null | Observable<PoolMigrationRow | null>) => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const protocolContext = sinon.stub(centrifuge, 'protocolContext').returns(of({ protocolVersion: version }) as any)
      const queried: string[] = []
      sinon.stub(centrifuge as any, '_queryData').callsFake((...args: unknown[]) => {
        queried.push(String(args[0]))
        if (args[0] === 'poolMigration') return isObservable(row) ? row : of(row)
        throw new Error(`unexpected catalogue read ${String(args[0])}`)
      })
      const getClient = sinon
        .stub(centrifuge, 'getClient')
        .returns(throwError(() => new Error('sentinel: a chain was read')) as any)
      return { centrifuge, pool: new Pool(centrifuge, POOL.toString()), protocolContext, getClient, queried }
    }

    it('answers a v3.3 pool from the migration row of the pool-scoped context and reads no chain', async () => {
      const { centrifuge, pool, protocolContext, getClient, queried } = setup('3.3', activated)
      const report = await firstValueFrom(deriveMigrationPreCheck(centrifuge, pool))
      expect(report.hubPhase).to.equal(3)
      expect(report.notes[0]!.text).to.match(/nothing left to check/)
      expect(queried).to.deep.equal(['poolMigration'])
      expect(getClient.called).to.equal(false)
      expect(protocolContext.firstCall.args[0]).to.be.instanceOf(PoolId)
      expect(protocolContext.firstCall.args[0]!.toString()).to.equal(POOL.toString())
    })

    it('follows the migration row as the indexer catches up', () => {
      const rows = new Subject<PoolMigrationRow | null>()
      const { centrifuge, pool } = setup('3.3', rows)
      const notes: string[] = []
      const subscription = deriveMigrationPreCheck(centrifuge, pool).subscribe((report) =>
        notes.push(report.notes[0]!.text)
      )
      rows.next(null)
      rows.next({ ...activated, hubPhase: 'HubOnboarded' })
      rows.next(activated)
      subscription.unsubscribe()
      expect(notes).to.have.length(3)
      expect(notes[0]).to.match(/no migration row/)
      expect(notes[1]).to.match(/not caught up on the row/)
      expect(notes[2]).to.match(/nothing left to check/)
    })

    it('still runs the v3.2 report on a v3.2 pool', async () => {
      const { centrifuge, pool } = setup('3.2', activated)
      await firstValueFrom(deriveMigrationPreCheck(centrifuge, pool, { centrifugeIds: [HUB] })).then(
        () => expect.fail('expected the v3.2 sites to be read'),
        (error: Error) => expect(error.message).to.match(/sentinel: a chain was read/)
      )
    })
  })
})
