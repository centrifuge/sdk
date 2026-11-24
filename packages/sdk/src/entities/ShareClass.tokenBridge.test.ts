import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, keccak256, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { ABIS_V3_3, builders, emptyMessageV3_3, resolveProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { stubMigrationRows } from '../tests/utils.js'
import { BridgeLimitError, BridgeNotEnabledError, InvalidBridgeChainError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { emptyMessage, MessageTypeV3_3, messageV3_3 } from '../types/transaction.js'
import { addressToBytes32 } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

// `crosschainTransferShares` on v3.3: a non-bridger sends through TokenBridge,
// and a transfer the hub's BridgeCircuitBreaker would revert is refused before
// anything is signed. Built against the bundled testnet registry.

const HUB = 1
const SPOKE = 2
const OTHER = 3
const CHAIN_ID: Record<number, number> = { [HUB]: 11155111, [SPOKE]: 84532, [OTHER]: 421614 }
const pool33Id = PoolId.from(HUB, 33)
const pool32Id = PoolId.from(HUB, 32)
const scId = ShareClassId.from(pool33Id, 1)
const signer = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const who = '0x19f46d8130e610c6c0f0116ea40fb781defade93' as HexString
const SHARE = '0x2222222222222222222222222222222222222222' as HexString
/** A bridging hook that is not the address book's breaker. */
const OTHER_HOOK = '0x7777777777777777777777777777777777777777' as HexString
const NOW = 1_000_000n

const thenable = <T>(value: T) => makeThenable(of(value))
const addressesOf = (centrifugeId: number) =>
  resolveProtocolContext(pool33Id.raw.toString(), '3.3', { environment: 'testnet', centrifugeId }).addresses
const BREAKER = addressesOf(HUB).bridgeCircuitBreaker as HexString
const GUARD = addressesOf(HUB).circuitBreakerGuard as HexString

type ChainState = {
  bridger?: boolean
  /** Whether the pool made the source chain's TokenBridge a bridger. */
  tokenBridgeEnabled?: boolean
  hook?: HexString
  paused?: boolean
  limits?: readonly [bigint, number]
  cumulative?: readonly [bigint, bigint]
  authorizations?: bigint
  mapped?: number
  allowance?: bigint
  /** TokenBridge's `gasLimits(poolId, scId)`: `[extraGasLimit, remoteExtraGasLimit]`. */
  gasLimits?: readonly [bigint, bigint]
}

type Read = { address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }

function setup(
  state: ChainState = {},
  { signing = false, batching = false }: { signing?: boolean; batching?: boolean } = {}
) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
    ])
  )
  stubMigrationRows(centrifuge)
  sinon.stub(centrifuge, '_migrationGate').resolves()
  const reads: Read[] = []
  const readContract = async (read: Read) => {
    reads.push(read)
    const answers: Record<string, () => unknown> = {
      bridger: () =>
        String(read.args![1]).toLowerCase() === String(addressesOf(SPOKE).tokenBridge).toLowerCase()
          ? (state.tokenBridgeEnabled ?? true)
          : (state.bridger ?? false),
      bridgingHook: () => state.hook ?? BREAKER,
      paused: () => state.paused ?? false,
      limits: () => state.limits ?? [1_000n, 3600],
      gasLimits: () => state.gasLimits ?? [0n, 0n],
      cumulative: () => state.cumulative ?? [0n, 0n],
      authorizations: () => state.authorizations ?? 0n,
      shareToken: () => SHARE,
      chainIdToCentrifugeId: () =>
        state.mapped ?? Number(Object.entries(CHAIN_ID).find(([, id]) => BigInt(id) === read.args![0])![0]),
      allowance: () => state.allowance ?? 0n,
    }
    const answer = answers[read.functionName]
    if (!answer) throw new Error(`unexpected read ${read.functionName}`)
    return answer()
  }
  const client = { readContract, getBlock: async () => ({ number: 500n, timestamp: NOW }) }
  sinon.stub(centrifuge, 'getClient').returns(thenable(client) as any)
  sinon.stub(centrifuge, 'getChainConfig').returns(thenable(sepolia) as any)
  sinon.stub(centrifuge as any, '_idToChain').callsFake((id: unknown) => thenable(CHAIN_ID[id as number]))
  // An entity binds `_transact` when it is built, so signing is stubbed first.
  const signed = signing || batching ? sign(centrifuge, client, batching) : { approves: [], sent: [], priced: [] }
  const shareClass = new ShareClass(centrifuge, new Pool(centrifuge, pool33Id), scId.raw)
  return { centrifuge, shareClass, reads, ...signed }
}

