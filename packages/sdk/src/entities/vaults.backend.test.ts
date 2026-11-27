import { notMigrating, stubLayerZeroGlobalSet, stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, isObservable, lastValueFrom, of, toArray, type Observable } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABIS_V3_2 as ABI, builders, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { TEMPORARILY_DISABLED_CROSSCHAIN_CENTRIFUGE_IDS } from '../utils/crosschainHotfix.js'
import { Balance } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { MessageType } from '../types/transaction.js'
import type { PoolAdapterState } from '../utils/poolAdapters.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

/**
 * Vaults write acceptance: routing, payloads, refusals, and calldata
 * parity between the backend's builders and what the SDK actually puts on the
 * wire.
 *
 * The "SDK side" of every parity comparison is not a re-encode written in this
 * file — that would only prove the test agrees with itself. All four methods route through
 * `wrapTransaction`, so it is `buildOnly`'s output: the exact bytes the signing
 * path would broadcast, from the same encoder. The "backend side" is
 * `@centrifuge/protocol`'s builder — the same function `ProtocolTxBuilder
 * .build()` calls in `apps/private-api` — over the same bundled deployment
 * registry, so the addresses are the deployed ones on both sides.
 *
 * `value` is compared too, and it is `0n` on both. That is not a coincidence
 * worth glossing: the builder attaches zero because it is pure and
 * `MultiAdapter.estimate` is a chain read (private-api prices the `messages`
 * manifest onto the outer transaction), and `buildOnly` attaches zero because
 * `wrapTransaction`'s batching branch skips the estimate. On the SIGNING path
 * both sides put a real fee on the outer transaction — so the fee is out of
 * scope here and the CALLDATA is what these cases pin.
 *
 * Everything runs off the bundled deployment registry: no indexer, no RPC, no
 * fork.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** Pool on centrifugeId 1 (ethereum); vaults are deployed to spoke 2 (base). */
const POOL_ID = PoolId.from(1, 7)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const SPOKE_CENT_ID = 2
const HUB_CHAIN_ID = 1
const SPOKE_CHAIN_ID = 8453

const ASSET_ID = AssetId.from(SPOKE_CENT_ID, 3)
const ASSET_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as HexString
const VAULT_A = '0x1111111111111111111111111111111111111111' as HexString
const VAULT_B = '0x2222222222222222222222222222222222222222' as HexString
const REFUND = '0x5675675675675675675675675675675675675675' as HexString
const OTHER_FACTORY = '0x9999999999999999999999999999999999999999' as HexString
const HASH_1 = `0x${'1'.padStart(64, '0')}` as HexString
const HASH_2 = `0x${'2'.padStart(64, '0')}` as HexString
const LZ_LIVE: PoolAdapterState = { name: 'layerZero', isEnabled: true, crosschainInProgress: null }
const AXELAR_LIVE: PoolAdapterState = { name: 'axelar', isEnabled: true, crosschainInProgress: null }
const LZ_IN_FLIGHT: PoolAdapterState = { name: 'layerZero', isEnabled: false, crosschainInProgress: 'Enabled' }

const MAX_RESERVE = Balance.fromFloat(250, 6)

/** The `deploy()` chain state in which no preamble leg is required. */
const READY_NETWORK = {
  isAsyncManagerSet: true,
  isSyncManagerSet: true,
  requestManager: '0x00000000000000000000000000000000000000ff' as HexString,
}

/**
 * How the fake public client answers a `readContract`, for the current case.
 *
 * A mutable hook rather than a second `sinon.stub` on `getClient`: the chain
 * plumbing is stubbed once per `Centrifuge`, and a case that wants different
 * chain STATE is changing the answers, not the wiring.
 */
let chainRead: (call: { functionName: string; args: readonly unknown[] }) => Promise<unknown> = async () => undefined

/**
 * Stub only the chain plumbing. `_protocolContext` is deliberately NOT stubbed:
 * the addresses on both sides of every parity assertion have to come from the
 * one bundled registry, or the comparison proves nothing about the real
 * deployment.
 */
function stubChain(centrifuge: Centrifuge) {
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() =>
    thenable(
      notMigrating({
        getCode: async () => undefined,
        waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
          status: 'success',
          hash,
          transactionHash: hash,
        }),
        readContract: (call: any) => chainRead(call),
      })
    )
  )
}

function entities(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  const shareClass = new ShareClass(centrifuge, pool, SC_ID.raw)
  const network = new PoolNetwork(centrifuge, pool, SPOKE_CENT_ID)
  const vault = new Vault(centrifuge, network, shareClass, ASSET_ADDRESS, VAULT_A, ASSET_ID)
  return { pool, shareClass, network, vault }
}

/**
 * Put the network into the state `deploy()`'s conditional preamble reads.
 *
 * `#deployState()` composes `details()` with three chain reads
 * (`BalanceSheet.manager` twice and `Spoke.requestManager`), so those are what
 * is faked — not `#deployState` itself, which is the code under test on the
 * refusal cases.
 */
