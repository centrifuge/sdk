import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { encodeAbiParameters, encodeEventTopics, pad } from 'viem'
import {
  ABIS_V3_2 as ABI,
  builders,
  GENERATED_ABIS_V3_2,
  resolveProtocolContext,
  type ProtocolContext,
} from '@centrifuge/protocol'
import { REST_ROUTES } from '@centrifuge/queries/rest'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { notMigrating } from '../tests/utils.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

/**
 * On/off-ramp and merkle-proof-manager (Basin) acceptance.
 *
 * This surface is unusual in three ways, and the file is organised around them:
 *
 * 1. All five catalogue-consuming READS are routed to REST, and
 *    `packages/queries` pins the paths and the `absent`-mapping decision. What
 *    is left here is the SDK-side selection logic those five feed, which is
 *    where the manager-ambiguity refusal lives.
 * 2. One WRITE is routed, `registerOnOffRamp`; the rest of the surface has no
 *    `PoolAction`. `registerMerkleProofManagerAsBSManager` is reachable through
 *    the pool-access `updateBalanceSheetManagers` row, so its calldata parity
 *    is proved here even though the row belongs to another vertical.
 * 3. The deploy-then-register concat flows cannot be routed at all, and the
 *    thing that must not change while that holds is the STATUS CONTRACT to
 *    apps.
 *
 * The "SDK side" of every parity comparison is `buildOnly`'s bytes — the exact
 * output of the signing path's encoder — never a re-encode written in this
 * file, which would only prove the test agrees with itself. The "backend side"
 * is the `@centrifuge/protocol` builder `ProtocolTxBuilder.build()` calls,
 * resolved over the same bundled deployment registry.
 *
 * No indexer, no RPC, no fork: the data source is a stub and the chain plumbing
 * is faked.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** Pool on centrifugeId 1 (ethereum); managers are deployed to spoke 4 (plume), which lists only the legacy factory. */
const POOL_ID = PoolId.from(1, 13)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const SPOKE_CENT_ID = 4
const HUB_CHAIN_ID = 1
const SPOKE_CHAIN_ID = 98866
/** A network that lists an OnchainPM factory, which no legacy-only network does. */
const ONCHAIN_PM_CENT_ID = 2

const MANAGER_LOW = '0x1111111111111111111111111111111111111111' as HexString
const MANAGER_HIGH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as HexString
const OTHER_MANAGER = '0x7777777777777777777777777777777777777777' as HexString
const REFUND = '0x5675675675675675675675675675675675675675' as HexString
const SIGNER = '0x00000000000000000000000000000000000f00d1' as HexString
const TX_HASH = `0x${'13'.repeat(32)}` as HexString

/** What the stubbed data source answers, per catalogue entry, for the case. */
let rows: Record<string, unknown> = {}
const projectedPool = { id: POOL_ID.toString(), protocolVersion: PROTOCOL_VERSION, migrationStatus: 'live' }

function stubChain(centrifuge: Centrifuge) {
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test', nativeCurrency: {}, rpcUrls: {} }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() =>
    thenable(
      notMigrating({
        getCode: async () => undefined,
        readContract: async () => undefined,
        waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
          status: 'success',
          transactionHash: hash,
          logs: receiptLogs,
        }),
      })
    )
  )
  // The cross-chain fee is a chain read (`MultiAdapter.estimate`) and is not
  // what any case here is about: the CALLDATA parity cases run through
  // `buildOnly`, whose batching branch never estimates, and the signing cases
  // only need the leg to broadcast. Zero rather than a plausible number, so a
  // case that started depending on the fee would be obviously wrong.
  sinon.stub(centrifuge as any, '_estimate').callsFake(() => thenable(0n))
}

/** The logs the faked receipt carries, for the concat-flow cases. */
let receiptLogs: unknown[] = []

/**
 * One `DeployOnOfframpManager(uint64 indexed poolId, bytes16 scId, address
 * indexed manager)` log, encoded the way the factory emits it.
 *
 * Built with viem's own topic encoder rather than by hand: the point of the
 * concat-flow cases is that the SDK still reads the address OUT OF THE RECEIPT,
 * so a log shape invented in this file would let a decode bug pass.
 */