/**
 * Signs a write as a wallet would, or runs it inside a batch; records approves,
 * sent transactions and the messages priced. Fees are 7 wei.
 */
function sign(centrifuge: Centrifuge, client: object, isBatching = false) {
  const approves: { to: string; args: readonly unknown[] }[] = []
  const sent: { to: string; data: HexString; value: bigint }[] = []
  const priced: unknown[][] = []
  sinon.stub(centrifuge, '_estimate').callsFake(((...args: unknown[]) => (priced.push(args), thenable(7n))) as any)
  sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
    (async () => {
      const generator = callback({
        isBatching,
        signingAddress: signer,
        centrifugeId,
        walletClient: {
          getChainId: async () => CHAIN_ID[centrifugeId],
          writeContract: async ({ address, functionName, args }: any) => {
            expect(functionName).to.equal('approve')
            approves.push({ to: address.toLowerCase(), args })
            return `0x${'22'.repeat(32)}`
          },
          sendTransaction: async ({ to, data, value }: any) => {
            sent.push({ to: to.toLowerCase(), data, value })
            return `0x${'11'.repeat(32)}`
          },
        },
        publicClient: {
          ...client,
          getCode: async () => undefined,
          waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
        },
        root: centrifuge,
      })
      while (!(await generator.next()).done) {
        /* consume statuses */
      }
    })()) as any)
  return { approves, sent, priced }
}

const sendData = (amount: bigint, destinationChainId: number) =>
  encodeFunctionData({
    abi: ABIS_V3_3.TokenBridge,
    functionName: 'send',
    args: [SHARE, amount, addressToBytes32(who), BigInt(destinationChainId), signer],
  })

async function rejection<T>(promise: PromiseLike<unknown>, type: new (...args: any[]) => T): Promise<T> {
  try {
    await promise
  } catch (error) {
    expect(error).to.be.instanceOf(type)
    return error as T
  }
  throw new Error('expected a refusal')
}

/** abi.encode of static words, written out by hand so it checks the viem encoding independently. */
const word = (hex: string, align: 'left' | 'right') =>
  align === 'left' ? hex.replace(/^0x/, '').padStart(64, '0') : hex.replace(/^0x/, '').padEnd(64, '0')

