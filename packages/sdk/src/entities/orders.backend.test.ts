import { stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { builders, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { Balance, Price } from '../utils/BigInt.js'
import { addressToBytes32 } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

/**
 * Orders write acceptance: routing, payloads, refusals, calldata parity, the
 * cross-chain message manifest, and the `msg.value` strategy.
 *
 * The same three rules as `holdings.backend.test.ts`:
 *
 * 1. **The SDK side of every parity assertion is captured, not re-encoded.**
 *    It is what `buildOnly` hands the signing path — the same bytes
 *    `wrapTransaction` sends — never an `encodeFunctionData` written in this
 *    file, which would only prove the test agrees with itself.
 * 2. **The backend side is fed the SDK's OWN payload.** The `PoolAction` is
 *    captured out of a recording `TxStrategy` and handed to
 *    `@centrifuge/protocol`'s builder — the same function
 *    `ProtocolTxBuilder.build()` calls in `apps/private-api`. So the comparison
 *    covers the payload mapping as well as the encoding, and a wrong `epochId`
 *    or a dropped `refundAddress` fails it.
 * 3. **`_protocolContext` is never stubbed.** Both sides resolve
 *    `batchRequestManager` from the one bundled deployment registry, or the
 *    byte comparison says nothing about the real deployment.
 *
 * The chain reads ARE faked, and the fake is built from the shape the real
 * caller produces: `readContract` dispatches on `functionName` and keys the
 * per-investor reads on the `bytes32 investor` argument, exactly as
 * `BatchRequestManager`'s mappings do. That is what lets the corrupted-address
 * case below be demonstrated rather than asserted.
 *
 * No indexer, no RPC, no Tenderly fork.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'

/** Pool on centrifugeId 1 (ethereum), which is also the hub for these actions. */
const POOL_ID = PoolId.from(1, 7)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const HUB_CHAIN_ID = 1
const SPOKE_CENT_ID = 2
const SPOKE_CHAIN_ID = 8453

/** An asset on ANOTHER network: its `RequestCallback` crosses the bridge. */
const REMOTE_ASSET = AssetId.from(SPOKE_CENT_ID, 3)
/** An asset on the pool's OWN chain: `MessageDispatcher` short-circuits it. */
const LOCAL_ASSET = AssetId.from(HUB_CENT_ID, 4)

const SIGNER_ADDRESS = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as HexString
const REFUND = '0x1231231231231231231231231231231231231231' as HexString
const OTHER_REFUND = '0x4564564564564564564564564564564564564564' as HexString
const INVESTOR = '0x19f46d81ba9b0e0a5e2bb9d9e1a3f0c8b7a6d5e4' as HexString
/**
 * The same investor as `chain_v1.{invest,redeem}_order.account` projects him:
 * decoded with the LEFT-padded `bytes32` convention against a protocol that
 * RIGHT-pads, so what survives is the address's LAST 8 bytes followed by 12
 * zero bytes. The shape Embrio's enrichment produces on the async path — 463 of
 * 463 rows there, and 323 of 323 on the redeem side.
 */
const CORRUPTED_INVESTOR = `0x${INVESTOR.slice(-16)}${'0'.repeat(24)}` as HexString

const APPROVE_ASSETS = Balance.fromFloat(1000, 6)
const APPROVE_PRICE = Price.fromFloat(1.02)
const APPROVE_SHARES = Balance.fromFloat(25, 18)
const ISSUE_PRICE = Price.fromFloat(1.25)
const ISSUE_PRICE_2 = Price.fromFloat(1.26)

/** Epoch state the fake chain reports, per `(assetId)`. */
interface EpochState {
  depositEpoch: number
  issueEpoch: number
  redeemEpoch: number
  revokeEpoch: number
}

const EPOCHS: EpochState = { depositEpoch: 5, issueEpoch: 3, redeemEpoch: 9, revokeEpoch: 7 }

/** A captured `eth_sendTransaction` request. */
interface SentTx {
  to: HexString
  data: HexString
  value: bigint
}

function recordingSigner(chainId: number) {
  const sent: SentTx[] = []
  const signer = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [SIGNER_ADDRESS]
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'eth_sendTransaction': {
          const tx = params![0]
          sent.push({
            to: tx.to as HexString,
            data: (tx.data ?? '0x') as HexString,
            value: tx.value === undefined ? 0n : BigInt(tx.value),
          })
          return `0x${'11'.repeat(32)}`
        }
        default:
          throw new Error(`recordingSigner: unexpected RPC method "${method}"`)
      }
    },
  }
  return { signer, sent }
}