function stubDeployState(
  network: PoolNetwork,
  opts: {
    activeShareClasses?: { id: ShareClassId; vaults: { address: HexString }[] }[]
    isActive?: boolean
    isAsyncManagerSet?: boolean
    isSyncManagerSet?: boolean
    requestManager?: HexString
    /**
     * The pool's adapter rows as the indexer reports them for each chain (`localCentrifugeId`);
     * a function is consulted on every read. Defaults to LayerZero live on both sides, i.e. a wired pool.
     */
    poolAdapters?: PoolAdapterState[] | ((localCentrifugeId: number) => PoolAdapterState[])
  } = {}
) {
  stubDetails(network, opts.activeShareClasses ?? [{ id: SC_ID, vaults: [] }], opts.isActive ?? true)
  stubLayerZeroGlobalSet()

  const isAsync = opts.isAsyncManagerSet ?? READY_NETWORK.isAsyncManagerSet
  const isSync = opts.isSyncManagerSet ?? READY_NETWORK.isSyncManagerSet
  const requestManager = opts.requestManager ?? READY_NETWORK.requestManager
  const spokeAddresses = SPOKE_CONTEXT().addresses
  // `BalanceSheet.manager(poolId, manager)` is read through a viem
  // `getContract` handle, so it too arrives as a `readContract`; the third read
  // is `Spoke.requestManager(poolId)`.
  const poolAdapters = opts.poolAdapters ?? [LZ_LIVE]
  // The indexer rows behind the `poolAdapters` data query, per chain asked; other data queries keep their path.
  const poolAdaptersOnce = async (name: string, vars: any) => {
    if (name !== 'poolAdapters') throw new Error(`stubDeployState: unexpected data query "${name}"`)
    const rows = typeof poolAdapters === 'function' ? poolAdapters(Number(vars.localCentrifugeId)) : poolAdapters
    return rows.map((row) => ({
      adapterAddress: `0x${'0'.repeat(40)}`,
      isEnabled: row.isEnabled,
      crosschainInProgress: row.crosschainInProgress,
      adapter: { name: row.name },
    }))
  }
  sinon.stub((network as any)._root, '_queryDataOnce').callsFake(poolAdaptersOnce as any)
  chainRead = async ({ functionName, args }) => {
    if (functionName === 'requestManager') {
      return requestManager
    }
    if (functionName === 'manager') {
      const who = String(args[1]).toLowerCase()
      if (who === spokeAddresses.asyncRequestManager!.toLowerCase()) {
        return isAsync
      }
      if (who === spokeAddresses.syncManager!.toLowerCase()) {
        return isSync
      }
      return false
    }
    throw new Error(`stubDeployState: unexpected read "${functionName}"`)
  }
}

/** The `details()` a vault edit reads to validate its targets. */
function stubDetails(
  network: PoolNetwork,
  activeShareClasses: { id: ShareClassId; vaults: { address: HexString }[] }[],
  isActive = true
) {
  sinon.stub(network, 'details').returns(makeThenable(of({ isActive, activeShareClasses })) as any)
}

/** A strategy that records the action and answers on the custodial route. */
function recordingStrategy() {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-sdk-8',
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
    dataSource: { query: () => of({}) } as any,
    txStrategy: strategy,
  })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge)
  return { centrifuge, actions }
}

/** A default-configured SDK: no seams, so the write table is never consulted. */
function localCentrifuge() {
  const centrifuge = new Centrifuge({ environment: ENVIRONMENT })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge)
  const queryData = centrifuge._queryData.bind(centrifuge)
  sinon
    .stub(centrifuge as any, '_queryData')
    .callsFake((name: any, ...rest: any[]) => (name === 'poolMigration' ? of(null) : (queryData as any)(name, ...rest)))
  return centrifuge
}

/** The pure-builder context for a hub-side or spoke-side action. */
function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, {
    environment: ENVIRONMENT,
    centrifugeId,
  })
}

const SPOKE_CONTEXT = () => protocolContext(SPOKE_CENT_ID)

function vaultRef(address: HexString) {
  return { scId: SC_ID.raw, assetId: ASSET_ID.toString(), vaultAddress: address }
}

function editTarget(address: HexString) {
  return { shareClassId: SC_ID, assetId: ASSET_ID, address }
}

/** Run a transaction and return the error it threw, or undefined. */
async function failure(tx: unknown): Promise<any> {
  try {
    await firstValueFrom(tx as any)
    return undefined
  } catch (error) {
    return error
  }
}

/** Build a LOCAL transaction and return the error it threw, or undefined. */
async function buildFailure(centrifuge: Centrifuge, tx: any): Promise<any> {
  try {
    await centrifuge.buildOnly(tx, { fromAddress: REFUND })
    return undefined
  } catch (error) {
    return error
  }
}

beforeEach(() => {
  chainRead = async () => undefined
})

afterEach(() => {
  sinon.restore()
})