function deployOnOfframpManagerLog(manager: HexString) {
  return {
    address: onOfframpManagerFactory().toLowerCase() as HexString,
    topics: encodeEventTopics({
      abi: GENERATED_ABIS_V3_2.OnOfframpManagerFactory,
      eventName: 'DeployOnOfframpManager',
      args: { poolId: POOL_ID.raw, manager },
    }),
    data: encodeAbiParameters([{ type: 'bytes16' }], [SC_ID.raw]),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: TX_HASH,
  }
}

/** One `DeployOnchainPM(uint64 indexed poolId, address indexed onchainPM)` log. */
function deployOnchainPMLog(manager: HexString) {
  return {
    address: onchainPMFactory().toLowerCase() as HexString,
    topics: encodeEventTopics({
      abi: ABI.OnchainPMFactory,
      eventName: 'DeployOnchainPM',
      args: { poolId: POOL_ID.raw, onchainPM: manager },
    }),
    data: '0x' as HexString,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: TX_HASH,
  }
}

/**
 * A permissive EIP-1193 fake: enough for `_transact` to reach `doTransaction`.
 *
 * It TRACKS the selected chain across `wallet_switchEthereumChain`, because the
 * concat flows deliberately span two: the deploy leg is signed on the spoke and
 * the registration leg on the hub. A fake that answered one constant would make
 * `assertWalletChainMatches` refuse the second leg — a failure of the fake, not
 * of the code.
 */
function fakeSigner(startChainId = SPOKE_CHAIN_ID) {
  const sent: any[] = []
  let chainId = startChainId
  const provider = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [SIGNER]
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'eth_sendTransaction':
          sent.push(params?.[0])
          return TX_HASH
        case 'wallet_switchEthereumChain':
          chainId = Number(params?.[0]?.chainId ?? chainId)
          return null
        default:
          throw new Error(`fakeSigner: unexpected RPC method "${method}"`)
      }
    },
  }
  return { provider, sent }
}

/** A strategy that records the action; a Basin write must never reach it. */
function recordingStrategy() {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-sdk-13',
        signerType: 'fordefi',
        status: 'pending_approval',
      } satisfies PrepareOutcome)
    },
  }
  return { strategy, actions }
}

function backendCentrifuge() {
  const { strategy, actions } = recordingStrategy()
  const centrifuge = new Centrifuge({
    environment: ENVIRONMENT,
    dataSource: {
      query: (name: string) =>
        of(name === 'pools' ? [projectedPool] : name === 'poolMigration' ? null : (rows[name] ?? [])),
    } as any,
    txStrategy: strategy,
  })
  stubChain(centrifuge)
  return { centrifuge, actions }
}

/** A default-configured SDK: no seams, so the write table is never consulted. */
function localCentrifuge() {
  const centrifuge = new Centrifuge({
    environment: ENVIRONMENT,
    dataSource: {
      query: (name: string) =>
        of(name === 'pools' ? [projectedPool] : name === 'poolMigration' ? null : (rows[name] ?? [])),
    } as any,
  })
  stubChain(centrifuge)
  return centrifuge
}

function entities(centrifuge: Centrifuge, centrifugeId: number = SPOKE_CENT_ID) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  const network = new PoolNetwork(centrifuge, pool, centrifugeId)
  return { pool, network }
}

function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, {
    environment: ENVIRONMENT,
    centrifugeId,
  })
}

const onOfframpManagerFactory = () => protocolContext(SPOKE_CENT_ID).addresses.onOfframpManagerFactory as HexString
const onchainPMFactory = () => protocolContext(ONCHAIN_PM_CENT_ID).addresses.onchainPMFactory as HexString

/** A `poolManagers` row as `_managers()` reads it. */
function poolManagerRow(address: HexString, isBalancesheetManager = true) {
  return {
    address,
    centrifugeId: String(SPOKE_CENT_ID),
    poolId: POOL_ID.toString(),
    isHubManager: false,
    isBalancesheetManager,
    crosschainInProgress: null,
  }
}