/**
 * A public client that answers the `BatchRequestManager` reads the order paths
 * make, dispatching on `functionName` the way the real one does.
 *
 * `knownInvestor` is the ONLY key the per-investor mappings hold, keyed by the
 * RIGHT-padded `bytes32` the protocol stores — so a caller that arrives with
 * any other spelling of the address reads the contract's zero value, which is
 * what an unset `UserOrder` really is.
 */
function fakeChain(options: { epochs?: EpochState; knownInvestor?: HexString; claims?: number } = {}) {
  const epochs = options.epochs ?? EPOCHS
  const known = options.knownInvestor ? addressToBytes32(options.knownInvestor).toLowerCase() : undefined
  const claims = options.claims ?? 1
  const isKnown = (investor: unknown) => known !== undefined && String(investor).toLowerCase() === known

  return {
    getCode: async () => undefined,
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      switch (functionName) {
        case 'nowDepositEpoch':
          return epochs.depositEpoch
        case 'nowIssueEpoch':
          return epochs.issueEpoch
        case 'nowRedeemEpoch':
          return epochs.redeemEpoch
        case 'nowRevokeEpoch':
          return epochs.revokeEpoch
        // `maxDepositClaims(poolId, scId, investor, assetId)` — investor third.
        case 'maxDepositClaims':
        case 'maxRedeemClaims':
          return isKnown(args[2]) ? claims : 0
        // `depositRequest(poolId, scId, assetId, investor)` — investor fourth.
        case 'depositRequest':
        case 'redeemRequest':
          return isKnown(args[3]) ? [10n ** 18n, 0] : [0n, 0]
        case 'queuedDepositRequest':
        case 'queuedRedeemRequest':
          return [false, 0n]
        // The crosschain fee the LOCAL path prices its manifest with. The two
        // numbers are live measurements: 487,788 gas per
        // `RequestCallback`, against the 10,000,000 `maxBatchGasLimit` the
        // gas service DECLARES — which is not the effective cap (2,996,000 on
        // the worst route measured, i.e. six messages). That gap is why the
        // backend payload carries an explicit page instead of a gas budget.
        case 'messageOverallGasLimit':
          return 487_788n
        case 'maxBatchGasLimit':
          return 10_000_000n
        case 'estimate':
          return 104_462_138_864_007n
        default:
          throw new Error(`fakeChain: unexpected read "${functionName}"`)
      }
    },
  }
}

function stubChain(centrifuge: Centrifuge, client: unknown) {
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() => thenable(client))
}

function entities(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  return { pool, shareClass: new ShareClass(centrifuge, pool, SC_ID.raw) }
}

/** A strategy that records the action and answers on the custodial route. */
function recordingStrategy(outcome?: PrepareOutcome) {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of(
        outcome ??
          ({ route: 'custodial', txId: 'tx-sdk-12', signerType: 'fordefi', status: 'pending_approval' } as const)
      )
    },
    async confirm() {},
  }
  return { strategy, actions }
}

function backendCentrifuge(options: Parameters<typeof fakeChain>[0] = {}, outcome?: PrepareOutcome) {
  const { strategy, actions } = recordingStrategy(outcome)
  const centrifuge = new Centrifuge({
    environment: ENVIRONMENT,
    disableRepeatOnEvents: true,
    dataSource: { query: () => of({}) } as any,
    txStrategy: strategy,
  })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge, fakeChain(options))
  return { centrifuge, actions }
}

/** A default-configured SDK: no seams, so the write table is never consulted. */
function localCentrifuge(options: Parameters<typeof fakeChain>[0] = {}) {
  const centrifuge = new Centrifuge({ environment: ENVIRONMENT, disableRepeatOnEvents: true })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge, fakeChain(options))
  return centrifuge
}

/** The pure-builder context for a hub-side order action. */
function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, { environment: ENVIRONMENT, centrifugeId })
}

/**
 * Stub the two projection reads the LOCAL order paths compose, so a local build
 * can run at all.
 *
 * Both are catalogue-backed (`investOrderState` / `redeemOrderState`) and both
 * answer 503 `NOT_YET_PROJECTED` in backend mode, which is precisely why the
 * backend payload reads its epochs from the chain instead. The epoch numbers
 * here are the same ones `fakeChain` reports, so the two paths act on the same
 * epochs and the byte comparison is about the ENCODING rather than about which
 * epoch each side picked.
 */