describe('vaults writes: routing', () => {
  it('routes exactly the two vaults actions the backend ships builders for', () => {
    // Scoped to this vertical's own rows, deliberately: two verticals cannot
    // both hold an exhaustive assertion about a table they both append to. The
    // exhaustive pin lives once, in `tx/BackendPrepare.test.ts`.
    const { writes } = backendRoutingTable()
    expect(writes.deployVault).to.equal('backend')
    expect(writes.updateVaults).to.equal('backend')
    // The control: an action the backend accepts but no vertical has claimed
    // is still local.
    expect(writes.updatePoolMetadata).to.equal(undefined)
  })

  it('keeps the six investor-side flows permanently local, and adds none', () => {
    // The investor-side flows are out of the backend's scope permanently, and
    // this is where "not migrated yet" and "never" stay distinguishable: the
    // list must be exactly these six.
    expect(backendRoutingTable().permanentlyLocalMethods).to.deep.equal([
      'Vault.syncDeposit',
      'Vault.asyncDeposit',
      'Vault.asyncRedeem',
      'Vault.cancelDepositRequest',
      'Vault.cancelRedeemRequest',
      'Vault.claim',
    ])
  })

  it('sends deployVault with a kind, and never a factory address', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    await firstValueFrom(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }], {
        refundAddress: REFUND,
      })
    )

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('deployVault')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      assetId: ASSET_ID.toString(),
      kind: 'syncDeposit',
      refundAddress: REFUND,
    })
  })

  it('sends linkVaults as the `link` half of one updateVaults action', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)

    await firstValueFrom(network.linkVaults([editTarget(VAULT_A), editTarget(VAULT_B)], { refundAddress: REFUND }))

    expect(actions[0]!.action).to.equal('updateVaults')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      centrifugeId: String(SPOKE_CENT_ID),
      refundAddress: REFUND,
      link: [vaultRef(VAULT_A), vaultRef(VAULT_B)],
    })
  })

  it('sends unlinkVaults as the `unlink` half, with no `link` key at all', async () => {
    // The partial subsets the endpoint covers deliberately. An empty `link: []` would
    // be refused by the endpoint's `.nonempty()`, so its ABSENCE is part of
    // the contract rather than an accident of object construction.
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)

    await firstValueFrom(network.unlinkVaults([editTarget(VAULT_A)], { refundAddress: REFUND }))

    expect(actions[0]!.action).to.equal('updateVaults')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      centrifugeId: String(SPOKE_CENT_ID),
      refundAddress: REFUND,
      unlink: [vaultRef(VAULT_A)],
    })
    expect(actions[0]!.payload).to.not.have.property('link')
  })

  it('sends updateMaxReserve by VAULT ADDRESS, with no asset id', async () => {
    // `Hub.updateContract` addresses the sync manager by `(scId, assetId)` and
    // not by vault address at all, so the backend resolves the pair from the
    // projected vault. Sending our own would let the audit row name one vault
    // while the trusted call changed another holding's reserve, so its ABSENCE
    // is the contract.
    const { centrifuge, actions } = backendCentrifuge()
    const { vault } = entities(centrifuge)
    sinon.stub(centrifuge, 'currency').returns(makeThenable(of({ address: ASSET_ADDRESS, decimals: 6 })) as any)

    await firstValueFrom(vault.updateMaxReserve(MAX_RESERVE, { refundAddress: REFUND }))

    expect(actions[0]!.action).to.equal('updateVaults')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      centrifugeId: String(SPOKE_CENT_ID),
      refundAddress: REFUND,
      maxReserve: {
        scId: SC_ID.raw,
        vaultAddress: VAULT_A,
        amount: MAX_RESERVE.toBigInt().toString(),
      },
    })
    expect((actions[0]!.payload as any).maxReserve).to.not.have.property('assetId')
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` builds locally, so a route row cannot
    // change what a default-configured caller does. Proven by calldata coming out of
    // `buildOnly`, since on that path there is no strategy to observe.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDetails(network, [{ id: SC_ID, vaults: [{ address: VAULT_A }] }])

    const built = await centrifuge.buildOnly(network.unlinkVaults([editTarget(VAULT_A)]), {
      fromAddress: REFUND,
    })

    expect(built.calls).to.have.length(1)
  })
})

describe('vaults writes: refusals rather than plausible defaults', () => {
  it('refuses a vault write in backend mode without an explicit refundAddress', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)

    const error = await failure(network.linkVaults([editTarget(VAULT_A)]))

    expect(error?.message).to.contain('refundAddress')
    // And it refused BEFORE preparing anything: no orphaned backend row.
    expect(actions).to.have.length(0)
  })

  it('still defaults refundAddress to the signer on the local path, unchanged', async () => {
    // The other half: the new option must not become a requirement for the
    // callers that have never passed one. `buildOnly`'s `fromAddress` is what
    // `ctx.signingAddress` resolves to in build mode, so the default is
    // observable in the calldata.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDetails(network, [{ id: SC_ID, vaults: [{ address: VAULT_A }] }])

    const [withDefault, explicit] = await Promise.all([
      centrifuge.buildOnly(network.unlinkVaults([editTarget(VAULT_A)]), { fromAddress: REFUND }),
      centrifuge.buildOnly(network.unlinkVaults([editTarget(VAULT_A)], { refundAddress: REFUND }), {
        fromAddress: '0x000000000000000000000000000000000000dead',
      }),
    ])

    expect(withDefault.data).to.equal(explicit.data)
  })

  it('refuses more than one vault per deployVault, rather than fanning out', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const error = await failure(
      network.deployVaults(
        [
          { shareClassId: SC_ID, assetId: ASSET_ID, kind: 'async' },
          { shareClassId: SC_ID, assetId: AssetId.from(SPOKE_CENT_ID, 4), kind: 'async' },
        ],
        { refundAddress: REFUND }
      )
    )

    expect(error?.message).to.contain('one vault per transaction')
    expect(actions).to.have.length(0)
  })

  it('records that the crosschain kill switch is a no-op today, so the guard is untested', () => {
    // The backend payload builders call `assertCrosschainMessagingEnabled`
    // because the local paths do, and dropping it on the new route would be a
    // silent behaviour change the day a chain is disabled again. It cannot be
    // covered by a behaviour test right now: the disabled list is EMPTY, and
    // `crosschainHotfix.ts` reads it into a module-level Set at import, which
    // an ES module cannot have stubbed ("ES Modules cannot be stubbed" —
    // sinon). A test written anyway would be one that cannot fail.
    //
    // So this asserts the precondition instead. The day someone puts a
    // centrifugeId back in that list, this case goes red and whoever does it
    // is pointed at the four call sites that need a real test.
    expect(TEMPORARILY_DISABLED_CROSSCHAIN_CENTRIFUGE_IDS).to.deep.equal([])
  })

  it('refuses a combined enable-and-deploy, which has no backend action', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const error = await failure(
      network.deploy(
        [{ id: SC_ID, hook: OTHER_FACTORY }],
        [{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'async' }],
        { refundAddress: REFUND }
      )
    )

    expect(error?.message).to.contain('deployShareClasses()')
    expect(actions).to.have.length(0)
  })

  it('refuses a caller-supplied vault factory', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const error = await failure(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'async', factory: OTHER_FACTORY }], {
        refundAddress: REFUND,
      })
    )

    expect(error?.message).to.contain('factory')
    expect(actions).to.have.length(0)
  })

  it('refuses a deployVault whose local build would carry a preamble', async () => {
    // Sending the action anyway would confirm a transaction that deploys a
    // linked vault nobody can invest through —
    // plausible success, wrong outcome. Each condition is checked on its own so
    // a guard that only fired for one of them cannot pass this.
    const cases: [string, Parameters<typeof stubDeployState>[1], string][] = [
      ['no request manager', { requestManager: '0x0000000000000000000000000000000000000000' }, 'setRequestManager'],
      ['async manager unset', { isAsyncManagerSet: false }, 'async request manager'],
      ['sync manager unset for a sync vault', { isSyncManagerSet: false }, 'sync manager'],
      ['share class not enabled here', { activeShareClasses: [] }, 'notifyShareClass'],
      ['pool not registered', { isActive: false, activeShareClasses: [] }, 'notifyPool'],
      ['adapters not set on the destination', { poolAdapters: [] }, 'setAdapters'],
    ]

    for (const [name, state, expected] of cases) {
      const { centrifuge, actions } = backendCentrifuge()
      const { network } = entities(centrifuge)
      stubDeployState(network, state)

      const error = await failure(
        network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }], {
          refundAddress: REFUND,
        })
      )

      expect(error?.message, name).to.contain(expected)
      expect(actions, name).to.have.length(0)
      sinon.restore()
    }
  })

  it('lets a deployVault through once the network is fully set up', async () => {
    // The inverse of the case above. Without this, a guard that refused
    // unconditionally would pass every refusal case — which is exactly the
    // test that cannot fail.
    const { centrifuge, actions } = backendCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    await firstValueFrom(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }], {
        refundAddress: REFUND,
      })
    )

    expect(actions).to.have.length(1)
  })

  it('keeps the maxReserve decimals guard on the backend route', async () => {
    // A caller-error guard, not an addressing one, so it stays on both paths:
    // a `Balance` scaled to the wrong currency reaches the chain as a
    // plausible number rather than as a failure.
    const { centrifuge, actions } = backendCentrifuge()
    const { vault } = entities(centrifuge)
    sinon.stub(centrifuge, 'currency').returns(makeThenable(of({ address: ASSET_ADDRESS, decimals: 6 })) as any)

    const error = await failure(vault.updateMaxReserve(Balance.fromFloat(250, 18), { refundAddress: REFUND }))

    expect(error?.message).to.contain('Invalid maxReserve decimals')
    expect(actions).to.have.length(0)
  })

  it('still accepts a ZERO maxReserve, which is a ceiling and not a movement', async () => {
    // Setting the reserve to zero pauses deposits into a linked sync-deposit
    // vault, which is a different operation from unlinking it. Neither path has
    // ever refused it and neither may start.
    const { centrifuge, actions } = backendCentrifuge()
    const { vault } = entities(centrifuge)
    sinon.stub(centrifuge, 'currency').returns(makeThenable(of({ address: ASSET_ADDRESS, decimals: 6 })) as any)

    await firstValueFrom(vault.updateMaxReserve(Balance.fromFloat(0, 6), { refundAddress: REFUND }))

    expect((actions[0]!.payload as any).maxReserve.amount).to.equal('0')
  })

  it('keeps the empty-edit refusals on the local path, unchanged', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDetails(network, [{ id: SC_ID, vaults: [] }])

    // Built rather than subscribed: `_transact` raises "Signer not set" before
    // the generator runs, which would mask the guard being checked.
    expect((await buildFailure(centrifuge, network.linkVaults([]))).message).to.contain('No vaults to link')
    expect((await buildFailure(centrifuge, network.unlinkVaults([]))).message).to.contain('No vaults to unlink')
  })
})

describe('vaults writes: calldata parity (backend builder vs local build)', () => {
  it('deployVault (async) is byte-equal to the local build', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const localBuilt = await centrifuge.buildOnly(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'async' }], {
        refundAddress: REFUND,
      })
    )
    const built = builders.deployVault(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      kind: 'async',
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
    })

    // Two calls: notifyAssetPrice + updateVault(DeployAndLink). No preamble,
    // which is the only shape the backend route accepts.
    expect(localBuilt.calls).to.have.length(2)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(localBuilt.value).to.equal(built.value)
  })

  it('deployVault (syncDeposit) is byte-equal, max-reserve leg included', async () => {
    // The sync-deposit shape adds a third call — the sync manager's MaxReserve
    // trusted call at uint128 max — and the builder restates both the constant
    // and the `encode()` padding rather than importing them. So this case is
    // the one that would catch a drift in either.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const localBuilt = await centrifuge.buildOnly(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }], {
        refundAddress: REFUND,
      })
    )
    const built = builders.deployVault(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      kind: 'syncDeposit',
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
    })
    const asyncSide = builders.deployVault(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      kind: 'async',
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
    })

    expect(localBuilt.calls).to.have.length(3)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.value).to.equal(built.value)
    // The control that keeps the assertion above from passing on a shared
    // wrong encoding: the two kinds must not produce the same calldata.
    expect(built.data).to.not.equal(asyncSide.data)
  })

  it('deployVault picks the same FACTORY as the registry does, per kind', async () => {
    // The factory address is the one field the SDK sends and the backend does
    // not, so a disagreement here would be invisible to the payload assertions
    // above and would show up only as different bytes. Both `deployVault`
    // parity cases already cover it implicitly; this names it, and the
    // inequality below is what makes the naming meaningful.
    const spoke = SPOKE_CONTEXT()
    expect(spoke.addresses.asyncVaultFactory).to.be.a('string')
    expect(spoke.addresses.syncDepositVaultFactory).to.be.a('string')
    expect(spoke.addresses.asyncVaultFactory).to.not.equal(spoke.addresses.syncDepositVaultFactory)
  })

  it('updateVaults (unlink) is byte-equal, multicall shape and order included', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDetails(network, [{ id: SC_ID, vaults: [{ address: VAULT_A }, { address: VAULT_B }] }])

    const localBuilt = await centrifuge.buildOnly(
      network.unlinkVaults([editTarget(VAULT_A), editTarget(VAULT_B)], { refundAddress: REFUND })
    )
    const built = builders.updateVaults(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
      unlink: [vaultRef(VAULT_A), vaultRef(VAULT_B)],
    })

    expect(localBuilt.calls).to.have.length(2)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(localBuilt.value).to.equal(built.value)
  })

  it('updateVaults (link) is byte-equal, and is a different encoding from unlink', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDetails(network, [{ id: SC_ID, vaults: [] }])
    // `linkVaults` re-reads the share class's vaults with the unlinked ones
    // included and encodes the PROJECTED address, so that read is answered.
    sinon.stub(network, 'vaults').returns(makeThenable(of([{ address: VAULT_A }])) as any)

    const localBuilt = await centrifuge.buildOnly(network.linkVaults([editTarget(VAULT_A)], { refundAddress: REFUND }))
    const built = builders.updateVaults(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
      link: [vaultRef(VAULT_A)],
    })
    const unlinkSide = builders.updateVaults(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
      unlink: [vaultRef(VAULT_A)],
    })

    // One call, so no multicall wrapper on either side — `encodeBatchCalldata`
    // sends a lone call verbatim in both packages, and that agreement is part
    // of what is being compared.
    expect(localBuilt.calls).to.have.length(1)
    expect(localBuilt.data).to.equal(built.data)
    // The control: `VaultUpdateKind.Link` (1) and `.Unlink` (2) are one word
    // apart, so a swapped ordinal would leave every other byte identical.
    expect(built.data).to.not.equal(unlinkSide.data)
  })

  it('updateMaxReserve is byte-equal, including the trusted-call payload', async () => {
    // The SDK builds the payload with `encode([MaxReserve, assetId, amount])`
    // and the builder restates that padding by hand
    // (`encodeMaxReserveTrustedCall`), so the three words are the substance of
    // this comparison. The builder is handed the asset id the backend would
    // have resolved from the projection — proving the two ENCODERS agree; that
    // the projection resolves the same asset the SDK holds is the read-parity
    // suites' question.
    const centrifuge = localCentrifuge()
    const { vault } = entities(centrifuge)
    sinon.stub(centrifuge, 'currency').returns(makeThenable(of({ address: ASSET_ADDRESS, decimals: 6 })) as any)

    const localBuilt = await centrifuge.buildOnly(vault.updateMaxReserve(MAX_RESERVE, { refundAddress: REFUND }))
    const built = builders.updateVaults(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
      maxReserve: {
        scId: SC_ID.raw,
        assetId: ASSET_ID.toString(),
        amount: MAX_RESERVE.toBigInt().toString(),
      },
    })
    const otherAmount = builders.updateVaults(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
      maxReserve: {
        scId: SC_ID.raw,
        assetId: ASSET_ID.toString(),
        amount: (MAX_RESERVE.toBigInt() + 1n).toString(),
      },
    })

    expect(localBuilt.calls).to.have.length(1)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(localBuilt.value).to.equal(built.value)
    // The control: the amount really is in the compared bytes.
    expect(built.data).to.not.equal(otherAmount.data)
  })

  it('the local path still builds the preamble the backend route refuses', async () => {
    // The condition `#assertNoDeployPreambleNeeded` refuses, shown to be real
    // rather than hypothetical: on a network with nothing set up, the local
    // build is a multicall of six, and no single-vault `deployVault` action
    // could carry it.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, {
      isActive: false,
      activeShareClasses: [],
      isAsyncManagerSet: false,
      isSyncManagerSet: false,
      requestManager: '0x0000000000000000000000000000000000000000',
    })

    const localBuilt = await centrifuge.buildOnly(
      network.deploy(
        [{ id: SC_ID, hook: OTHER_FACTORY }],
        [{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }],
        { refundAddress: REFUND }
      )
    )

    // notifyPool, 2x updateBalanceSheetManager, setRequestManager, notifyShareClass,
    // then the vault's three. (setAdapters is its own transaction, see the suite below.)
    expect(localBuilt.calls.length).to.be.greaterThan(3)
  })

  it('the cross-chain message manifests agree, so both sides price the same fee', async () => {
    // `value` is 0n on both sides here for different reasons (see the file
    // docstring), so the fee itself is not comparable in this suite. What IS
    // comparable is the manifest each side hands its pricer, and a mismatch
    // there is an under- or over-payment on the signing path rather than a
    // wrong transaction — worth pinning where it is cheap.
    //
    // One deliberate exception, and it is the backend's correction of an SDK
    // under-estimate: for a syncDeposit vault the backend's manifest lists the
    // `TrustedContractUpdate` its max-reserve leg dispatches and
    // `PoolNetwork.deploy` does not. Under-payment stalls a message after the
    // transaction has confirmed, so the extra entry is the safe direction.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network)

    const asyncLocal = await centrifuge.buildOnly(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'async' }], {
        refundAddress: REFUND,
      })
    )
    const asyncBuilt = builders.deployVault(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      kind: 'async',
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
    })

    expect(asyncLocal.messages?.[SPOKE_CENT_ID]).to.have.length(2)
    expect(asyncBuilt.messages?.[SPOKE_CENT_ID]).to.have.length(2)

    const syncLocal = await centrifuge.buildOnly(
      network.deployVaults([{ shareClassId: SC_ID, assetId: ASSET_ID, kind: 'syncDeposit' }], {
        refundAddress: REFUND,
      })
    )
    const syncBuilt = builders.deployVault(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      kind: 'syncDeposit',
      refundAddress: REFUND,
      spoke: SPOKE_CONTEXT(),
    })

    // The SDK lists two for three payable calls; the backend lists three.
    expect(syncLocal.messages?.[SPOKE_CENT_ID]).to.have.length(2)
    expect(syncBuilt.messages?.[SPOKE_CENT_ID]).to.have.length(3)
  })
})