describe('ShareClass cross-chain transfer on v3.3', () => {
  afterEach(() => sinon.restore())

  describe('through TokenBridge', () => {
    it('builds TokenBridge.send for a non-bridger from a remote spoke, with the InitiateTransferShares manifest', async () => {
      const { centrifuge, shareClass } = setup({ allowance: 5n })
      const built = await centrifuge.buildOnly(shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), {
        fromAddress: signer,
      })
      expect(built.to.toLowerCase()).to.equal(addressesOf(SPOKE).tokenBridge!.toLowerCase())
      expect(built.data).to.equal(sendData(5n, CHAIN_ID[OTHER]!))
      expect(built.messages).to.deep.equal({
        [HUB]: [{ ...messageV3_3(MessageTypeV3_3.InitiateTransferShares, pool33Id), extraGasLimit: 0n }],
      })
    })

    it('builds TokenBridge.send from the hub chain, with the ExecuteTransferShares manifest', async () => {
      const { centrifuge, shareClass } = setup({ allowance: 10n })
      const built = await centrifuge.buildOnly(shareClass.crosschainTransferShares(HUB, SPOKE, who, 5n), {
        fromAddress: signer,
      })
      expect(built.to.toLowerCase()).to.equal(addressesOf(HUB).tokenBridge!.toLowerCase())
      expect(built.data).to.equal(sendData(5n, CHAIN_ID[SPOKE]!))
      expect(built.messages).to.deep.equal({
        [SPOKE]: [{ ...messageV3_3(MessageTypeV3_3.ExecuteTransferShares, pool33Id), extraGasLimit: 0n }],
      })
    })

    it("prices the leg the sender pays with TokenBridge's gas limits for the share class", async () => {
      const gasLimits = [70_000n, 90_000n] as const
      const remote = setup({ allowance: 5n, gasLimits })
      const fromSpoke = await remote.centrifuge.buildOnly(
        remote.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n),
        {
          fromAddress: signer,
        }
      )
      const initiate = { ...messageV3_3(MessageTypeV3_3.InitiateTransferShares, pool33Id), extraGasLimit: 70_000n }
      expect(fromSpoke.messages).to.deep.equal({ [HUB]: [initiate] })
      sinon.restore()

      const hub = setup({ allowance: 5n, gasLimits })
      const fromHub = await hub.centrifuge.buildOnly(hub.shareClass.crosschainTransferShares(HUB, SPOKE, who, 5n), {
        fromAddress: signer,
      })
      const execute = { ...messageV3_3(MessageTypeV3_3.ExecuteTransferShares, pool33Id), extraGasLimit: 90_000n }
      expect(fromHub.messages).to.deep.equal({ [SPOKE]: [execute] })

      // The fee is estimated over the payload GasService reads the extra gas from.
      expect(emptyMessage(initiate, '3.3')).to.equal(
        emptyMessageV3_3(MessageTypeV3_3.InitiateTransferShares, pool33Id.raw.toString(), undefined, 70_000n)
      )
      expect(emptyMessage(execute, '3.3')).to.not.equal(
        emptyMessageV3_3(MessageTypeV3_3.ExecuteTransferShares, pool33Id.raw.toString())
      )
      sinon.restore()

      const signed = setup({ allowance: 5n, gasLimits }, { signing: true })
      await signed.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n)
      expect(signed.priced).to.deep.equal([[SPOKE, HUB, [initiate]]])
    })

    it('approves the share token to TokenBridge, then sends with the message cost as value', async () => {
      const { shareClass, approves, sent } = setup({ allowance: 2n }, { signing: true })
      await shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n)
      const tokenBridge = addressesOf(SPOKE).tokenBridge!.toLowerCase()
      expect(approves).to.deep.equal([{ to: SHARE, args: [addressesOf(SPOKE).tokenBridge, 5n] }])
      expect(sent).to.deep.equal([{ to: tokenBridge, data: sendData(5n, CHAIN_ID[OTHER]!), value: 7n }])
    })

    it('skips the approve when the allowance covers the amount', async () => {
      const { shareClass, approves, sent } = setup({ allowance: 5n }, { signing: true })
      await shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n)
      expect(approves).to.deep.equal([])
      expect(sent).to.have.length(1)
    })

    it('keeps the direct Spoke call for a bridger', async () => {
      const { centrifuge, shareClass, reads } = setup({ bridger: true, allowance: 5n })
      const built = await centrifuge.buildOnly(shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), {
        fromAddress: signer,
      })
      const spokeCtx = resolveProtocolContext(pool33Id.raw.toString(), '3.3', {
        environment: 'testnet',
        centrifugeId: SPOKE,
      })
      const expected = builders.crosschainTransferShares(spokeCtx, {
        poolId: pool33Id.raw.toString(),
        scId: scId.raw,
        destinationCentrifugeId: String(OTHER),
        receiver: who,
        amount: '5',
        refundAddress: signer,
        senderAddress: signer,
      })
      expect(built.to.toLowerCase()).to.equal(expected.to.toLowerCase())
      expect(built.data).to.equal(expected.data)
      const allowance = reads.find((r) => r.functionName === 'allowance')!
      expect(allowance.args!.map((a) => String(a).toLowerCase())).to.deep.equal([
        signer,
        addressesOf(SPOKE).spoke!.toLowerCase(),
      ])
    })

    it('approves the share token to Spoke for a bridger, since Spoke pulls it with transferFrom', async () => {
      const { shareClass, approves, sent } = setup({ bridger: true, allowance: 0n }, { signing: true })
      await shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n)
      expect(approves).to.deep.equal([{ to: SHARE, args: [addressesOf(SPOKE).spoke, 5n] }])
      expect(sent.map((t) => t.to)).to.deep.equal([addressesOf(SPOKE).spoke!.toLowerCase()])
    })

    it('refuses a destination the source TokenBridge does not map, with InvalidBridgeChainError', async () => {
      const { shareClass, approves, sent } = setup({ allowance: 5n, mapped: 0 }, { signing: true })
      const error = await rejection(shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), InvalidBridgeChainError)
      expect(error).to.include({
        sourceCentrifugeId: SPOKE,
        destinationCentrifugeId: OTHER,
        destinationChainId: CHAIN_ID[OTHER],
        mappedCentrifugeId: 0,
      })
      expect(approves).to.deep.equal([])
      expect(sent).to.deep.equal([])
    })

    it('refuses a pool that has not made TokenBridge a bridger, with BridgeNotEnabledError', async () => {
      const { shareClass, approves, sent } = setup({ allowance: 0n, tokenBridgeEnabled: false }, { signing: true })
      const error = await rejection(shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), BridgeNotEnabledError)
      expect(error).to.include({ poolId: pool33Id.toString(), sourceCentrifugeId: SPOKE })
      expect(error.tokenBridge.toLowerCase()).to.equal(addressesOf(SPOKE).tokenBridge!.toLowerCase())
      expect(approves).to.deep.equal([])
      expect(sent).to.deep.equal([])
    })

    it('refuses a built transfer that would need an approve, and any batch', async () => {
      const short = setup({ allowance: 1n })
      const error = await rejection(
        short.centrifuge.buildOnly(short.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), {
          fromAddress: signer,
        }),
        Error
      )
      expect(error.message).to.match(/Approve it first/)
      sinon.restore()

      const batched = setup({ allowance: 5n }, { batching: true })
      const batch = await rejection(batched.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), Error)
      expect(batch.message).to.match(/NotBatchable/)
      expect(batched.sent).to.deep.equal([])
    })
  })

  describe('bridge circuit breaker', () => {
    const refusals: [string, ChainState, bigint, string][] = [
      ['paused', { paused: true, authorizations: 1n }, 5n, 'paused'],
      ['no limit set', { limits: [0n, 3600] }, 5n, 'limitUnset'],
      ['above rateMax', { limits: [4n, 3600] }, 5n, 'exceedsRateMax'],
      [
        'above what the open window has left',
        { limits: [10n, 3600], cumulative: [7n, NOW - 100n] },
        5n,
        'exceedsWindow',
      ],
    ]
    for (const [name, state, amount, reason] of refusals) {
      it(`refuses before signing when ${name}`, async () => {
        const { shareClass, approves, sent } = setup({ ...state, allowance: 0n }, { signing: true })
        const error = await rejection(shareClass.crosschainTransferShares(SPOKE, OTHER, who, amount), BridgeLimitError)
        expect(error).to.include({ reason, originCentrifugeId: SPOKE, destinationCentrifugeId: OTHER, amount })
        expect(error.poolId).to.equal(pool33Id.toString())
        expect(approves, 'nothing approved').to.deep.equal([])
        expect(sent, 'nothing sent').to.deep.equal([])
      })
    }

    it('proceeds with a warning for a hook that is not the breaker, since it cannot be judged', async () => {
      const warn = sinon.stub(console, 'warn')
      const { shareClass, sent } = setup({ hook: OTHER_HOOK, allowance: 5n }, { signing: true })
      await shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n)
      expect(sent).to.have.length(1)
      const warning = warn.getCalls().find((call) => String(call.args[0]).startsWith('Bridge limit:'))
      expect(String(warning?.args[0])).to.contain(OTHER_HOOK).and.contain('not checked')
    })

    it('refuses a bridger the same way, and a built transaction', async () => {
      const { centrifuge, shareClass } = setup({ bridger: true, limits: [0n, 3600] })
      const error = await rejection(
        centrifuge.buildOnly(shareClass.crosschainTransferShares(HUB, SPOKE, who, 5n), { fromAddress: signer }),
        BridgeLimitError
      )
      expect(error.reason).to.equal('limitUnset')
      expect(error.originCentrifugeId).to.equal(HUB)
    })

    it('passes a transfer a hub manager authorized, keyed by route, sender, receiver and amount', async () => {
      const { centrifuge, shareClass, reads } = setup({ limits: [0n, 3600], authorizations: 1n, allowance: 5n })
      await centrifuge.buildOnly(shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), { fromAddress: signer })
      const auth = reads.find((r) => r.functionName === 'authorizations')!
      expect(auth.address.toLowerCase()).to.equal(BREAKER.toLowerCase())
      const encoded = [
        word(`0x${pool33Id.raw.toString(16)}`, 'left'),
        word(scId.raw, 'right'),
        word(SPOKE.toString(16), 'left'),
        word(OTHER.toString(16), 'left'),
        word(signer, 'right'),
        word(who, 'right'),
        word('5', 'left'),
      ].join('')
      expect(auth.args).to.deep.equal([keccak256(`0x${encoded}` as Hex)])
    })

    it('passes once the window has closed, and with no hook at all', async () => {
      const closed = setup({ limits: [10n, 3600], cumulative: [10n, NOW - 3601n], allowance: 5n })
      await closed.centrifuge.buildOnly(closed.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), {
        fromAddress: signer,
      })
      sinon.restore()

      const none = setup({ hook: '0x0000000000000000000000000000000000000000', allowance: 5n })
      await none.centrifuge.buildOnly(none.shareClass.crosschainTransferShares(SPOKE, OTHER, who, 5n), {
        fromAddress: signer,
      })
    })
  })

  describe('before any read', () => {
    it('refuses a transfer to the source chain and a zero amount, on every route and version', async () => {
      const cases = [
        { state: {}, poolId: pool33Id },
        { state: { bridger: true }, poolId: pool33Id },
        { state: {}, poolId: pool32Id },
      ]
      for (const { state, poolId } of cases) {
        const { centrifuge, reads } = setup(state)
        const sc = new ShareClass(centrifuge, new Pool(centrifuge, poolId), ShareClassId.from(poolId, 1).raw)
        const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: signer })
        expect((await rejection(build(sc.crosschainTransferShares(SPOKE, SPOKE, who, 5n)), Error)).message).to.match(
          /same chain/
        )
        expect((await rejection(build(sc.crosschainTransferShares(SPOKE, OTHER, who, 0n)), Error)).message).to.match(
          /greater than 0/
        )
        expect(reads, `no read for ${poolId} ${JSON.stringify(state)}`).to.deep.equal([])
        sinon.restore()
      }
    })
  })

  describe('bridgeLimit', () => {
    it("returns the hub's latest values with a limit set, the window's tally from the book's guard", async () => {
      const { shareClass, reads } = setup({ limits: [1_000n, 3600], cumulative: [250n, NOW - 600n] })
      const limit = await shareClass.bridgeLimit(SPOKE)
      expect(limit).to.deep.equal({
        kind: 'circuitBreaker',
        originCentrifugeId: SPOKE,
        hook: BREAKER.toLowerCase(),
        paused: false,
        rateMax: 1_000n,
        rateWindow: 3600,
        used: 250n,
        windowStart: new Date(Number(NOW - 600n) * 1000),
        remaining: 750n,
        readAt: new Date(Number(NOW) * 1000),
      })
      expect(reads.every((r) => r.blockNumber === undefined)).to.equal(true)
      const cumulative = reads.find((r) => r.functionName === 'cumulative')!
      expect(cumulative.address).to.equal(GUARD)
      const key = keccak256(
        `0x${word(`0x${pool33Id.raw.toString(16)}`, 'left')}${word(scId.raw, 'right')}${word(SPOKE.toString(16), 'left')}` as Hex
      )
      expect(cumulative.args).to.deep.equal([BREAKER, key])
    })

    it('returns rateMax 0 and nothing left without a limit, and a closed window as unused', async () => {
      const unset = setup({ limits: [0n, 0] })
      expect(await unset.shareClass.bridgeLimit(SPOKE)).to.include({ rateMax: 0n, remaining: 0n, used: 0n })
      sinon.restore()

      const closed = setup({ limits: [100n, 60], cumulative: [100n, NOW - 61n] })
      expect(await closed.shareClass.bridgeLimit(SPOKE)).to.include({ used: 0n, remaining: 100n, windowStart: null })
    })

    it('answers none for a pool without a hook and for a v3.2 pool, unknown for another hook', async () => {
      const none = setup({ hook: '0x0000000000000000000000000000000000000000' })
      expect(await none.shareClass.bridgeLimit(SPOKE)).to.deep.equal({ kind: 'none', originCentrifugeId: SPOKE })
      sinon.restore()

      const v32 = setup()
      const shareClass32 = new ShareClass(
        v32.centrifuge,
        new Pool(v32.centrifuge, pool32Id),
        ShareClassId.from(pool32Id, 1).raw
      )
      expect(await shareClass32.bridgeLimit(SPOKE)).to.deep.equal({ kind: 'none', originCentrifugeId: SPOKE })
      expect(v32.reads).to.deep.equal([])
      sinon.restore()

      const other = setup({ hook: OTHER_HOOK })
      expect(await other.shareClass.bridgeLimit(SPOKE)).to.deep.equal({
        kind: 'unknown',
        originCentrifugeId: SPOKE,
        hook: OTHER_HOOK,
      })
    })
  })
})
