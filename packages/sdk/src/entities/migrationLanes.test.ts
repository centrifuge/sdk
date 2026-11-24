import { expect } from 'chai'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import type { HexString } from '../types/index.js'
import { PoolId, type CentrifugeId } from '../utils/types.js'
import type { Call, Result } from './MigrationInputs.js'
import {
  epochMismatchOf,
  laneAdapters,
  laneCap,
  probeLaneCap,
  PROBE_CEILING,
  PROBE_FLOOR,
  rampIdRows,
  unregisteredRampIds,
  vaultLinkMismatchesOf,
} from './migrationLanes.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const HUB = 1 as CentrifugeId
const SPOKE = 2 as CentrifugeId
const POOL = PoolId.from(HUB, 7)
const MULTI = addr(0x10)
const LZ = addr(0x12)
const CL = addr(0x13)
const AXELAR = addr(0x14)

type Script = (call: Call) => unknown
class Fail {}
class Outage {}

function revertError() {
  const inner = new ContractFunctionRevertedError({ abi: [], functionName: 'estimate' })
  return new BaseError('reverted', { cause: inner })
}

function reader(script: Script) {
  const calls: Call[] = []
  const read = async (requested: readonly Call[]): Promise<Result[]> => {
    return requested.map((call) => {
      calls.push(call)
      const value = script(call)
      if (value instanceof Outage) return { status: 'failure', error: new Error('connection reset') }
      return value instanceof Fail ? { status: 'failure', error: revertError() } : { status: 'success', result: value }
    })
  }
  return { read, calls }
}

const session = (pool: bigint, installed: number, global: number) => (call: Call) => {
  const [, poolId] = call.args as [number, bigint]
  return poolId === pool ? installed : global
}

describe('laneAdapters', () => {
  it("reads the pool's own session once installed", async () => {
    const { read } = reader((call) => {
      switch (call.functionName) {
        case 'activeSessionId':
          return session(POOL.raw, 3, 1)(call)
        case 'quorum':
          return 2
        case 'adapters':
          return Number(call.args![3]) === 0 ? LZ : CL
        default:
          return new Fail()
      }
    })
    const lane = await laneAdapters(read, MULTI, POOL, SPOKE, LZ, CL)
    expect(lane).to.deep.equal({ installed: true, set: [LZ, CL] })
  })

  it('filters the global set to LayerZero and a Chainlink that quotes 7M before the install', async () => {
    const quoting = reader((call) => {
      switch (call.functionName) {
        case 'activeSessionId':
          return session(POOL.raw, 0, 1)(call)
        case 'quorum':
          return 3
        case 'adapters':
          return [LZ, CL, AXELAR][Number(call.args![3])]
        case 'estimate':
          return call.address === CL ? 1n : new Fail()
        default:
          return new Fail()
      }
    })
    expect(await laneAdapters(quoting.read, MULTI, POOL, SPOKE, LZ, CL)).to.deep.equal({
      installed: false,
      set: [LZ, CL],
    })
    const refusing = reader((call) => {
      switch (call.functionName) {
        case 'activeSessionId':
          return 0
        case 'quorum':
          return 2
        case 'adapters':
          return [LZ, CL][Number(call.args![3])]
        case 'estimate':
          return new Fail()
        default:
          return new Fail()
      }
    })
    expect(await laneAdapters(refusing.read, MULTI, POOL, SPOKE, LZ, CL)).to.deep.equal({ installed: false, set: [LZ] })
  })
})