function hubCalls(data: HexString): string[] {
  const outer = decodeFunctionData({ abi: ABI.Hub, data })
  const inner = outer.functionName === 'multicall' ? (outer.args![0] as readonly HexString[]) : [data]
  return inner.map((call) => decodeFunctionData({ abi: ABI.Hub, data: call }).functionName)
}

/** A signing-mode SDK whose wallet is a stub and whose statuses are collected. */
function signingCentrifuge(publicClient?: Record<string, unknown>) {
  const centrifuge = localCentrifuge()
  const sendTransaction = sinon.stub()
  sendTransaction.resolves(HASH_2)
  sendTransaction.onFirstCall().resolves(HASH_1)
  sinon.stub(centrifuge as any, '_estimate').resolves(0n)
  const statuses: any[] = []
  // Entities bind `_transact` at construction, so the fake context goes in first. Like the real
  // one, it takes a generator or an observable and flattens an observable the generator yields;
  // items of a nested transaction were already recorded by the `_transact` call that ran it.
  sinon.stub(centrifuge as any, '_transact').callsFake(async (cb: any, centrifugeId: any) => {
    const relay = (nested: Observable<unknown>) => lastValueFrom(nested.pipe(toArray()))
    const result = cb({
      centrifugeId,
      signingAddress: REFUND,
      isBatching: false,
      signal: new AbortController().signal,
      root: centrifuge,
      publicClient: publicClient ?? (await centrifuge.getClient(HUB_CENT_ID)),
      walletClient: { sendTransaction, getChainId: async () => HUB_CHAIN_ID },
    })
    if (isObservable(result)) {
      await relay(result)
      return
    }
    for await (const status of result) {
      if (isObservable(status)) await relay(status)
      else statuses.push(status)
    }
  })
  return { centrifuge, sendTransaction, statuses }
}