function stubProjection(
  shareClass: ShareClass,
  assets: AssetId[],
  orders: { investor: HexString; assetId: AssetId }[] = [],
  epochs: EpochState = EPOCHS
) {
  const byVault = assets.map((assetId) => ({
    assetId,
    centrifugeId: assetId.centrifugeId,
    pendingDeposit: Balance.fromFloat(100_000, 6),
    pendingRedeem: Balance.fromFloat(100_000, 18),
    pendingIssuances: [],
    pendingRevocations: [],
    queuedInvest: Balance.fromFloat(0, 6),
    queuedRedeem: Balance.fromFloat(0, 18),
    assetPrice: Price.fromFloat(1),
    depositEpoch: epochs.depositEpoch,
    redeemEpoch: epochs.redeemEpoch,
    issueEpoch: epochs.issueEpoch,
    revokeEpoch: epochs.revokeEpoch,
  }))
  sinon.stub(shareClass, 'pendingAmounts').returns(makeThenable(of({ byVault, shareClassTotals: {} })) as any)
  sinon
    .stub(shareClass, '_investOrders')
    .returns(
      makeThenable(of({ investOrders: orders.map((o) => ({ ...o, issuedAt: null })) })) as any
    )
  sinon
    .stub(shareClass, '_redeemOrders')
    .returns(
      makeThenable(of({ redeemOrders: orders.map((o) => ({ ...o, revokedAt: null })) })) as any
    )
}

/** Run a local transaction to completion against the recording wallet. */
async function sendLocally(centrifuge: Centrifuge, tx: any, chainId: number): Promise<SentTx[]> {
  const { signer, sent } = recordingSigner(chainId)
  centrifuge.setSigner(signer as any)
  await firstValueFrom(tx.pipe(toArray()))
  return sent
}

/** `{ destination -> message type names }`, the shape both manifests reduce to. */
function manifestOf(messages: Record<number | string, readonly { type: number }[]> | undefined) {
  const out: Record<string, string[]> = {}
  for (const [destination, list] of Object.entries(messages ?? {})) {
    out[String(destination)] = list.map((message) => MessageType[message.type] ?? String(message.type))
  }
  return out
}

afterEach(() => {
  sinon.restore()
})

