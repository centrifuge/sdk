import { notMigrating, stubProjectedPools } from '../tests/utils.js'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { builders, resolveProtocolContext, type ProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import type { HexString } from '../types/index.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import { Balance, Price } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

/**
 * Holdings write acceptance: routing, payloads, refusals, and calldata
 * parity between the backend's builders and what the SDK actually puts on the
 * wire.
 *
 * The parity half is the one that matters, and the "SDK side" of each
 * comparison is not a re-encode written in this file — that would only prove
 * the test agrees with itself. It is the bytes the local path
 * hands to the wallet, captured out of a fake EIP-1193 provider at
 * `eth_sendTransaction` (or, for the `wrapTransaction` methods, out of
 * `buildOnly`). The "backend side" is `@centrifuge/protocol`'s builder — the
 * same function `ProtocolTxBuilder.build()` calls in `apps/private-api` — over
 * the same bundled deployment registry, so the addresses are the deployed ones
 * on both sides.
 *
 * What the builder is handed is the SDK's payload PLUS the fields the backend
 * resolves for itself, and the distinction is worth stating rather than
 * blurring: `depositHolding` / `withdrawHolding` never put an asset ADDRESS on
 * the wire (the backend looks it up in `chain_v1`, so a caller cannot name
 * asset 42 in the audit row while moving another token). So these cases prove
 * "given the same resolved asset, the two encoders agree byte for byte" —
 * which is the encoding question. Whether the projection resolves the same
 * address the SDK's `Spoke.idToAsset` read finds is a different question, and
 * a projection one; it belongs to the read-parity suites in
 * `packages/queries`.
 *
 * Everything runs off the bundled deployment registry, so there is no indexer,
 * no RPC and no Tenderly fork.
 */

const ENVIRONMENT = 'mainnet'
const PROTOCOL_VERSION = '3.2'
/** Pool on centrifugeId 1 (ethereum); balance-sheet work happens on spoke 2 (base). */
const POOL_ID = PoolId.from(1, 7)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const HUB_CENT_ID = 1
const SPOKE_CENT_ID = 2
const SPOKE_CHAIN_ID = 8453
const HUB_CHAIN_ID = 1

const ASSET_ID = AssetId.from(SPOKE_CENT_ID, 3)
const ASSET_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as HexString
const RECEIVER = '0x1231231231231231231231231231231231231231' as HexString
const HOLDER = '0x4564564564564564564564564564564564564564' as HexString
const CUSTODIAN = '0x7897897897897897897897897897897897897897' as HexString
const SIGNER_ADDRESS = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' as HexString
const VALUATION = '0x9f4b1c6d2a1cb2a2b4e2b3a6d8e0f1a2b3c4d5e6' as HexString

const AMOUNT = Balance.fromFloat(1.5, 6)
const PRICE = Price.fromFloat(1.25)

/** The four asset accounts, as the pool metadata would carry them. */
const DEFAULT_ACCOUNTS = { asset: 11, equity: 12, gain: 13, loss: 14 }

/** A captured `eth_sendTransaction` request. */
interface SentTx {
  to: HexString
  data: HexString
  value: bigint
}

/**
 * A wallet that answers just enough JSON-RPC to let `writeContract` /
 * `sendTransaction` encode and "send", and records what it was asked to send.
 *
 * Deliberately an EIP-1193 provider rather than a local account: that is the
 * shape a browser wallet has, it is what `_transact` builds its wallet client
 * from, and viem then forwards the fully encoded transaction as
 * `eth_sendTransaction` instead of signing it locally — which is exactly the
 * bytes this test needs to compare.
 */
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
 * A public client that answers the two reads `doTransaction` makes, plus
 * whatever single `readContract` the method under test needs.
 */
function fakePublicClient(readContract: () => Promise<unknown> = async () => undefined) {
  return {
    getCode: async () => undefined,
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
    readContract,
  }
}

/**
 * Stub only the chain plumbing. `_protocolContext` is deliberately NOT stubbed:
 * the addresses on both sides of every parity assertion have to come from the
 * one bundled registry, or the comparison proves nothing about the real
 * deployment.
 */
function stubChain(centrifuge: Centrifuge, readContract?: () => Promise<unknown>) {
  const thenable = <T>(value: T) => makeThenable(of(value))
  const chainOf = (centrifugeId: number) => (centrifugeId === HUB_CENT_ID ? HUB_CHAIN_ID : SPOKE_CHAIN_ID)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: any) => thenable(chainOf(Number(id))))
  sinon
    .stub(centrifuge as any, 'getChainConfig')
    .callsFake((id: any) => thenable({ id: chainOf(Number(id)), name: 'test' }))
  sinon.stub(centrifuge as any, 'getClient').callsFake(() => thenable(notMigrating(fakePublicClient(readContract))))
}