describe('vaults writes: first activation sends setAdapters with the pool messages (v3.2)', () => {
  // `MultiAdapter.handle` on the destination rejects every message of a pool it has no adapters
  // for. The pool messages are sent with `setAdapters` anyway, and re-executed at the bridge if
  // they arrive first. These cases pin the single Hub batch and the decisions `deploy` takes from
  // the indexer's pool adapter rows.

  const deployShareClass = (network: PoolNetwork) => network.deployShareClasses([{ id: SC_ID, hook: OTHER_FACTORY }])

  it('skips setAdapters when the indexer shows the pool wired on both sides', async () => {
    // The indexer rows, not the hub-side share class state, decide: a deployment that is re-run
    // after a stuck first attempt must not send `setAdapters` again.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, { isActive: false, activeShareClasses: [] })

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

    const calls = hubCalls(built.data)
    expect(calls).to.not.include('setAdapters')
    expect(calls).to.include('notifyPool')
    expect(calls).to.include('notifyShareClass')
  })

  it('builds setAdapters at the head of the Hub batch, before the pool messages', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, { isActive: false, activeShareClasses: [], poolAdapters: [] })

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

    const calls = hubCalls(built.data)
    expect(calls[0]).to.equal('setAdapters')
    expect(calls.indexOf('notifyPool')).to.equal(1)
    expect(calls).to.include('notifyShareClass')
    expect(built.messages![SPOKE_CENT_ID]![0]).to.deep.equal({ type: MessageType.SetPoolAdapters, poolId: POOL_ID })
    // Whoever signs the built transaction prices the pool's messages against the adapter it installs.
    expect(built.pendingPoolAdapters).to.deep.equal({
      [SPOKE_CENT_ID]: [protocolContext(HUB_CENT_ID).addresses.layerZeroAdapter],
    })
  })

  it("copies the protocol's global adapter set, every bridge and its threshold, rather than picking one bridge", async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    const local = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ] as HexString[]
    const remote = [
      '0x3333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444',
    ] as HexString[]
    sinon.stub(PoolNetwork.prototype, '_globalAdapterSet').resolves({
      local,
      remote,
      threshold: 2,
      recoveryIndex: 2,
      names: ['layerZero', 'axelar'],
    })
    stubDeployState(network, { isActive: false, activeShareClasses: [], poolAdapters: [] })

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

    const outer = decodeFunctionData({ abi: ABI.Hub, data: built.data })
    const setAdapters = decodeFunctionData({ abi: ABI.Hub, data: (outer.args![0] as readonly HexString[])[0]! })
    expect(setAdapters.functionName).to.equal('setAdapters')
    const [localArg, remoteArg, threshold, recoveryIndex] = setAdapters.args!.slice(2, 6) as [
      HexString[],
      HexString[],
      number,
      number,
    ]
    expect([localArg.map((a) => a.toLowerCase()), remoteArg, threshold, recoveryIndex]).to.deep.equal([
      local,
      remote.map((address) => `${address}${'0'.repeat(24)}`),
      2,
      2,
    ])
    expect(built.pendingPoolAdapters).to.deep.equal({ [SPOKE_CENT_ID]: local })
  })

  it('stops before building anything when the protocol has no global adapters toward the network', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    sinon
      .stub(PoolNetwork.prototype, '_globalAdapterSet')
      .resolves({ local: [], remote: [], threshold: 0, recoveryIndex: 0, names: [] })
    stubDeployState(network, { isActive: false, activeShareClasses: [], poolAdapters: [] })

    const error = await centrifuge
      .buildOnly(deployShareClass(network), { fromAddress: REFUND })
      .then(() => null)
      .catch((e: Error) => e)

    expect(error?.message).to.contain('has no global adapters')
  })

  it('signs the activation as one transaction, without waiting for the adapters to arrive', async () => {
    const { centrifuge, sendTransaction, statuses } = signingCentrifuge()
    const { network } = entities(centrifuge)
    let spokeReads = 0
    stubDeployState(network, {
      isActive: false,
      activeShareClasses: [],
      poolAdapters: (local) => {
        if (local === SPOKE_CENT_ID) spokeReads++
        return []
      },
    })

    await deployShareClass(network)

    expect(sendTransaction.callCount).to.equal(1)
    const calls = hubCalls(sendTransaction.firstCall.args[0].data)
    expect(calls[0]).to.equal('setAdapters')
    expect(calls).to.include('notifyPool')
    expect(spokeReads).to.equal(1)
    expect(statuses.map((s) => s.type)).to.not.include('AwaitingCrosschainDelivery')
    // The hub holds no pool set yet, so the pool's batch is priced against the LayerZero adapter being installed.
    const estimate = (centrifuge as any)._estimate as sinon.SinonStub
    expect(estimate.firstCall.args[3]).to.deep.equal([protocolContext(HUB_CENT_ID).addresses.layerZeroAdapter])
  })

  it('prices a wired deployment against the MultiAdapter, with no pending adapters', async () => {
    const { centrifuge } = signingCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, { isActive: false, activeShareClasses: [] })

    await deployShareClass(network)

    expect(((centrifuge as any)._estimate as sinon.SinonStub).firstCall.args[3]).to.equal(undefined)
  })

  it('does not skip setAdapters when only one side is configured', async () => {
    // A `SetPoolAdapters` that never arrived leaves the hub configured and the spoke not; a
    // spoke set up by ops leaves the opposite. Either way the pool messages cannot flow yet.
    for (const configuredSide of [HUB_CENT_ID, SPOKE_CENT_ID]) {
      const centrifuge = localCentrifuge()
      const { network } = entities(centrifuge)
      stubDeployState(network, {
        isActive: false,
        activeShareClasses: [],
        poolAdapters: (local) => (local === configuredSide ? [LZ_LIVE] : []),
      })

      const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

      expect(hubCalls(built.data)[0], `configured on ${configuredSide}`).to.equal('setAdapters')
      sinon.restore()
    }
  })

  it('sends the pool messages, without setAdapters, while the spoke is still receiving it', async () => {
    // The indexer creates the spoke row when the hub sends the message and marks it in flight
    // until the spoke executes it; the set is not sent twice, and the pool messages do not wait.
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, {
      isActive: false,
      activeShareClasses: [],
      poolAdapters: (local) => (local === HUB_CENT_ID ? [LZ_LIVE] : [LZ_IN_FLIGHT]),
    })

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

    const calls = hubCalls(built.data)
    expect(calls).to.not.include('setAdapters')
    expect(calls).to.include('notifyPool')
  })

  it('sends setAdapters again when the hub holds the LayerZero set but the spoke never got it', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, {
      isActive: false,
      activeShareClasses: [],
      poolAdapters: (local) => (local === HUB_CENT_ID ? [LZ_LIVE] : [AXELAR_LIVE]),
    })

    const built = await centrifuge.buildOnly(deployShareClass(network), { fromAddress: REFUND })

    expect(hubCalls(built.data)[0]).to.equal('setAdapters')
  })

  it('does not overwrite a hub set that is not the LayerZero one the SDK configures', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, {
      isActive: false,
      activeShareClasses: [],
      poolAdapters: (local) => (local === HUB_CENT_ID ? [AXELAR_LIVE] : []),
    })

    const error = await buildFailure(centrifuge, deployShareClass(network))

    expect(error?.message).to.contain('does not overwrite')
    expect(error?.message).to.contain('[axelar]')
  })

  it('names the pool and the data source when the adapter rows cannot be read', async () => {
    const centrifuge = localCentrifuge()
    const { network } = entities(centrifuge)
    stubDeployState(network, { isActive: false, activeShareClasses: [] })
    ;((centrifuge as any)._queryDataOnce as sinon.SinonStub).rejects(new Error('upstream 502'))

    const error = await buildFailure(centrifuge, deployShareClass(network))

    expect(error?.message).to.contain(`pool "${POOL_ID}"`)
    expect(error?.message).to.contain('data source')
    expect(error?.message).to.contain('upstream 502')
  })

  it('stops when either side holds an adapter the indexer cannot name, rather than trusting it', async () => {
    const unknown: PoolAdapterState = { name: 'unknown', isEnabled: true, crosschainInProgress: null }
    for (const poolAdapters of [
      () => [unknown],
      (local: number) => (local === HUB_CENT_ID ? [LZ_LIVE] : [LZ_LIVE, unknown]),
    ]) {
      const centrifuge = localCentrifuge()
      const { network } = entities(centrifuge)
      stubDeployState(network, { isActive: false, activeShareClasses: [], poolAdapters })

      const error = await buildFailure(centrifuge, deployShareClass(network))

      expect(error?.message).to.contain('cannot name')
      sinon.restore()
    }
  })
})