describe('orders writes: routing', () => {
  it('routes the four epoch actions the backend ships builders for, and no notify action', () => {
    const writes = backendRoutingTable().writes
    const ordersActions = ['approveDeposits', 'issueShares', 'approveRedeems', 'revokeShares']
    expect(Object.fromEntries(ordersActions.map((action) => [action, writes[action]]))).to.deep.equal({
      approveDeposits: 'backend',
      issueShares: 'backend',
      approveRedeems: 'backend',
      revokeShares: 'backend',
    })
    // There is no standalone notify action to route `claimDeposit()` /
    // `claimRedeem()` to, and there deliberately is not one: the backend
    // carries notification only as the `notify` tail of issue/revoke, and that
    // tail answers 503 while `chain_v1.{invest,redeem}_order.account` is
    // corrupted. Those two methods stay on the local build, where the investor
    // is caller-supplied.
    expect(writes.notifyDeposit).to.equal(undefined)
    expect(writes.notifyRedeem).to.equal(undefined)
    // The holdings rows are untouched by the orders rows.
    expect(writes.createHolding).to.equal('backend')
  })

  it('routes an approve-only deposit call to approveDeposits, with the epoch from the chain', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE }],
        { refundAddress: REFUND }
      )
    )

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('approveDeposits')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      approvals: [
        {
          assetId: REMOTE_ASSET.toString(),
          // `nowDepositEpoch`, read from BatchRequestManager. Never derived
          // from `pendingAmounts()`, which cannot run in backend mode.
          epochId: String(EPOCHS.depositEpoch),
          approvedAssetAmount: APPROVE_ASSETS.toBigInt().toString(),
          pricePoolPerAsset: APPROVE_PRICE.toBigInt().toString(),
        },
      ],
      refundAddress: REFUND,
    })
  })

  it('routes an issue-only call to issueShares, as an explicit epoch page with no notify tail', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveDepositsAndIssueShares([{ assetId: REMOTE_ASSET, issuePricePerShare: ISSUE_PRICE }], {
        refundAddress: REFUND,
      })
    )

    expect(actions[0]!.action).to.equal('issueShares')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      issuances: [
        {
          assetId: REMOTE_ASSET.toString(),
          fromEpochId: String(EPOCHS.issueEpoch),
          // Two epochs outstanding (5 - 3), one price each. The page is
          // explicit on the wire; no `GAS_LIMIT / estimatePerMessage` anywhere.
          navPerShare: [ISSUE_PRICE.toBigInt().toString(), ISSUE_PRICE.toBigInt().toString()],
        },
      ],
      refundAddress: REFUND,
    })
    // The blocked half, absent rather than empty: `notify` is 503
    // NOT_YET_PROJECTED server-side while `invest_order.account` is corrupted.
    expect(actions[0]!.payload).to.not.have.property('notify')
  })

  it('honours a per-epoch price array as the page LIMIT', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, issuePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    expect((actions[0]!.payload as any).issuances[0].navPerShare).to.deep.equal([
      ISSUE_PRICE.toBigInt().toString(),
      ISSUE_PRICE_2.toBigInt().toString(),
    ])
  })

  it('routes an approve-only redeem call to approveRedeems, with NO refund address', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    expect(actions[0]!.action).to.equal('approveRedeems')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      approvals: [
        {
          assetId: REMOTE_ASSET.toString(),
          epochId: String(EPOCHS.redeemEpoch),
          approvedShareAmount: APPROVE_SHARES.toBigInt().toString(),
          pricePoolPerAsset: APPROVE_PRICE.toBigInt().toString(),
        },
      ],
    })
    // `BatchRequestManager.approveRedeems` has no `refund` parameter and
    // dispatches nothing; the contract has no `receive`, so wei attached here
    // is stranded. The absence is the statement.
    expect(actions[0]!.payload).to.not.have.property('refundAddress')
  })

  it('routes a revoke-only call to revokeShares', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveRedeemsAndRevokeShares([{ assetId: REMOTE_ASSET, revokePricePerShare: ISSUE_PRICE }], {
        refundAddress: REFUND,
      })
    )

    expect(actions[0]!.action).to.equal('revokeShares')
    expect((actions[0]!.payload as any).revocations).to.deep.equal([
      {
        assetId: REMOTE_ASSET.toString(),
        fromEpochId: String(EPOCHS.revokeEpoch),
        // 9 - 7 = two outstanding epochs.
        navPerShare: [ISSUE_PRICE.toBigInt().toString(), ISSUE_PRICE.toBigInt().toString()],
      },
    ])
    expect(actions[0]!.payload).to.not.have.property('notify')
  })

  it('omits the refund address when every named asset is on the pool’s own chain', async () => {
    // The builder REFUSES a refund address it has nothing to refund, so sending
    // one for a purely local batch is a 422 rather than a harmless extra field.
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveDepositsAndIssueShares([
        { assetId: LOCAL_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    expect(actions[0]!.payload).to.not.have.property('refundAddress')
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    const centrifuge = localCentrifuge()
    const { shareClass } = entities(centrifuge)
    stubProjection(shareClass, [REMOTE_ASSET])

    const sent = await sendLocally(
      centrifuge,
      shareClass.approveDepositsAndIssueShares([
        { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      ]),
      HUB_CHAIN_ID
    )

    expect(sent).to.have.length(1)
  })
})

describe('orders writes: refusals rather than plausible defaults', () => {
  it('refuses a MIXED approve+issue call rather than falling back to the local build', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveDepositsAndIssueShares(
          [
            { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
            { assetId: LOCAL_ASSET, issuePricePerShare: ISSUE_PRICE },
          ],
          { refundAddress: REFUND }
        )
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('approveDeposits')
    expect(error?.message).to.contain('issueShares')
    // Refused BEFORE preparing anything: no orphaned backend row, and — the
    // point — no silent wallet signature for a pool action.
    expect(actions).to.have.length(0)
  })

  it('refuses a single entry carrying BOTH key sets', async () => {
    // The shape the local loop runs through both branches in one iteration.
    // Without this case the "mixed" refusal above would pass on an array-level
    // check alone and this payload would reach the backend as an approval,
    // silently dropping the issuance.
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveDepositsAndIssueShares(
          [
            {
              assetId: REMOTE_ASSET,
              approveAssetAmount: APPROVE_ASSETS,
              approvePricePerAsset: APPROVE_PRICE,
              issuePricePerShare: ISSUE_PRICE,
            } as any,
          ],
          { refundAddress: REFUND }
        )
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('both an approval and an issuance')
    expect(actions).to.have.length(0)
  })

  it('refuses a mixed approve+revoke call too', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveRedeemsAndRevokeShares(
          [
            { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
            { assetId: LOCAL_ASSET, revokePricePerShare: ISSUE_PRICE },
          ],
          { refundAddress: REFUND }
        )
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('approveRedeems')
    expect(error?.message).to.contain('revokeShares')
    expect(actions).to.have.length(0)
  })

  it('refuses a remote-asset approval with no refundAddress, and names why', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveDepositsAndIssueShares([
          { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
        ])
      )
    } catch (e) {
      error = e
    }

    // Defaulting to the connected wallet is the plausible wrong value: on the
    // custodial route the signer is the pool's Fordefi vault.
    expect(error?.message).to.contain('refundAddress')
    expect(error?.message).to.contain('Fordefi')
    expect(actions).to.have.length(0)
  })

  it('still batches a MIXED call on the local path, unchanged', async () => {
    // The inverse of the refusal above, and the one that matters for public
    // mode: the new refusal must not become a requirement for callers who have
    // never had a backend. The local build batches approve and issue in ONE
    // multicall — which is precisely the shape no single `PoolAction` can
    // express, and therefore the reason the backend route refuses it.
    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET, LOCAL_ASSET])

    const built = await local.buildOnly(
      localEntities.shareClass.approveDepositsAndIssueShares([
        { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
        { assetId: LOCAL_ASSET, issuePricePerShare: ISSUE_PRICE },
      ])
    )

    // One `approveDeposits` plus two `issueShares` (epochs 3 and 4).
    expect(built.calls).to.have.length(3)
  })

  it('still defaults the refund address to the signer on the local path', async () => {
    // The other inverse: `{ refundAddress }` is REQUIRED only in backend mode.
    // A public-mode caller who has never passed one keeps today's behaviour,
    // with `ctx.signingAddress` as the refund — checked by encoding the same
    // call with the option set to the signer and comparing bytes.
    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const sent = await sendLocally(
      local,
      localEntities.shareClass.approveDepositsAndIssueShares([
        { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      ]),
      HUB_CHAIN_ID
    )

    const explicit = builders.approveDeposits(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      approvals: [
        {
          assetId: REMOTE_ASSET.toString(),
          epochId: String(EPOCHS.depositEpoch),
          approvedAssetAmount: APPROVE_ASSETS.toBigInt().toString(),
          pricePoolPerAsset: APPROVE_PRICE.toBigInt().toString(),
        },
      ],
      refundAddress: SIGNER_ADDRESS,
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(explicit.data)
  })

  it('refuses a repeated asset on both paths', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)
    const twice = [
      { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      { assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
    ]

    let backendError: any
    try {
      await firstValueFrom(shareClass.approveDepositsAndIssueShares(twice, { refundAddress: REFUND }))
    } catch (e) {
      backendError = e
    }
    expect(backendError?.message).to.contain('multiple entries for the same asset ID')
    expect(actions).to.have.length(0)

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    let localError: any
    try {
      await sendLocally(local, localEntities.shareClass.approveDepositsAndIssueShares(twice), HUB_CHAIN_ID)
    } catch (e) {
      localError = e
    }
    expect(localError?.message).to.contain('multiple entries for the same asset ID')
  })

  it('refuses a zero approval on the backend route, as the local path already did', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveDepositsAndIssueShares(
          [
            {
              assetId: REMOTE_ASSET,
              approveAssetAmount: Balance.fromFloat(0, 6),
              approvePricePerAsset: APPROVE_PRICE,
            },
          ],
          { refundAddress: REFUND }
        )
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('must be greater than 0')
    expect(actions).to.have.length(0)
  })

  it('refuses an issuance when the chain says there is nothing to issue', async () => {
    // `nowIssueEpoch == nowDepositEpoch`: every approved epoch is already
    // issued. The local path throws 'Nothing to issue'; a backend payload with
    // an empty page would be a transaction that costs a signature and does
    // nothing, so it must not be built.
    const { centrifuge, actions } = backendCentrifuge({
      epochs: { ...EPOCHS, depositEpoch: 3, issueEpoch: 3 },
    })
    const { shareClass } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(
        shareClass.approveDepositsAndIssueShares([{ assetId: REMOTE_ASSET, issuePricePerShare: ISSUE_PRICE }], {
          refundAddress: REFUND,
        })
      )
    } catch (e) {
      error = e
    }

    expect(error?.message).to.equal('Nothing to issue')
    expect(actions).to.have.length(0)
  })
})