/** Await an observable and return the error it threw, or undefined. */
async function failure(source: unknown): Promise<any> {
  try {
    await firstValueFrom(source as any)
    return undefined
  } catch (error) {
    return error
  }
}

/**
 * Drain a transaction to completion, collecting its statuses.
 *
 * Not `firstValueFrom`: a transaction emits `SigningTransaction` first, so
 * taking the first value would report a later throw as a PASS, which is why
 * the statuses are collected rather than sampled.
 */
async function drain(transaction: unknown): Promise<{ statuses: any[]; error?: any }> {
  const statuses: any[] = []
  return new Promise((resolve) => {
    ;(transaction as any).subscribe({
      next: (status: unknown) => statuses.push(status),
      error: (error: unknown) => resolve({ statuses, error }),
      complete: () => resolve({ statuses }),
    })
  })
}

beforeEach(() => {
  rows = {}
  receiptLogs = []
})

afterEach(() => {
  sinon.restore()
})

describe('on/off-ramp: the routing table', () => {
  it('leaves no on/off-ramp read on the graphql fallback, and owns exactly five', () => {
    // The assertion belongs to the vertical that consumes these entries,
    // because `packages/queries` cannot see which SDK method reads what.
    const table = backendRoutingTable()
    const owned = Object.entries(table.readOwners)
      .filter(([, owner]) => owner === 'on-off-ramp')
      .map(([name]) => name)
      .sort()

    expect(owned).to.deep.equal([
      'merkleProofManagers',
      'offRampAddresses',
      'onOffRampManagers',
      'onOffRampRelayers',
      'onRampAssets',
    ])
    for (const name of owned) {
      expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
    }
  })

  it('adds no write row, because the backend ships no PoolAction for it', () => {
    // "Nothing to add" has to be pinned as an ABSENCE of these specific rows,
    // not by restating the whole table: the exhaustive assertion belongs in
    // exactly one place, `tx/BackendPrepare.test.ts`, and a later vertical
    // adding its own rows must not invalidate this one.
    const { writes } = backendRoutingTable()
    for (const action of [
      'executeWorkflow',
      'addToPolicy',
      'removeFromPolicy',
      'updatePolicy',
      'setWorkflows',
      'addPolicy',
      'addWorkflow',
      'setPolicies',
      'disableStrategist',
      'setReceiver',
      'setRelayer',
      'setAsset',
      'deployOnchainPM',
      'authorizeOnchainPM',
      'deployMerkleProofManager',
      'deployOnOfframpManager',
    ]) {
      expect(writes[action], action).to.equal(undefined)
    }
  })

  it('keeps every deferred Basin write out of the PERMANENT list', () => {
    // "Not migrated yet" and "never" are different answers, and only the first
    // applies to any of these: each is a pool-operator write a policy engine
    // could legitimately gate. The permanent list is the investor-side vault
    // flows and nothing else.
    const { permanentlyLocalMethods } = backendRoutingTable()
    for (const method of [
      'PoolNetwork.deployOnchainPM',
      'PoolNetwork.authorizeOnchainPM',
      'PoolNetwork.deployMerkleProofManager',
      'PoolNetwork.deployOnOfframpManager',
      'PoolNetwork.deployAndRegisterOnOffRampManager',
      'OnOffRampManager.setReceiver',
      'OnOffRampManager.setRelayer',
      'OnOffRampManager.setAsset',
      'OnOffRampManager.deposit',
      'OnOffRampManager.withdraw',
      'MerkleProofManager.setPolicies',
      'MerkleProofManager.addPolicy',
      'MerkleProofManager.addWorkflow',
      'MerkleProofManager.setWorkflows',
      'MerkleProofManager.disableStrategist',
      'MerkleProofManager.execute',
      'OnchainPM.updatePolicy',
      'OnchainPM.execute',
      'Pool.addToPolicy',
      'Pool.removeFromPolicy',
      'Pool.executeWorkflow',
    ]) {
      expect(permanentlyLocalMethods, method).to.not.include(method)
    }
    expect(permanentlyLocalMethods).to.deep.equal([
      'Vault.syncDeposit',
      'Vault.asyncDeposit',
      'Vault.asyncRedeem',
      'Vault.cancelDepositRequest',
      'Vault.cancelRedeemRequest',
      'Vault.claim',
    ])
  })

  it('gives no Basin read an `absent` mapping, because [] is a real answer', () => {
    // The rule the brief names from the other side: a 404 must not become an
    // empty answer here. All five return arrays, and for a live pool with no
    // ramp configured `[]` legitimately means "none yet" — so an `absent` row
    // would make "no such share class", "another pool's share class" and "none
    // configured" indistinguishable.
    for (const name of [
      'merkleProofManagers',
      'onOffRampManagers',
      'offRampAddresses',
      'onOffRampRelayers',
      'onRampAssets',
    ] as const) {
      expect(REST_ROUTES[name]?.absent, name).to.equal(undefined)
    }
  })
})