function entities(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, POOL_ID.raw)
  const shareClass = new ShareClass(centrifuge, pool, SC_ID.raw)
  const network = new PoolNetwork(centrifuge, pool, SPOKE_CENT_ID)
  return { pool, shareClass, balanceSheet: new BalanceSheet(centrifuge, network, shareClass) }
}

/** A strategy that records the action and answers on the custodial route. */
function recordingStrategy() {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-sdk-7',
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
function localCentrifuge(readContract?: () => Promise<unknown>) {
  const centrifuge = new Centrifuge({ environment: ENVIRONMENT })
  stubProjectedPools(centrifuge, [POOL_ID])
  stubChain(centrifuge, readContract)
  return centrifuge
}

/** The pure-builder context for a hub-side or spoke-side action. */
function protocolContext(centrifugeId: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID.toString(), PROTOCOL_VERSION, {
    environment: ENVIRONMENT,
    centrifugeId,
  })
}

/** Run a local transaction to completion against the recording wallet. */
async function sendLocally(centrifuge: Centrifuge, tx: any, chainId: number): Promise<SentTx[]> {
  const { signer, sent } = recordingSigner(chainId)
  centrifuge.setSigner(signer as any)
  sinon.stub(centrifuge as any, '_allowance').returns(makeThenable(of(2n ** 200n)))
  await firstValueFrom(tx.pipe(toArray()))
  return sent
}

afterEach(() => {
  sinon.restore()
})