describe('orders writes: calldata parity (backend builder vs local build)', () => {
  it('approveDeposits is byte-equal, and the builder is fed the SDK’s own payload', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE }],
        { refundAddress: REFUND }
      )
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE }],
        { refundAddress: REFUND }
      )
    )

    const built = builders.approveDeposits(protocolContext(HUB_CENT_ID), actions[0]!.payload as any)

    expect(localBuilt.calls).to.have.length(1)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(localBuilt.value).to.equal(built.value)

    // Controls. Neither side is producing a constant: a different epoch and a
    // different refund address each change the bytes.
    const otherEpoch = builders.approveDeposits(protocolContext(HUB_CENT_ID), {
      ...(actions[0]!.payload as any),
      approvals: [{ ...(actions[0]!.payload as any).approvals[0], epochId: '6' }],
    })
    expect(otherEpoch.data).to.not.equal(built.data)
    const otherRefund = builders.approveDeposits(protocolContext(HUB_CENT_ID), {
      ...(actions[0]!.payload as any),
      refundAddress: OTHER_REFUND,
    })
    expect(otherRefund.data).to.not.equal(built.data)
  })

  it('issueShares is byte-equal across a two-epoch page, multicall shape included', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, issuePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, issuePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    const built = builders.issueShares(protocolContext(HUB_CENT_ID), {
      ...(actions[0]!.payload as any),
      // The DTO spells the page `navPerShare`; the pure builder spells it
      // `pricesPoolPerShare`. `ProtocolTxBuilder` does this same rename in
      // `apps/private-api`, so it is the wire contract's, not the SDK's.
      issuances: (actions[0]!.payload as any).issuances.map((page: any) => ({
        assetId: page.assetId,
        fromEpochId: page.fromEpochId,
        pricesPoolPerShare: page.navPerShare,
      })),
    })

    // Two epochs, so a real multicall on both sides rather than a bare call.
    expect(localBuilt.calls).to.have.length(2)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())

    // The control: the two epochs must be priced differently, or a page that
    // reused one price everywhere would pass this test.
    const flat = builders.issueShares(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      issuances: [
        {
          assetId: REMOTE_ASSET.toString(),
          fromEpochId: String(EPOCHS.issueEpoch),
          pricesPoolPerShare: [ISSUE_PRICE.toBigInt().toString(), ISSUE_PRICE.toBigInt().toString()],
        },
      ],
      refundAddress: REFUND,
    })
    expect(flat.data).to.not.equal(built.data)
  })

  it('approveRedeems is byte-equal, and carries a zero value on both sides', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    const built = builders.approveRedeems(protocolContext(HUB_CENT_ID), actions[0]!.payload as any)

    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.value).to.equal(0n)
    expect(built.value).to.equal(0n)
  })

  it('revokeShares is byte-equal across a two-epoch page', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveRedeemsAndRevokeShares(
        [{ assetId: REMOTE_ASSET, revokePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveRedeemsAndRevokeShares(
        [{ assetId: REMOTE_ASSET, revokePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    const built = builders.revokeShares(protocolContext(HUB_CENT_ID), {
      ...(actions[0]!.payload as any),
      revocations: (actions[0]!.payload as any).revocations.map((page: any) => ({
        assetId: page.assetId,
        fromEpochId: page.fromEpochId,
        pricesPoolPerShare: page.navPerShare,
      })),
    })

    expect(localBuilt.calls).to.have.length(2)
    expect(localBuilt.data).to.equal(built.data)
    // The control that separates the two epoch families: a revocation must not
    // encode like an issuance of the same page.
    const issued = builders.issueShares(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      issuances: [
        {
          assetId: REMOTE_ASSET.toString(),
          fromEpochId: String(EPOCHS.revokeEpoch),
          pricesPoolPerShare: [ISSUE_PRICE.toBigInt().toString(), ISSUE_PRICE_2.toBigInt().toString()],
        },
      ],
      refundAddress: REFUND,
    })
    expect(issued.data).to.not.equal(built.data)
  })
})

describe('orders writes: the cross-chain message manifest', () => {
  it('agrees on the message COUNT for a remote asset, approve and issue alike', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, issuePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, issuePricePerShare: [ISSUE_PRICE, ISSUE_PRICE_2] }],
        { refundAddress: REFUND }
      )
    )
    const built = builders.issueShares(protocolContext(HUB_CENT_ID), {
      ...(actions[0]!.payload as any),
      issuances: (actions[0]!.payload as any).issuances.map((page: any) => ({
        assetId: page.assetId,
        fromEpochId: page.fromEpochId,
        pricesPoolPerShare: page.navPerShare,
      })),
    })

    // One paid `RequestCallback` per epoch, on both sides. An UNDER-declared
    // manifest is the dangerous direction: the backend prices what it declares,
    // and under-payment strands the message after the hub tx confirms.
    expect(manifestOf(localBuilt.messages as any)).to.deep.equal({ [SPOKE_CENT_ID]: ['RequestCallback', 'RequestCallback'] })
    expect(manifestOf(built.messages as any)).to.deep.equal(manifestOf(localBuilt.messages as any))
  })

  it('approveRedeems declares an EMPTY manifest on both sides', async () => {
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ])
    )
    const built = builders.approveRedeems(protocolContext(HUB_CENT_ID), actions[0]!.payload as any)

    // Not "no manifest declared yet": the contract dispatches nothing, and wei
    // sent to it cannot be recovered.
    expect(manifestOf(localBuilt.messages as any)).to.deep.equal({})
    expect(manifestOf(built.messages as any)).to.deep.equal({})
  })

  it('pins the ONE manifest divergence: a self-addressed asset', async () => {
    // The SDK declares a message for an asset on the pool's own chain and pays
    // whatever `_estimate` returns, which is zero; `packages/protocol` declares
    // none, because `MessageDispatcher.sendRequestCallback` short-circuits the
    // bridge and `estimateBridgeFee` REFUSES a zero fee (`ZeroBridgeFeeError`,
    // 422 BRIDGE_FEE_UNCONFIGURED) — declaring it would turn a correct free
    // transaction into a refusal. The two agree on the amount and differ on
    // whether zero is an error, which is only safe while the local case never
    // reaches the estimator. This test is what makes that stop being luck.
    const { centrifuge: backend, actions } = backendCentrifuge()
    const backendEntities = entities(backend)
    await firstValueFrom(
      backendEntities.shareClass.approveDepositsAndIssueShares([
        { assetId: LOCAL_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      ])
    )

    const local = localCentrifuge()
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [LOCAL_ASSET])
    const localBuilt = await local.buildOnly(
      localEntities.shareClass.approveDepositsAndIssueShares([
        { assetId: LOCAL_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE },
      ])
    )
    const built = builders.approveDeposits(protocolContext(HUB_CENT_ID), actions[0]!.payload as any)

    expect(manifestOf(localBuilt.messages as any)).to.deep.equal({ [HUB_CENT_ID]: ['RequestCallback'] })
    expect(manifestOf(built.messages as any)).to.deep.equal({})
    // The calldata is still identical — only the fee manifest differs. The
    // refund argument is the zero address on both sides, because neither
    // dispatches.
    expect(localBuilt.data).to.equal(built.data)
  })
})