describe('laneCap', () => {
  const capped = (cap: bigint) => (call: Call) => {
    const [, , gasLimit] = call.args as [number, HexString, bigint]
    return gasLimit <= cap ? 1n : new Fail()
  }

  it('bisects an adapter cap and reads no cap off one that quotes the ceiling', async () => {
    const { read, calls } = reader(capped(3_000_000n))
    const probe = await probeLaneCap(read, CL, SPOKE)
    expect(probe).to.deep.equal({ adapter: CL, cap: 3_000_000n, quotable: true })
    expect(calls.length).to.be.lessThan(32)
    expect(await probeLaneCap(reader(capped(PROBE_CEILING)).read, LZ, SPOKE)).to.deep.equal({
      adapter: LZ,
      cap: 0n,
      quotable: true,
    })
    expect(await probeLaneCap(reader(capped(PROBE_FLOOR - 1n)).read, AXELAR, SPOKE)).to.deep.equal({
      adapter: AXELAR,
      cap: 0n,
      quotable: false,
    })
  })

  it('keeps the tightest cap of the lane, 0 when nothing tightens', async () => {
    const { read } = reader((call) => (call.address === CL ? capped(7_000_000n)(call) : 1n))
    const lane = await laneCap(read, [LZ, CL], SPOKE)
    expect(lane.tightest).to.equal(7_000_000n)
    expect(lane.probed.map((p) => p.cap)).to.deep.equal([0n, 7_000_000n])
    expect((await laneCap(reader(() => 1n).read, [LZ], SPOKE)).tightest).to.equal(0n)
    const unquotable = await laneCap(
      reader((call) => (call.address === AXELAR ? new Fail() : 1n)).read,
      [LZ, AXELAR],
      SPOKE
    )
    expect(unquotable.tightest).to.equal(0n)
    expect(unquotable.unquotable).to.deep.equal([AXELAR])
  })

  it('refuses a probe whose read failed for anything but a revert', async () => {
    let refused = ''
    try {
      await probeLaneCap(
        reader((call) => ((call.args as [number, HexString, bigint])[2] > 1_000_000n ? new Outage() : 1n)).read,
        CL,
        SPOKE
      )
    } catch (error) {
      refused = (error as Error).message
    }
    expect(refused).to.match(/failed with something other than a revert/)
  })
})

describe('post-onboard checks', () => {
  it('names the first (class, asset) pair whose epoch pointers differ', () => {
    const pairs = [
      { scId: '0x01' as HexString, assetId: '5' },
      { scId: '0x01' as HexString, assetId: '6' },
    ]
    expect(
      epochMismatchOf(
        pairs,
        [
          [1, 1, 0, 0],
          [2, 2, 1, 1],
        ],
        [
          [1, 1, 0, 0],
          [2, 2, 1, 1],
        ]
      )
    ).to.equal('')
    expect(
      epochMismatchOf(
        pairs,
        [
          [1, 1, 0, 0],
          [2, 2, 1, 1],
        ],
        [
          [1, 1, 0, 0],
          [0, 0, 0, 0],
        ]
      )
    ).to.match(
      /class 0x01 asset 6 differ: v3\.2 \(deposit 2, issue 2, redeem 1, revoke 1\) against v3\.3 \(deposit 0, issue 0, redeem 0, revoke 0\)/
    )
  })

  it('lists the vaults whose v3.3 link state is not the recorded v3.2 one', () => {
    const vaults = [addr(0xd1), addr(0xd2), addr(0xd3)]
    expect(vaultLinkMismatchesOf(vaults, [true, false, true], [true, true, false])).to.deep.equal([
      { vault: addr(0xd2), wasLinked: false },
      { vault: addr(0xd3), wasLinked: true },
    ])
  })

  it('keeps the accounting ids the spoke registry answers zero for, once each', () => {
    expect(unregisteredRampIds([11n, 12n, 11n, 13n], [0n, 5n, 0n, 0n])).to.deep.equal([11n, 13n])
  })
})

describe('rampIdRows', () => {
  const USDC = `0x${'a1'.repeat(20)}` as HexString
  const USDS = `0x${'b2'.repeat(20)}` as HexString

  it('names each id by asset and kind, registered or not, in read order', () => {
    expect(rampIdRows([USDC, USDS], [11n, 12n, 21n, 22n], [0n, 5n, 0n, 0n])).to.deep.equal([
      { asset: USDC, kind: 'liability', tokenId: 11n, registered: false },
      { asset: USDC, kind: 'receipt', tokenId: 12n, registered: true },
      { asset: USDS, kind: 'liability', tokenId: 21n, registered: false },
      { asset: USDS, kind: 'receipt', tokenId: 22n, registered: false },
    ])
  })

  it('lists an asset two ramps share once, and nothing for a spoke with no ramp', () => {
    expect(rampIdRows([USDC, USDC], [11n, 12n, 11n, 12n], [0n, 0n, 0n, 0n])).to.have.length(2)
    expect(rampIdRows([], [], [])).to.deep.equal([])
  })
})