describe('holdings writes: routing', () => {
  it('routes exactly the five holdings actions the backend ships builders for', () => {
    // The five holdings rows, and only those: this asserts the SCOPE of this
    // vertical, not the table as a whole. The exhaustive pin lives once, in
    // `tx/BackendPrepare.test.ts`, so a new vertical updates one assertion
    // rather than one per vertical — several whole-table pins would each go red
    // for rows that are legitimately there.
    const writes = backendRoutingTable().writes
    const holdingsActions = [
      'createHolding',
      'depositHolding',
      'withdrawHolding',
      'issueSharesDirect',
      'revokeSharesDirect',
    ]
    expect(Object.fromEntries(holdingsActions.map((action) => [action, writes[action]]))).to.deep.equal({
      createHolding: 'backend',
      depositHolding: 'backend',
      withdrawHolding: 'backend',
      issueSharesDirect: 'backend',
      revokeSharesDirect: 'backend',
    })
    // The control that keeps the line above from passing on a table that routes
    // everything: an action the backend accepts but no vertical has claimed is
    // still local.
    expect(writes.updatePoolMetadata).to.equal(undefined)
  })

  it('sends depositHolding with the asset id only, never an asset address', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)

    await firstValueFrom(balanceSheet.deposit(ASSET_ID, AMOUNT))

    expect(actions).to.have.length(1)
    expect(actions[0]!.action).to.equal('depositHolding')
    expect(actions[0]!.poolId).to.equal(POOL_ID.toString())
    // The asset ADDRESS is resolved server-side from the projection. Sending
    // one would let a caller name asset 42 in the audit row while moving a
    // different token, so its absence is part of the contract.
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      assetId: ASSET_ID.toString(),
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet',
    })
  })

  it('sends withdrawHolding with the recipient', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)

    await firstValueFrom(balanceSheet.withdraw(ASSET_ID, RECEIVER, AMOUNT))

    expect(actions[0]!.action).to.equal('withdrawHolding')
    expect(actions[0]!.payload).to.deep.include({ source: 'wallet', receiverAddress: RECEIVER })
  })

  it('sends issueSharesDirect as a share COUNT, with the division done here', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)

    await firstValueFrom(balanceSheet.issue(HOLDER, AMOUNT, PRICE))

    // 1.5 / 1.25 = 1.2 shares, at the amount's own decimals. The backend takes
    // the count so no rounding choice happens server-side.
    expect(actions[0]!.action).to.equal('issueSharesDirect')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      centrifugeId: String(SPOKE_CENT_ID),
      address: HOLDER,
      shares: Balance.fromFloat(1.2, 6).toBigInt().toString(),
      pricePoolPerShare: PRICE.toBigInt().toString(),
    })
  })

  it('sends revokeSharesDirect with the custodian the caller named', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)

    await firstValueFrom(balanceSheet.revoke(HOLDER, AMOUNT, PRICE, { custodianAddress: CUSTODIAN }))

    expect(actions[0]!.action).to.equal('revokeSharesDirect')
    expect(actions[0]!.payload).to.deep.include({ address: HOLDER, custodianAddress: CUSTODIAN })
  })

  it('sends createHolding with the account ids resolved from the pool metadata', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    sinon
      .stub(pool, 'metadata')
      .returns(makeThenable(of({ shareClasses: { [SC_ID.raw]: { defaultAccounts: DEFAULT_ACCOUNTS } } })) as any)

    await firstValueFrom(shareClass.createHolding(ASSET_ID, VALUATION, false))

    expect(actions[0]!.action).to.equal('createHolding')
    expect(actions[0]!.payload).to.deep.equal({
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: { asset: '11', equity: '12', gain: '13', loss: '14' },
    })
  })

  it('never reaches the backend without an injected txStrategy, whatever the table says', async () => {
    // A bare `new Centrifuge({ … })` builds locally, so a route row cannot
    // change what a default-configured caller does. Proven by the wallet
    // receiving the transaction, not by the strategy going uncalled — there is
    // no strategy to observe on this path.
    const centrifuge = localCentrifuge(async () => [ASSET_ADDRESS, 0n])
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.withdraw(ASSET_ID, RECEIVER, AMOUNT), SPOKE_CHAIN_ID)

    expect(sent).to.have.length(1)
  })
})