describe('orders writes: the page is explicit, and no gas budget is ported', () => {
  /** 20 epochs outstanding, priced by one price the caller gave. */
  const wideEpochs = { ...EPOCHS, issueEpoch: 3, depositEpoch: 23 }

  it('puts all 20 epochs on the wire as an explicit page, for the backend to measure', async () => {
    const { centrifuge, actions } = backendCentrifuge({ epochs: wideEpochs })
    const { shareClass } = entities(centrifuge)

    await firstValueFrom(
      shareClass.approveDepositsAndIssueShares([{ assetId: REMOTE_ASSET, issuePricePerShare: ISSUE_PRICE }], {
        refundAddress: REFUND,
      })
    )

    // The number of epochs IS the number of paid messages, and it is stated
    // rather than derived, so `estimateBridgeFee` can refuse it with 422
    // BRIDGE_BATCH_TOO_LARGE naming the declared and effective caps.
    expect((actions[0]!.payload as any).issuances[0].navPerShare).to.have.length(20)
    expect((actions[0]!.payload as any).issuances[0].fromEpochId).to.equal('3')
  })

  it('shows what the local path checks instead: the DECLARED cap, not the effective one', async () => {
    // 20 x 487,788 = 9,755,760 gas. Under the 10,000,000 `maxBatchGasLimit` the
    // gas service declares, so the SDK builds and signs it — and more than
    // three times the measured effective cap for the worst route
    // (2,996,000, i.e. six messages), where `MultiAdapter.estimate` reverts
    // with `0x4c4fc93a`, a selector in no bundled ABI. This is the check that
    // must NOT be ported onto the backend payload.
    const local = localCentrifuge({ epochs: wideEpochs })
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET], [], wideEpochs)

    const sent = await sendLocally(
      local,
      localEntities.shareClass.approveDepositsAndIssueShares([
        { assetId: REMOTE_ASSET, issuePricePerShare: ISSUE_PRICE },
      ]),
      HUB_CHAIN_ID
    )

    expect(sent).to.have.length(1)
    expect(sent[0]!.value > 0n).to.equal(true)
  })

  it('and the declared cap does bite eventually, one epoch later', async () => {
    // The control for the case above: without it, "the local path signs 20
    // epochs" could equally mean the gas check never runs at all. 21 x 487,788
    // = 10,243,548 is over the declared 10,000,000, and the SDK refuses by
    // name.
    const overCap = { ...wideEpochs, depositEpoch: 24 }
    const local = localCentrifuge({ epochs: overCap })
    const localEntities = entities(local)
    stubProjection(localEntities.shareClass, [REMOTE_ASSET], [], overCap)

    let error: any
    try {
      await sendLocally(
        local,
        localEntities.shareClass.approveDepositsAndIssueShares([
          { assetId: REMOTE_ASSET, issuePricePerShare: ISSUE_PRICE },
        ]),
        HUB_CHAIN_ID
      )
    } catch (e) {
      error = e
    }

    expect(String(error?.message)).to.contain('exceeds limit 10000000')
  })
})