describe('on/off-ramp: ambiguous manager selection', () => {
  it('resolves the single projected MerkleProofManager', async () => {
    rows = { merkleProofManagers: [{ address: MANAGER_HIGH }] }
    const { network } = entities(localCentrifuge())

    const manager = await firstValueFrom(network.merkleProofManager())
    expect(manager.address).to.equal(MANAGER_HIGH.toLowerCase())
  })

  it('still answers "not found" when none is projected', async () => {
    // The refusal is about AMBIGUITY, not about absence: nothing projected is
    // still "not found".
    rows = { merkleProofManagers: [] }
    const { network } = entities(localCentrifuge())

    expect((await failure(network.merkleProofManager()))?.message).to.match(/MerkleProofManager not found/)
  })

  it('refuses to pick between two projected MerkleProofManagers', async () => {
    // Merkle-proof rows carry no block and both transports sort by address, so
    // no position in the list means "current"; the SDK refuses instead of picking.
    rows = { merkleProofManagers: [{ address: MANAGER_LOW }, { address: MANAGER_HIGH }] }
    const { network } = entities(localCentrifuge())

    const error = await failure(network.merkleProofManager())
    expect(error?.message).to.match(/Found 2 deployed MerkleProofManagers/)
    // Naming BOTH is the actionable part: an operator resolving a factory
    // redeploy needs to know which two are in play.
    expect(error?.message).to.include(MANAGER_LOW)
    expect(error?.message).to.include(MANAGER_HIGH)
  })

  it('refuses in BOTH address directions, which is what makes it a refusal', async () => {
    // The control for the case above. A "fix" that merely swapped `[0]` for
    // `[length - 1]` would pass the previous test's first assertion if it
    // happened to throw for another reason; this one fails unless the
    // ambiguity itself is what stops the call, whichever order the rows arrive
    // in.
    for (const order of [
      [{ address: MANAGER_LOW }, { address: MANAGER_HIGH }],
      [{ address: MANAGER_HIGH }, { address: MANAGER_LOW }],
    ]) {
      rows = { merkleProofManagers: order }
      const { network } = entities(localCentrifuge())
      const error = await failure(network.merkleProofManager())
      expect(error?.message, JSON.stringify(order)).to.match(/Found 2 deployed MerkleProofManagers/)
      sinon.restore()
    }
  })

  it('resolves the single balance-sheet-authorised OnOffRampManager', async () => {
    rows = {
      onOffRampManagers: [{ address: MANAGER_LOW, createdAtBlock: 10 }],
      poolManagers: [poolManagerRow(MANAGER_LOW)],
    }
    const { network } = entities(localCentrifuge())

    const manager = await firstValueFrom(network.onOfframpManager(SC_ID))
    expect(manager.onrampAddress).to.equal(MANAGER_LOW.toLowerCase())
  })

  it('resolves the newest ramp when only it is authorised, whichever address is lower', async () => {
    rows = {
      onOffRampManagers: [
        { address: MANAGER_LOW, createdAtBlock: 10 },
        { address: MANAGER_HIGH, createdAtBlock: 20 },
      ],
      poolManagers: [poolManagerRow(MANAGER_HIGH), poolManagerRow(MANAGER_LOW, false)],
    }
    const { network } = entities(localCentrifuge())

    const manager = await firstValueFrom(network.onOfframpManager(SC_ID))
    expect(manager.onrampAddress).to.equal(MANAGER_HIGH.toLowerCase())
  })

  it('resolves the older ramp when the newer one is not a balance sheet manager', async () => {
    rows = {
      onOffRampManagers: [
        { address: MANAGER_LOW, createdAtBlock: 10 },
        { address: MANAGER_HIGH, createdAtBlock: 20 },
      ],
      poolManagers: [poolManagerRow(MANAGER_LOW), poolManagerRow(MANAGER_HIGH, false)],
    }
    const { network } = entities(localCentrifuge())

    const manager = await firstValueFrom(network.onOfframpManager(SC_ID))
    expect(manager.onrampAddress).to.equal(MANAGER_LOW.toLowerCase())
  })

  it('resolves the newest when two ramps are both balance sheet managers', async () => {
    rows = {
      onOffRampManagers: [
        { address: MANAGER_LOW, createdAtBlock: 10 },
        { address: MANAGER_HIGH, createdAtBlock: 20 },
      ],
      poolManagers: [poolManagerRow(MANAGER_LOW), poolManagerRow(MANAGER_HIGH)],
    }
    const { network } = entities(localCentrifuge())

    const manager = await firstValueFrom(network.onOfframpManager(SC_ID))
    expect(manager.onrampAddress).to.equal(MANAGER_HIGH.toLowerCase())
  })

  it('reuses the one projected manager instead of deploying a second', async () => {
    // `deployAndRegisterOnOffRampManager` is the selection that MATTERS most:
    // whatever `_findDeployedOnOffRampManagerAddress` returns is what the
    // second leg registers as a balance-sheet manager. With one row it skips
    // the deploy and registers that address — no `eth_sendTransaction` for the
    // factory call, which is what proves the reuse branch was taken.
    rows = {
      onOffRampManagers: [{ address: MANAGER_HIGH, createdAtBlock: 10 }],
      poolManagers: [],
    }
    const centrifuge = localCentrifuge()
    const { provider, sent } = fakeSigner()
    centrifuge.setSigner(provider as any)
    const { network } = entities(centrifuge)

    const { error } = await drain(network.deployAndRegisterOnOffRampManager(SC_ID))
    expect(error, error?.message).to.equal(undefined)
    // Exactly one transaction: the registration. A second would mean the
    // already-deployed manager was not found.
    expect(sent).to.have.length(1)
    expect(String(sent[0].data).toLowerCase()).to.include(
      pad(MANAGER_HIGH, { dir: 'right', size: 32 }).slice(2).toLowerCase()
    )
  })

  it('registers only the newest of two projected OnOffRampManagers', async () => {
    rows = {
      onOffRampManagers: [
        { address: MANAGER_HIGH, createdAtBlock: 10 },
        { address: MANAGER_LOW, createdAtBlock: 20 },
      ],
      poolManagers: [],
    }
    const centrifuge = localCentrifuge()
    const { provider, sent } = fakeSigner()
    centrifuge.setSigner(provider as any)
    const { network } = entities(centrifuge)

    const { error } = await drain(network.deployAndRegisterOnOffRampManager(SC_ID))

    expect(error, error?.message).to.equal(undefined)
    expect(sent).to.have.length(1)
    const data = String(sent[0].data).toLowerCase()
    expect(data).to.include(pad(MANAGER_LOW, { dir: 'right', size: 32 }).slice(2).toLowerCase())
    expect(data).to.not.include(pad(MANAGER_HIGH, { dir: 'right', size: 32 }).slice(2).toLowerCase())
  })

  it('surfaces every deployed manager from the STATUS read, which selects nothing', async () => {
    // `onOfframpManagerStatus()` is display-only and returns the whole list, so
    // it is deliberately not covered by the refusal: showing an operator both
    // rows is exactly what they need during the upgrade the refusal names.
    rows = {
      onOffRampManagers: [
        { address: MANAGER_LOW, createdAtBlock: 10 },
        { address: MANAGER_HIGH, createdAtBlock: 20 },
      ],
      poolManagers: [poolManagerRow(MANAGER_LOW), poolManagerRow(MANAGER_HIGH)],
    }
    const { network } = entities(localCentrifuge())

    const status = await firstValueFrom(network.onOfframpManagerStatus(SC_ID))
    expect(status.map((row) => row.address)).to.deep.equal([MANAGER_LOW.toLowerCase(), MANAGER_HIGH.toLowerCase()])
  })
})