describe('holdings writes: refusals rather than plausible defaults', () => {
  it('refuses createHolding in backend mode when no account id can be resolved', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    // No defaults and no explicit ids: the local path would allocate random
    // ones and prepend Hub.createAccount legs, which this action cannot carry.
    sinon.stub(pool, 'metadata').returns(makeThenable(of({ shareClasses: {} })) as any)

    let error: any
    try {
      await firstValueFrom(shareClass.createHolding(ASSET_ID, VALUATION, false))
    } catch (e) {
      error = e
    }

    expect(error?.message).to.contain('createHolding')
    expect(error?.message).to.contain('pool.createAccounts()')
    // And it refused BEFORE preparing anything: no orphaned backend row.
    expect(actions).to.have.length(0)
  })

  it('still resolves createHolding when only SOME ids come from metadata', async () => {
    // The inverse of the case above: the refusal must be about a MISSING id,
    // not about "the caller passed nothing". Without this, a refusal that
    // fired whenever `accounts` was undefined would pass the test above.
    const { centrifuge, actions } = backendCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    sinon
      .stub(pool, 'metadata')
      .returns(
        makeThenable(
          of({ shareClasses: { [SC_ID.raw]: { defaultAccounts: { equity: 12, gain: 13, loss: 14 } } } })
        ) as any
      )

    await firstValueFrom(shareClass.createHolding(ASSET_ID, VALUATION, false, { 0: 99 } as any))

    expect((actions[0]!.payload as any).accounts).to.deep.equal({
      asset: '99',
      equity: '12',
      gain: '13',
      loss: '14',
    })
  })

  it('refuses revoke in backend mode without an explicit custodian', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)

    let error: any
    try {
      await firstValueFrom(balanceSheet.revoke(HOLDER, AMOUNT, PRICE))
    } catch (e) {
      error = e
    }

    // Defaulting to the connected wallet would be the plausible wrong value:
    // on the custodial route the signer is the pool's Fordefi vault.
    expect(error?.message).to.contain('custodianAddress')
    expect(actions).to.have.length(0)
  })

  it('refuses a zero SHARE COUNT in both modes, as it always has', async () => {
    // `sharesFor`'s guard is mode-independent, and both paths share the one
    // function. Checked on both anyway: a guard that held on only one path
    // would let the same call move a different number of shares depending on
    // which strategy served it.
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)
    const zero = Balance.fromFloat(0, 6)

    let backendError: any
    try {
      await firstValueFrom(balanceSheet.issue(HOLDER, zero, PRICE))
    } catch (e) {
      backendError = e
    }
    expect(backendError?.message).to.contain('Cannot issue 0 shares')
    expect(actions).to.have.length(0)

    const local = localCentrifuge()
    const localEntities = entities(local)
    sinon.stub(localEntities.pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)
    let localError: any
    try {
      await sendLocally(local, localEntities.balanceSheet.revoke(HOLDER, zero, PRICE), SPOKE_CHAIN_ID)
    } catch (e) {
      localError = e
    }
    expect(localError?.message).to.contain('Cannot revoke 0 shares')
  })

  it('sends a zero deposit AMOUNT, which the backend refuses and the wallet does not', async () => {
    // The asymmetry this vertical introduces and does not close; see the
    // BalanceSheet class docstring. `deposit`/`withdraw` have never had a
    // client-side zero guard and still do not, so the local path signs a
    // no-op; `OnChainAmountSchema` on `depositHolding.amount` refuses "0" at
    // the HTTP boundary, so the backend route 422s before preparing anything.
    //
    // Adding the guard here would change public-mode behaviour, which routing a
    // write may not do; so the divergence is pinned instead of hidden, and this
    // test goes red the day either side changes its mind.
    const { centrifuge, actions } = backendCentrifuge()
    const { balanceSheet } = entities(centrifuge)
    const zero = Balance.fromFloat(0, 6)

    await firstValueFrom(balanceSheet.deposit(ASSET_ID, zero))
    expect((actions[0]!.payload as any).amount).to.equal('0')

    // ... and the local path builds and sends it, with no complaint.
    const local = localCentrifuge(async () => [ASSET_ADDRESS, 0n])
    const localEntities = entities(local)
    sinon.stub(localEntities.pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)
    const sent = await sendLocally(local, localEntities.balanceSheet.deposit(ASSET_ID, zero), SPOKE_CHAIN_ID)
    expect(sent).to.have.length(1)
  })

  it('keeps revoke working with no custodian on the local path, unchanged', async () => {
    // The other half: the new option must not become a requirement for the
    // callers that have never passed one.
    const centrifuge = localCentrifuge()
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.revoke(HOLDER, AMOUNT, PRICE), SPOKE_CHAIN_ID)

    expect(sent).to.have.length(1)
  })
})