describe('orders writes: msg.value is the backend’s on the backend route', () => {
  const walletOutcome = (value: string): PrepareOutcome => ({
    route: 'wallet',
    txId: 'tx-value',
    unsignedTx: {
      to: '0x0000000000000000000000000000000000000009' as HexString,
      data: '0xdeadbeef' as HexString,
      value: BigInt(value),
      chainId: HUB_CHAIN_ID,
    },
  })

  it('signs exactly the value the backend quoted, and never adds an estimate of its own', async () => {
    // The fixture that catches a wrong per-version strategy. v3.2 attaches
    // value for cross-chain gas on the approval paths where v3.3 must not; on
    // this route that decision is entirely the backend's, because the SDK
    // sends no value and signs what it is handed. If anyone "helpfully" made
    // this path add `_estimate` on top, or clamp it, this case goes red.
    const quoted = '104462138864007'
    const { centrifuge, actions } = backendCentrifuge({}, walletOutcome(quoted))
    const { shareClass } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      shareClass.approveDepositsAndIssueShares(
        [{ assetId: REMOTE_ASSET, approveAssetAmount: APPROVE_ASSETS, approvePricePerAsset: APPROVE_PRICE }],
        { refundAddress: REFUND }
      ),
      HUB_CHAIN_ID
    )

    expect(sent).to.have.length(1)
    expect(sent[0]!.value).to.equal(BigInt(quoted))
    expect(sent[0]!.data).to.equal('0xdeadbeef')
    // And the payload carried no opinion about the fee at all.
    expect(JSON.stringify(actions[0]!.payload)).to.not.contain('value')
  })

  it('signs a quoted ZERO as zero, which is what a version with no fee looks like', async () => {
    // The inverse arm. Without it, a path that always added a non-zero estimate
    // would still pass the case above by coincidence of the quoted number.
    const { centrifuge } = backendCentrifuge({}, walletOutcome('0'))
    const { shareClass } = entities(centrifuge)

    const sent = await sendLocally(
      centrifuge,
      shareClass.approveRedeemsAndRevokeShares([
        { assetId: REMOTE_ASSET, approveShareAmount: APPROVE_SHARES, approvePricePerAsset: APPROVE_PRICE },
      ]),
      HUB_CHAIN_ID
    )

    expect(sent[0]!.value).to.equal(0n)
  })
})

