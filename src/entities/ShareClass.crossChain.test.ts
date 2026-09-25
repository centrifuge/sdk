import { expect } from 'chai'
import { Subject, firstValueFrom, of, skip, take } from 'rxjs'
import sinon from 'sinon'
import { zeroAddress } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { convertToEvmAddress } from '../utils/addresses.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

// crossChainTransferRestrictions / crossChainTransferStatus, stubbed rather than forked. What they
// can get wrong is which (from, to) pairs are asked on which chain, how the answers map back to
// blockedDestinations / inboundBlocked, and how a chain that can't be read degrades and recovers.

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const SPOKE = '0xec3582fcdc34078a4b7a8c75a5a3ae46f48525ab' as HexString
const HOOK = '0x3c5e7b28c4ff6f0bc8d9a9587992e96401e680a7' as HexString
const TOKEN = '0x5a0f93d040de44e78f251b03c43be9cf317dcf64' as HexString
const HOLDER = '0x227942bd9c3e4eca1b76e8199e407e6c52fdacd6' as HexString

type Call = { centrifugeId: number; from: HexString; to: HexString }

function setup(options: {
  chains: number[]
  /** Answer of `checkTransferRestriction(from, to)` on a chain. Defaults to true. */
  allowed?: (call: Call) => boolean
  /** Chains whose reads throw. Consulted on every read, so a test can flip it between emissions. */
  failing?: Set<number>
}) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const shareClass = new ShareClass(centrifuge, new Pool(centrifuge, poolId.raw), scId.raw)
  const calls: Call[] = []
  const events = new Map<number, Subject<unknown[]>>()

  sinon.stub(shareClass, 'deploymentPerNetwork').returns(
    of(
      options.chains.map((centrifugeId) => ({
        centrifugeId,
        shareTokenAddress: TOKEN,
        restrictionManagerAddress: HOOK,
        valuation: undefined,
      }))
    ) as any
  )
  sinon.stub(centrifuge as any, '_protocolAddresses').returns(of({ spoke: SPOKE }))
  sinon.stub(centrifuge as any, '_filteredEvents').callsFake((...args: unknown[]) => {
    const centrifugeId = args[2] as number
    if (!events.has(centrifugeId)) events.set(centrifugeId, new Subject())
    return events.get(centrifugeId)!
  })
  sinon.stub(centrifuge, 'getClient').callsFake(
    (centrifugeId: number) =>
      of({
        readContract: async ({ args }: { args: [HexString, HexString, bigint] }) => {
          const call = { centrifugeId, from: args[0], to: args[1] }
          calls.push(call)
          if (options.failing?.has(centrifugeId)) throw new Error(`rpc down on ${centrifugeId}`)
          return options.allowed?.(call) ?? true
        },
      }) as any
  )

  return { shareClass, calls, events }
}

const rep = convertToEvmAddress
const byChain = <T extends { centrifugeId: number }>(result: T[], centrifugeId: number) =>
  result.find((r) => r.centrifugeId === centrifugeId)!

describe('ShareClass cross-chain transfer restrictions', () => {
  afterEach(() => sinon.restore())

  it('reports nothing for a token on fewer than two chains, and the status is enabled', async () => {
    const { shareClass, calls } = setup({ chains: [1] })
    expect(await firstValueFrom(shareClass.crossChainTransferRestrictions())).to.deep.equal([])
    expect(await firstValueFrom(shareClass.crossChainTransferStatus())).to.equal(true)
    expect(calls).to.have.length(0)
  })

  it('asks each chain the outbound pair per destination and the inbound mint to the spoke', async () => {
    const { shareClass, calls } = setup({ chains: [1, 2, 3] })
    await firstValueFrom(shareClass.crossChainTransferRestrictions())

    const onEthereum = calls.filter((c) => c.centrifugeId === 1)
    expect(onEthereum).to.have.deep.members([
      { centrifugeId: 1, from: zeroAddress, to: SPOKE },
      { centrifugeId: 1, from: rep(1), to: rep(2) },
      { centrifugeId: 1, from: rep(1), to: rep(3) },
    ])
    expect(calls).to.have.length(3 * 3)
  })

  it('uses the holder as sender when given', async () => {
    const { shareClass, calls } = setup({ chains: [1, 2] })
    await firstValueFrom(shareClass.crossChainTransferRestrictions(HOLDER))
    expect(calls.filter((c) => c.to === rep(2))).to.deep.equal([{ centrifugeId: 1, from: HOLDER, to: rep(2) }])
  })

  it('maps the answers to blocked destinations and inbound per chain', async () => {
    // Ethereum can't send to Arbitrum; Base can't receive; Arbitrum is fully open.
    const { shareClass } = setup({
      chains: [1, 2, 3],
      allowed: ({ centrifugeId, from, to }) => {
        if (centrifugeId === 1 && to === rep(3)) return false
        if (centrifugeId === 2 && from === zeroAddress) return false
        return true
      },
    })
    const result = await firstValueFrom(shareClass.crossChainTransferRestrictions())

    expect(byChain(result, 1))
      .to.include({ inboundBlocked: false })
      .and.have.property('blockedDestinations')
      .deep.equal([3])
    expect(byChain(result, 2))
      .to.include({ inboundBlocked: true })
      .and.have.property('blockedDestinations')
      .deep.equal([])
    expect(byChain(result, 3))
      .to.include({ inboundBlocked: false })
      .and.have.property('blockedDestinations')
      .deep.equal([])
    expect(await firstValueFrom(shareClass.crossChainTransferStatus())).to.equal(false)
  })

  it('is enabled only when no chain blocks anything', async () => {
    const { shareClass } = setup({ chains: [1, 2, 3] })
    expect(await firstValueFrom(shareClass.crossChainTransferStatus())).to.equal(true)
  })

  it('reports a chain it cannot read as fully blocked, with the error, without failing the others', async () => {
    const warn = sinon.stub(console, 'warn')
    const { shareClass } = setup({ chains: [1, 2, 3], failing: new Set([2]) })
    const result = await firstValueFrom(shareClass.crossChainTransferRestrictions())

    expect(byChain(result, 2)).to.include({ inboundBlocked: true })
    expect(byChain(result, 2).blockedDestinations).to.deep.equal([1, 3])
    expect(String(byChain(result, 2).error)).to.match(/rpc down on 2/)
    expect(byChain(result, 1).error).to.equal(undefined)
    expect(byChain(result, 1).blockedDestinations).to.deep.equal([])
    expect(await firstValueFrom(shareClass.crossChainTransferStatus())).to.equal(false)
    expect(warn.called).to.equal(true)
  })

  it('re-reads a chain on its next UpdateMember event, also after a failed read', async () => {
    sinon.stub(console, 'warn')
    const failing = new Set([2])
    const { shareClass, events } = setup({ chains: [1, 2], failing })
    const query = shareClass.crossChainTransferRestrictions()
    const subscription = query.subscribe()

    const first = await firstValueFrom(query)
    expect(byChain(first, 2).error).to.not.equal(undefined)

    failing.delete(2)
    const second = firstValueFrom(query.pipe(skip(1), take(1)))
    events.get(2)!.next([{ args: { token: TOKEN, user: SPOKE } }])

    const result = await second
    expect(byChain(result, 2).error).to.equal(undefined)
    expect(byChain(result, 2).inboundBlocked).to.equal(false)
    subscription.unsubscribe()
  })
})