describe('holdings writes: calldata parity (backend builder vs local build)', () => {
  it('withdrawHolding is byte-equal to what the wallet is asked to send', async () => {
    const centrifuge = localCentrifuge(async () => [ASSET_ADDRESS, 0n])
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.withdraw(ASSET_ID, RECEIVER, AMOUNT), SPOKE_CHAIN_ID)
    const built = builders.withdrawHolding(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: null },
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet',
      receiverAddress: RECEIVER,
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(sent[0]!.value).to.equal(built.value)
  })

  it('withdrawHolding is byte-equal for an ERC-6909 asset too', async () => {
    // The `assetTokenId` mapping is the one place the two sides could differ
    // by construction: the SDK reads a `bigint` off the chain and the builder
    // takes a decimal STRING with `null` meaning "plain ERC-20, encode 0". The
    // ERC-20 case above cannot tell a broken mapping from a correct one,
    // because both spellings of "no token id" encode to the same zero word.
    const centrifuge = localCentrifuge(async () => [ASSET_ADDRESS, 9n])
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.withdraw(ASSET_ID, RECEIVER, AMOUNT), SPOKE_CHAIN_ID)
    const built = builders.withdrawHolding(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: '9' },
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet',
      receiverAddress: RECEIVER,
    })
    const erc20 = builders.withdrawHolding(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: null },
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet',
      receiverAddress: RECEIVER,
    })

    expect(sent[0]!.data).to.equal(built.data)
    // The control: a token id of 9 must not encode like a plain ERC-20.
    expect(built.data).to.not.equal(erc20.data)
  })

  it('depositHolding is byte-equal, once the allowance no longer needs topping up', async () => {
    // `deposit` reads the asset pair off the Spoke, so the public client
    // answers that one read.
    const centrifuge = localCentrifuge(async () => [ASSET_ADDRESS, 0n])
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.deposit(ASSET_ID, AMOUNT), SPOKE_CHAIN_ID)
    const built = builders.depositHolding(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: null },
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet',
    })

    // One call, not two: the allowance is sufficient, so no approval leg. That
    // is the ONLY shape the backend route can match — see `ACTION_ROUTES`.
    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(sent[0]!.value).to.equal(built.value)
  })

  it('depositHolding is byte-equal for an ERC-6909 asset too', async () => {
    // Deposit and withdrawal resolve the asset pair through the same
    // `Spoke.idToAsset` read, but encode against different functions, so
    // each needs its own token-id case.
    const centrifuge = localCentrifuge(async () => [ASSET_ADDRESS, 9n])
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.deposit(ASSET_ID, AMOUNT), SPOKE_CHAIN_ID)
    const args = {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      amount: AMOUNT.toBigInt().toString(),
      source: 'wallet' as const,
    }
    const built = builders.depositHolding(protocolContext(SPOKE_CENT_ID), {
      ...args,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: '9' },
    })
    const erc20 = builders.depositHolding(protocolContext(SPOKE_CENT_ID), {
      ...args,
      asset: { assetId: ASSET_ID.toString(), address: ASSET_ADDRESS, assetTokenId: null },
    })

    expect(sent[0]!.data).to.equal(built.data)
    expect(built.data).to.not.equal(erc20.data)
  })

  it('issueSharesDirect is byte-equal, multicall shape and order included', async () => {
    const centrifuge = localCentrifuge()
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    const sent = await sendLocally(centrifuge, balanceSheet.issue(HOLDER, AMOUNT, PRICE), SPOKE_CHAIN_ID)
    const built = builders.issueSharesDirect(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      address: HOLDER,
      shares: Balance.fromFloat(1.2, 6).toBigInt().toString(),
      pricePoolPerShare: PRICE.toBigInt().toString(),
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(sent[0]!.value).to.equal(built.value)
  })

  it('revokeSharesDirect is byte-equal, transfer leg included', async () => {
    const centrifuge = localCentrifuge()
    const { pool, balanceSheet } = entities(centrifuge)
    sinon.stub(pool, 'isBalanceSheetManager').returns(makeThenable(of(true)) as any)

    // The custodian is passed explicitly here so the two sides describe the
    // same transaction; on the local path with no option it is the signer, and
    // the assertion below would then compare against SIGNER_ADDRESS instead.
    const sent = await sendLocally(
      centrifuge,
      balanceSheet.revoke(HOLDER, AMOUNT, PRICE, { custodianAddress: CUSTODIAN }),
      SPOKE_CHAIN_ID
    )
    const built = builders.revokeSharesDirect(protocolContext(SPOKE_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      address: HOLDER,
      custodianAddress: CUSTODIAN,
      shares: Balance.fromFloat(1.2, 6).toBigInt().toString(),
      pricePoolPerShare: PRICE.toBigInt().toString(),
    })

    expect(sent).to.have.length(1)
    expect(sent[0]!.data).to.equal(built.data)
    expect(sent[0]!.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(sent[0]!.value).to.equal(built.value)
  })

  it('createHolding is byte-equal when every account id is already known', async () => {
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    sinon
      .stub(pool, 'metadata')
      .returns(makeThenable(of({ shareClasses: { [SC_ID.raw]: { defaultAccounts: DEFAULT_ACCOUNTS } } })) as any)

    // Hub-side and routed through `wrapTransaction`, so `buildOnly` gives the
    // signing path's exact bytes without a wallet at all.
    const localBuilt = await centrifuge.buildOnly(shareClass.createHolding(ASSET_ID, VALUATION, false))
    const built = builders.createHolding(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: { asset: '11', equity: '12', gain: '13', loss: '14' },
    })

    // One call: with all four ids known there is no `Hub.createAccount` leg,
    // which is exactly the condition the backend route requires.
    expect(localBuilt.calls).to.have.length(1)
    expect(localBuilt.data).to.equal(built.data)
    expect(localBuilt.to.toLowerCase()).to.equal(built.to.toLowerCase())
    expect(localBuilt.value).to.equal(built.value)
  })

  it('createHolding as a LIABILITY is byte-equal too, and is a different encoding', async () => {
    const centrifuge = localCentrifuge()
    const { pool, shareClass } = entities(centrifuge)
    sinon
      .stub(pool, 'metadata')
      .returns(
        makeThenable(of({ shareClasses: { [SC_ID.raw]: { defaultAccounts: { expense: 21, liability: 22 } } } })) as any
      )

    const localBuilt = await centrifuge.buildOnly(shareClass.createHolding(ASSET_ID, VALUATION, true))
    const built = builders.createHolding(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      valuationAddress: VALUATION,
      isLiability: true,
      accounts: { expense: '21', liability: '22' },
    })

    expect(localBuilt.data).to.equal(built.data)
    // The control that keeps the assertion above from passing on a shared
    // wrong encoding: `initializeLiability` and `initializeHolding` must not
    // produce the same selector.
    const assetSide = builders.createHolding(protocolContext(HUB_CENT_ID), {
      poolId: POOL_ID.toString(),
      scId: SC_ID.raw,
      assetId: ASSET_ID.toString(),
      valuationAddress: VALUATION,
      isLiability: false,
      accounts: { asset: '11', equity: '12', gain: '13', loss: '14' },
    })
    expect(built.data.slice(0, 10)).to.not.equal(assetSide.data.slice(0, 10))
  })

  it('the local path still prepends createAccount legs when an id is missing', async () => {
    // The condition the backend route refuses, shown to be real rather than
    // hypothetical: with no default accounts the local build is a multicall of
    // five, and no single-call `createHolding` action could carry it.
    // `Accounting.exists` answers false, so every freshly allocated id is
    // accepted on the first probe.
    const centrifuge = localCentrifuge(async () => false)
    const { pool, shareClass } = entities(centrifuge)
    sinon.stub(pool, 'metadata').returns(makeThenable(of({ shareClasses: {} })) as any)

    const localBuilt = await centrifuge.buildOnly(shareClass.createHolding(ASSET_ID, VALUATION, false))

    expect(localBuilt.calls).to.have.length(5)
  })
})