describe('orders: what a corrupted investor address does to maxClaims', () => {
  /**
   * The sharpest case of a corrupted projection column, on the SDK's own route.
   *
   * The backend's `redeemOrderClaims` / `investOrderClaims` FILTER on
   * `chain_v1.{redeem,invest}_order.account`, so a corrupted column returns
   * zero ROWS and that zero becomes `maxClaims`. The SDK never reads those
   * entries: `_investorOrder` asks the chain
   * (`BatchRequestManager.maxRedeemClaims`, keyed by the RIGHT-padded
   * `bytes32`). So the corruption arrives on this route by a different door —
   * as the INVESTOR IDENTITY, out of `redeemOrderState.redeemOrders[].account`
   * — and produces a different failure: the chain has no `UserOrder` at that
   * key, so `redeemRequest` answers `pending = 0`, `maxRedeemClaims` answers
   * `0`, and the `if (order.pendingRedeem > 0n)` guard drops the notification
   * leg entirely.
   *
   * Both cases below run the same code against the same fake chain; only the
   * address the projection supplied differs.
   */
  async function revokeWithInvestor(investor: HexString) {
    const centrifuge = localCentrifuge({ knownInvestor: INVESTOR, claims: 1 })
    const { shareClass } = entities(centrifuge)
    stubProjection(shareClass, [REMOTE_ASSET], [{ investor, assetId: REMOTE_ASSET }])
    return await centrifuge.buildOnly(
      shareClass.approveRedeemsAndRevokeShares([{ assetId: REMOTE_ASSET, revokePricePerShare: ISSUE_PRICE }])
    )
  }

  it('notifies the investor when the projected address is the real one', async () => {
    const built = await revokeWithInvestor(INVESTOR)

    // Two revocations (epochs 7 and 8) plus one `notifyRedeem`.
    expect(built.calls).to.have.length(3)
    // And it pays for three messages, one per call.
    expect(manifestOf(built.messages as any)[String(SPOKE_CENT_ID)]).to.have.length(3)
  })

  it('silently notifies NOBODY when the projected address is the corrupted one', async () => {
    const built = await revokeWithInvestor(CORRUPTED_INVESTOR)

    // The two revocations still go out; the notification does not, and nothing
    // anywhere says so. The shares are revoked and the investor is never told —
    // which is why `redeemOrderState` refusing 503 in backend mode is the safe
    // direction, and why this method's backend route sends no notify tail at
    // all rather than one built from this column.
    expect(built.calls).to.have.length(2)
    expect(manifestOf(built.messages as any)[String(SPOKE_CENT_ID)]).to.have.length(2)
    expect(CORRUPTED_INVESTOR).to.not.equal(INVESTOR)
  })
})