describe('on/off-ramp: deploy-then-register stays LocalBuild', () => {
  it('deployOnOfframpManager keeps its status contract, with a strategy injected', async () => {
    // Both halves in one case. The strategy is injected, so a row in
    // `ACTION_ROUTES` would divert this call — there is none, and the emitted
    // status must be byte-for-byte what apps already consume.
    rows = { onOffRampManagers: [] }
    receiptLogs = [deployOnOfframpManagerLog(MANAGER_HIGH)]
    const { centrifuge, actions } = backendCentrifuge()
    const { provider } = fakeSigner()
    centrifuge.setSigner(provider as any)
    const { network } = entities(centrifuge)

    const { statuses, error } = await drain(network.deployOnOfframpManager(SC_ID))
    expect(error, error?.message).to.equal(undefined)

    expect(actions, 'a Basin deploy must never reach the backend strategy').to.have.length(0)
    const deployed = statuses.find((status) => status.type === 'DeployedOnOfframpManager')
    expect(deployed, 'DeployedOnOfframpManager was not emitted').to.not.equal(undefined)
    // The address comes out of the RECEIPT LOG, which is precisely the input
    // the backend route cannot supply.
    expect(String(deployed.address).toLowerCase()).to.equal(MANAGER_HIGH.toLowerCase())
  })

  it('deployOnchainPM keeps its status contract, with a strategy injected', async () => {
    receiptLogs = [deployOnchainPMLog(MANAGER_LOW)]
    const { centrifuge, actions } = backendCentrifuge()
    const { provider } = fakeSigner()
    centrifuge.setSigner(provider as any)
    const { network } = entities(centrifuge, ONCHAIN_PM_CENT_ID)

    const { statuses, error } = await drain(network.deployOnchainPM())
    expect(error, error?.message).to.equal(undefined)

    expect(actions).to.have.length(0)
    const deployed = statuses.find((status) => status.type === 'DeployedOnchainPM')
    expect(deployed, 'DeployedOnchainPM was not emitted').to.not.equal(undefined)
    expect(String(deployed.address).toLowerCase()).to.equal(MANAGER_LOW.toLowerCase())
  })

  it('fails loud when the receipt carries no deploy event, rather than guessing', async () => {
    // The throw is the reason these flows may not be half-routed: a backend
    // route that answered `null` or the predicted CREATE2 address would turn it
    // into a plausible wrong second leg.
    rows = { onOffRampManagers: [] }
    receiptLogs = []
    const { centrifuge } = backendCentrifuge()
    const { provider } = fakeSigner()
    centrifuge.setSigner(provider as any)
    const { network } = entities(centrifuge)

    const { error } = await drain(network.deployOnOfframpManager(SC_ID))
    expect(error?.message).to.match(/DeployOnOfframpManager event not found/)
  })
})