describe('vaults writes: deployToNetworks', () => {
  const SPOKE_2_CENT_ID = 3

  /** `deploy()` on every network of the pool, with the indexer rows per chain and no vault preamble. */
  function stubNetworks(centrifuge: Centrifuge, poolAdapters: (localCentrifugeId: number) => PoolAdapterState[]) {
    sinon
      .stub(PoolNetwork.prototype, 'details')
      .returns(makeThenable(of({ isActive: false, activeShareClasses: [] })) as any)
    const poolAdaptersOnce = async (name: string, vars: any) => {
      if (name !== 'poolAdapters') throw new Error(`unexpected data query "${name}"`)
      return poolAdapters(Number(vars.localCentrifugeId)).map((row) => ({
        adapterAddress: `0x${'0'.repeat(40)}`,
        isEnabled: row.isEnabled,
        crosschainInProgress: row.crosschainInProgress,
        adapter: { name: row.name },
      }))
    }
    sinon.stub(centrifuge as any, '_queryDataOnce').callsFake(poolAdaptersOnce as any)
    chainRead = async ({ functionName }) => (functionName === 'requestManager' ? OTHER_FACTORY : true)
    return sinon
      .stub(centrifuge, 'batchTransactions')
      .callsFake((title: string) => of({ type: 'Batched', title }) as any)
  }

  const twoNetworks = (pool: Pool) =>
    pool.deployToNetworks([
      { centrifugeId: SPOKE_CENT_ID, shareClasses: [{ id: SC_ID, hook: OTHER_FACTORY }] },
      { centrifugeId: SPOKE_2_CENT_ID, shareClasses: [{ id: SC_ID, hook: OTHER_FACTORY }] },
    ])

  it('batches the deployments into one transaction when every network is wired', async () => {
    const { centrifuge, sendTransaction } = signingCentrifuge()
    const batchTransactions = stubNetworks(centrifuge, () => [LZ_LIVE])
    const { pool } = entities(centrifuge)

    await twoNetworks(pool)

    expect(batchTransactions.callCount).to.equal(1)
    expect(batchTransactions.firstCall.args[1]).to.have.length(2)
    expect(sendTransaction.callCount).to.equal(0)
  })

  it('still batches the deployments into one transaction on v3.2 when a network needs its adapters', async () => {
    const { centrifuge, sendTransaction } = signingCentrifuge()
    const batchTransactions = stubNetworks(centrifuge, (local) => (local === SPOKE_2_CENT_ID ? [] : [LZ_LIVE]))
    const { pool } = entities(centrifuge)

    await twoNetworks(pool)

    expect(batchTransactions.callCount).to.equal(1)
    expect(sendTransaction.callCount).to.equal(0)
  })

  it('refuses to be batched or built', async () => {
    const centrifuge = localCentrifuge()
    stubNetworks(centrifuge, () => [LZ_LIVE])
    const { pool } = entities(centrifuge)

    const error = await buildFailure(centrifuge, twoNetworks(pool))

    expect(error?.message).to.contain('cannot be batched or built')
  })
})