describe('on/off-ramp: calldata parity against the updateBalanceSheetManagers builder (legacy network)', () => {
  it('registerOnOffRampManagerAsBSManager is byte-equal to the builder', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)

    const localBuilt = await centrifuge.buildOnly(network.registerOnOffRampManagerAsBSManager(MANAGER_HIGH, SC_ID), {
      fromAddress: REFUND,
    })
    const built = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_HIGH, canManage: true }],
    })

    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    // The control: a revoke of the same address must NOT produce the same
    // bytes. `canManage` is one word, so a side that dropped it would leave
    // every other byte identical.
    const revoke = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_HIGH, canManage: false }],
    })
    expect(built.data).to.not.equal(revoke.data)
  })

  it('registerMerkleProofManagerAsBSManager is byte-equal, and is a different manager', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)

    const localBuilt = await centrifuge.buildOnly(network.registerMerkleProofManagerAsBSManager(MANAGER_LOW), {
      fromAddress: REFUND,
    })
    const built = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_LOW, canManage: true }],
    })

    expect(localBuilt.data).to.equal(built.data)
    // Both register methods encode the SAME call with a different address, so
    // the control that matters is that the address actually reaches the bytes.
    const otherManager = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: OTHER_MANAGER, canManage: true }],
    })
    expect(built.data).to.not.equal(otherManager.data)
  })

  it('the manager address is RIGHT-padded on both sides', async () => {
    // `who` is a bytes32 the spoke decodes with `CastLib.toAddress`, which
    // reverts `PrefixNotZero` on a left-padded value — after the cross-chain
    // message has been paid for. So the padding direction is pinned directly
    // rather than left implied by the byte comparison above.
    const built = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_HIGH, canManage: true }],
    })
    const rightPadded = pad(MANAGER_HIGH, { dir: 'right', size: 32 }).slice(2)
    const leftPadded = pad(MANAGER_HIGH, { dir: 'left', size: 32 }).slice(2)

    expect(built.data.toLowerCase()).to.include(rightPadded.toLowerCase())
    expect(built.data.toLowerCase()).to.not.include(leftPadded.toLowerCase())
  })

  it('a batch of two managers is order-sensitive, on both sides', async () => {
    // The order control the brief asks for, in the form that makes it an ORDER
    // claim: the same two managers in reversed order must produce different
    // bytes. `updateBalanceSheetManagers` deliberately does NOT repartition
    // (unlike `updatePoolManagers`), so caller order is the encoding, and a
    // parity assertion over a single entry could never have caught a side that
    // sorted.
    const centrifuge = localCentrifuge()
    const { pool } = entities(centrifuge)
    const updates = [
      { centrifugeId: SPOKE_CENT_ID as any, address: MANAGER_LOW, canManage: true },
      { centrifugeId: SPOKE_CENT_ID as any, address: MANAGER_HIGH, canManage: true },
    ]

    const localBuilt = await centrifuge.buildOnly(pool.updateBalanceSheetManagers(updates), {
      fromAddress: REFUND,
    })
    const asBuilt = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: updates.map(({ centrifugeId, address, canManage }) => ({
        centrifugeId: String(centrifugeId),
        address,
        canManage,
      })),
    })
    const reversed = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [
        { centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_HIGH, canManage: true },
        { centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_LOW, canManage: true },
      ],
    })

    expect(localBuilt.data).to.equal(asBuilt.data)
    expect(asBuilt.data).to.not.equal(reversed.data)
  })

  it('the cross-chain message manifests agree, so both sides price the same fee', async () => {
    // `value` is 0n on both sides here for DIFFERENT reasons — the builder is
    // pure and prices nothing, and `buildOnly`'s batching branch skips the
    // estimate — so it is not parity evidence. The manifest each side hands
    // its pricer is, and this is the write where it bites: the two sides
    // disagreeing about the message COUNT is an under-estimate, and that
    // strands a message after the transaction has already confirmed.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)

    const localBuilt = await centrifuge.buildOnly(network.registerOnOffRampManagerAsBSManager(MANAGER_HIGH, SC_ID), {
      fromAddress: REFUND,
    })
    const built = builders.updateBalanceSheetManagers(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      updates: [{ centrifugeId: String(SPOKE_CENT_ID), address: MANAGER_HIGH, canManage: true }],
    })

    expect(Object.keys(localBuilt.messages ?? {}).sort()).to.deep.equal(Object.keys(built.messages ?? {}).sort())
    expect(localBuilt.messages?.[SPOKE_CENT_ID], 'sdk').to.have.length(1)
    expect(built.messages?.[SPOKE_CENT_ID], 'backend').to.have.length(1)
    expect(localBuilt.value).to.equal(built.value)
  })
})
