import { ABIS_V3_2, defaultDeploymentRegistry, ProtocolVersionResolutionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  getAddress,
  HttpRequestError,
  parseAbi,
} from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { AdapterVersionMismatchError } from '../errors.js'
import type { HexString } from '../types/index.js'
import { addressToBytes32 } from '../utils/index.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// Testnet hosts v3.2 and v3.3 on Sepolia (hub) and Base Sepolia (spoke), each with its own MultiAdapter and
// adapters. The addresses come from the bundled registry; the chain is scripted with what Sepolia answered on
// 2026-11-09: each adapter's `entrypoint()` is its own version's MultiAdapter, and the two MultiAdapters hold
// different global (pool 0) sets toward Base Sepolia.

const HUB = 1
const SPOKE = 2
const pool32Id = PoolId.from(HUB, 32)
const pool33Id = PoolId.from(HUB, 33)
const signer = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString

const registry = defaultDeploymentRegistry()
const contracts = (version: string, centrifugeId: number) =>
  registry.getDeployment('testnet', version, centrifugeId).contracts as Record<string, HexString>
const v32 = contracts('3.2', HUB)
const v33 = contracts('3.3', HUB)
const v32Spoke = contracts('3.2', SPOKE)
const v33Spoke = contracts('3.3', SPOKE)
/** v3.2's Wormhole adapter: in v3.2's global set, not in the bundled registry. */
const wormhole32 = '0xfb5e002643da6743D211b1fd66Fe4f86FcC4E4bE' as HexString
/** v3.3's Hyperlane adapter: in v3.3's global set; the v3.3 schema does not name it yet (#853). */
const hyperlane33 = '0x4bECF046078577da8a1b7FAE642183F1BAd1F47F' as HexString
const noCode = '0x1111111111111111111111111111111111111111' as HexString

/** The global sets between Sepolia and Base Sepolia, as both chains' MultiAdapters hold them (same addresses). */
const globalSet32 = [v32.layerZeroAdapter!, wormhole32, v32.axelarAdapter!, v32.chainlinkAdapter!]
const globalSet33 = [v33.layerZeroAdapter!, v33.chainlinkAdapter!, hyperlane33]

const ENTRYPOINT_ABI = parseAbi(['function entrypoint() view returns (address)'])

/** Each chain's adapters answer their own version's MultiAdapter as `entrypoint()`. */
function entrypoints(centrifugeId: number) {
  const map = new Map<string, HexString>()
  for (const version of registry.versionsForChain('testnet', centrifugeId)) {
    const deployed = contracts(version, centrifugeId)
    for (const [name, address] of Object.entries(deployed)) {
      if (name.endsWith('Adapter') && name !== 'multiAdapter') map.set(address.toLowerCase(), deployed.multiAdapter!)
    }
  }
  map.set(wormhole32.toLowerCase(), contracts('3.2', centrifugeId).multiAdapter!)
  map.set(hyperlane33.toLowerCase(), contracts('3.3', centrifugeId).multiAdapter!)
  return map
}

type Read = { address: HexString; functionName: string; args?: readonly unknown[] }
type Overrides = {
  entrypoint?: (address: HexString) => unknown
  getCode?: (address: HexString) => unknown
}

/**
 * A scripted chain client. The adapters and both MultiAdapters have code; a MultiAdapter answers no `entrypoint()`
 * (it reverts, as Sepolia's does). Each MultiAdapter holds its version's pool 0 set toward the other chain.
 */
function chainClient(centrifugeId: number, overrides: Overrides = {}) {
  const byAdapter = entrypoints(centrifugeId)
  const multiAdapters = registry
    .versionsForChain('testnet', centrifugeId)
    .map((version) => contracts(version, centrifugeId).multiAdapter!.toLowerCase())
  const toward = centrifugeId === HUB ? SPOKE : HUB
  const reads: Read[] = []
  const getCode = async ({ address }: { address: HexString }) => {
    if (overrides.getCode) return overrides.getCode(address)
    const known = byAdapter.has(address.toLowerCase()) || multiAdapters.includes(address.toLowerCase())
    return known ? '0x60' : undefined
  }
  const readContract = async (read: Read) => {
    reads.push(read)
    const { address, functionName, args = [] } = read
    if (functionName === 'entrypoint') {
      if (overrides.entrypoint) return overrides.entrypoint(address)
      const entrypoint = byAdapter.get(address.toLowerCase())
      if (!entrypoint) {
        throw new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: [], functionName }), {
          abi: ENTRYPOINT_ABI,
          functionName,
          contractAddress: address,
        })
      }
      return entrypoint
    }
    const set = address.toLowerCase() === multiAdapters[0] ? globalSet32 : globalSet33
    if (args[0] !== toward || args[1] !== 0n) throw new Error(`unexpected MultiAdapter read ${functionName}(${args})`)
    switch (functionName) {
      case 'activeSessionId':
        return 1
      case 'quorum':
        return set.length
      case 'threshold':
        return set === globalSet32 ? 2 : 1
      case 'adapters':
        return set[Number(args[args.length - 1])]
    }
    throw new Error(`unexpected read ${functionName}`)
  }
  return { client: { getCode, readContract }, reads }
}

function setup(overrides: Overrides = {}) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
    ])
  )
  const chains = { [HUB]: chainClient(HUB, overrides), [SPOKE]: chainClient(SPOKE, overrides) }
  const thenable = <T>(value: T) => makeThenable(of(value))
  sinon.stub(centrifuge as any, '_idToChain').returns(thenable(sepolia.id))
  sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
  const getClient = sinon
    .stub(centrifuge as any, 'getClient')
    .callsFake((id: any) => thenable(chains[id as 1 | 2].client))
  sinon.stub(centrifuge, '_estimate').returns(thenable(0n) as any)
  const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: signer })
  return { centrifuge, chains, getClient, build }
}

/** As {@link setup}, with pool 33's migration activated on the hub while the spoke still reads `Offboarded`. */
function setupSpokeNotOnboarded() {
  const env = setup()
  const queryData = sinon.stub(env.centrifuge as any, '_queryData')
  queryData.withArgs('poolMigration').returns(
    of({
      migrationId: '3.2->3.3',
      poolId: pool33Id.toString(),
      targetVersion: '3.3',
      hubPhase: 'Activated',
      operator: signer,
      startedAt: '2026-11-01T00:00:00.000Z',
      spokes: [{ centrifugeId: String(SPOKE), phase: 'Offboarded', freezeGeneration: '1' }],
    })
  )
  queryData.callThrough()
  return env
}

const lower = (addresses: readonly string[]) => addresses.map((a) => a.toLowerCase())
const rpcDown = () => new HttpRequestError({ url: 'https://rpc.invalid', status: 503 })

async function refusal(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  expect.fail('expected the write to be refused')
}

describe('Pool adapters of the pool protocol version', () => {
  afterEach(() => sinon.restore())

  describe('globalAdapters', () => {
    it("reads a v3.2 pool's global set on the v3.2 MultiAdapter, not the hub chain's newest", async () => {
      const { centrifuge } = setup()

      const ofPool = await new Pool(centrifuge, pool32Id).globalAdapters(SPOKE)
      const ofChain = await centrifuge.globalAdapters(HUB, SPOKE)

      expect(ofPool).to.deep.equal({ adapters: lower(globalSet32), threshold: 2 })
      expect(ofChain).to.deep.equal({ adapters: lower(globalSet33), threshold: 1 })
    })

    it("reads a v3.3 pool's global set on the v3.3 MultiAdapter", async () => {
      const { centrifuge } = setup()

      expect(await new Pool(centrifuge, pool33Id).globalAdapters(SPOKE)).to.deep.equal({
        adapters: lower(globalSet33),
        threshold: 1,
      })
    })
  })

  describe('remoteGlobalAdapters', () => {
    it("reads the target's MultiAdapter of the pool's version, toward the hub", async () => {
      const { centrifuge, chains } = setup()

      const remote = await new Pool(centrifuge, pool32Id).remoteGlobalAdapters(SPOKE)

      expect(remote).to.deep.equal({ adapters: lower(globalSet32), threshold: 2 })
      const read = chains[SPOKE].reads.find((r) => r.functionName === 'quorum')!
      expect(read.address.toLowerCase()).to.equal(v32Spoke.multiAdapter!.toLowerCase())
      expect(read.args).to.deep.equal([HUB, 0n])
    })

    it("reads a v3.3 pool's set on the target's v3.3 MultiAdapter", async () => {
      const { centrifuge } = setup()

      expect(await new Pool(centrifuge, pool33Id).remoteGlobalAdapters(SPOKE)).to.deep.equal({
        adapters: lower(globalSet33),
        threshold: 1,
      })
    })
  })

  describe("a spoke between the hub's Activated and its own Onboarded", () => {
    it('reads its own context at v3.2 but its adapters at the hub version', async () => {
      const { centrifuge, chains } = setupSpokeNotOnboarded()
      const pool = new Pool(centrifuge, pool33Id)

      expect((await centrifuge.protocolContext({ poolId: pool33Id, centrifugeId: SPOKE })).protocolVersion).to.equal(
        '3.2'
      )
      expect((await pool.deployedAdapters(SPOKE)).layerZeroAdapter).to.equal(v33Spoke.layerZeroAdapter)
      expect(await pool.remoteGlobalAdapters(SPOKE)).to.deep.equal({ adapters: lower(globalSet33), threshold: 1 })
      const read = chains[SPOKE].reads.find((r) => r.functionName === 'quorum')!
      expect(read.address.toLowerCase()).to.equal(v33Spoke.multiAdapter!.toLowerCase())
    })

    it("accepts the spoke's v3.3 remote adapters in setAdapters", async () => {
      const { centrifuge, build } = setupSpokeNotOnboarded()

      const built = await build(
        new Pool(centrifuge, pool33Id).setAdapters([
          { centrifugeId: SPOKE, localAdapters: [v33.layerZeroAdapter!], remoteAdapters: [v33Spoke.layerZeroAdapter!] },
        ])
      )

      expect(built.to.toLowerCase()).to.equal(v33.hub!.toLowerCase())
    })

    it("refuses the spoke's v3.2 remote adapters in setAdapters, which cannot deliver the hub's v3.3 messages", async () => {
      const { centrifuge, build } = setupSpokeNotOnboarded()

      const error = await refusal(
        build(
          new Pool(centrifuge, pool33Id).setAdapters([
            {
              centrifugeId: SPOKE,
              localAdapters: [v33.layerZeroAdapter!],
              remoteAdapters: [v32Spoke.layerZeroAdapter!],
            },
          ])
        )
      )

      expect(error).to.be.instanceOf(AdapterVersionMismatchError)
      expect((error as AdapterVersionMismatchError).mismatches.map((m) => [m.side, m.adapter])).to.deep.equal([
        ['remote', v32Spoke.layerZeroAdapter],
      ])
    })
  })

  describe('deployedAdapters', () => {
    it("answers the adapters of a v3.2 pool's version on the hub and on a spoke", async () => {
      const { centrifuge } = setup()
      const pool = new Pool(centrifuge, pool32Id)

      for (const [centrifugeId, deployed] of [
        [HUB, v32],
        [SPOKE, v32Spoke],
      ] as const) {
        expect(await pool.deployedAdapters(centrifugeId)).to.deep.equal({
          axelarAdapter: deployed.axelarAdapter,
          wormholeAdapter: undefined,
          layerZeroAdapter: deployed.layerZeroAdapter,
          chainlinkAdapter: deployed.chainlinkAdapter,
          hyperlaneAdapter: undefined,
        })
      }
      // The chain-scoped read answers the newest version deployed there.
      expect((await centrifuge.adapters(SPOKE)).chainlinkAdapter).to.equal(v33Spoke.chainlinkAdapter)
    })

    it("answers the adapters of a v3.3 pool's version", async () => {
      const { centrifuge } = setup()

      expect(await new Pool(centrifuge, pool33Id).deployedAdapters(SPOKE)).to.deep.equal({
        axelarAdapter: v33Spoke.axelarAdapter,
        wormholeAdapter: undefined,
        layerZeroAdapter: v33Spoke.layerZeroAdapter,
        chainlinkAdapter: v33Spoke.chainlinkAdapter,
        hyperlaneAdapter: v33Spoke.hyperlaneAdapter,
      })
    })

    it("refuses a network where the pool's version is not deployed", async () => {
      const { centrifuge } = setup()
      // A book whose Base Sepolia deployment carries v3.3 only.
      const book = await centrifuge._addressBook()
      const onlyV33 = Object.create(book.registry, {
        versionsForChain: {
          value: (environment: Parameters<typeof book.registry.versionsForChain>[0], id: number) =>
            id === SPOKE ? ['3.3'] : book.registry.versionsForChain(environment, id),
        },
      })
      sinon.stub(centrifuge, '_addressBook').resolves({ ...book, registry: onlyV33 })

      const error = await refusal(new Pool(centrifuge, pool32Id).deployedAdapters(SPOKE) as any)

      expect(error).to.be.instanceOf(ProtocolVersionResolutionError)
    })
  })

  describe('setAdapters', () => {
    it('refuses a v3.3 adapter next to the v3.2 LayerZero of a v3.2 pool, on both sides, before signing', async () => {
      // Pool 281474976730687 on testnet: the cross-chain tab offered the v3.3 Chainlink adapter.
      const { centrifuge } = setup()
      const requests: string[] = []
      centrifuge.setSigner({
        request: async ({ method }: { method: string }) => {
          requests.push(method)
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [signer]
          if (method === 'eth_chainId') return `0x${sepolia.id.toString(16)}`
          throw new Error(`unexpected signer request: ${method}`)
        },
      } as any)
      const adapters = [v32.layerZeroAdapter!, v33.chainlinkAdapter!]

      const error = await refusal(
        new Pool(centrifuge, pool32Id).setAdapters([
          { centrifugeId: SPOKE, localAdapters: adapters, remoteAdapters: adapters, threshold: 1 },
        ]) as any
      )

      expect(error).to.be.instanceOf(AdapterVersionMismatchError)
      const refused = error as AdapterVersionMismatchError
      const mismatch = {
        targetCentrifugeId: SPOKE,
        adapter: v33.chainlinkAdapter,
        reason: 'otherVersion',
        entrypoint: v33.multiAdapter,
        adapterProtocolVersion: '3.3',
      }
      expect(refused.mismatches).to.deep.equal([
        { ...mismatch, centrifugeId: HUB, side: 'local', multiAdapter: v32.multiAdapter },
        { ...mismatch, centrifugeId: SPOKE, side: 'remote', multiAdapter: v32Spoke.multiAdapter },
      ])
      // The top-level fields repeat the first mismatch.
      expect(refused).to.include({ poolId: pool32Id.toString(), protocolVersion: '3.2', ...refused.mismatches[0] })
      expect(refused.message).to.contain('2 adapters').and.to.contain('belongs to protocol version 3.3')
      expect(refused.message).to.contain('pool.globalAdapters(2)').and.to.contain('pool.remoteGlobalAdapters(2)')
      expect(requests).to.not.include('eth_sendTransaction')
    })

    it("refuses a remote adapter of another version, judged by the target's MultiAdapter", async () => {
      const { centrifuge, build } = setup()

      const error = await refusal(
        build(
          new Pool(centrifuge, pool32Id).setAdapters([
            {
              centrifugeId: SPOKE,
              localAdapters: [v32.layerZeroAdapter!],
              remoteAdapters: [v33Spoke.layerZeroAdapter!],
            },
          ])
        )
      )

      expect(error).to.be.instanceOf(AdapterVersionMismatchError)
      expect((error as AdapterVersionMismatchError).mismatches).to.have.length(1)
      expect(error).to.include({
        centrifugeId: SPOKE,
        side: 'remote',
        adapter: v33Spoke.layerZeroAdapter,
        reason: 'otherVersion',
        multiAdapter: v32Spoke.multiAdapter,
        adapterProtocolVersion: '3.3',
      })
      expect((error as Error).message)
        .to.contain('pool.remoteGlobalAdapters(2)')
        .and.not.to.contain('pool.globalAdapters(')
    })

    it('refuses a v3.2 adapter for a v3.3 pool', async () => {
      const { centrifuge, build } = setup()

      const error = await refusal(
        build(
          new Pool(centrifuge, pool33Id).setAdapters([
            {
              centrifugeId: SPOKE,
              localAdapters: [v33.layerZeroAdapter!, v32.axelarAdapter!],
              remoteAdapters: [v33Spoke.layerZeroAdapter!, v32Spoke.axelarAdapter!],
              threshold: 1,
            },
          ])
        )
      )

      expect(error).to.be.instanceOf(AdapterVersionMismatchError)
      expect((error as AdapterVersionMismatchError).mismatches.map((m) => [m.side, m.adapter])).to.deep.equal([
        ['local', v32.axelarAdapter],
        ['remote', v32Spoke.axelarAdapter],
      ])
      expect(error).to.include({ protocolVersion: '3.3', reason: 'otherVersion', adapterProtocolVersion: '3.2' })
    })

    it('refuses a remote address with no contract on the target, as the hub address of another chain can be', async () => {
      // Testnet centrifugeId 9: v3.2 LayerZero is 0x24f3192d…, and the hub's 0x953716f8… has no code there.
      const { centrifuge, build } = setup()

      const error = await refusal(
        build(
          new Pool(centrifuge, pool32Id).setAdapters([
            { centrifugeId: SPOKE, localAdapters: [v32.layerZeroAdapter!], remoteAdapters: [noCode] },
          ])
        )
      )

      expect(error).to.be.instanceOf(AdapterVersionMismatchError)
      expect(error).to.include({
        side: 'remote',
        adapter: noCode,
        reason: 'noCode',
        entrypoint: null,
        adapterProtocolVersion: null,
      })
      expect((error as Error).message).to.contain('the RPC of centrifugeId 2 finds no contract there')
    })

    it('refuses a contract that answers no entrypoint', async () => {
      const { centrifuge, build } = setup()

      const error = await refusal(
        build(
          new Pool(centrifuge, pool32Id).setAdapters([
            { centrifugeId: SPOKE, localAdapters: [v32.multiAdapter!], remoteAdapters: [v32Spoke.layerZeroAdapter!] },
          ])
        )
      )

      expect(error).to.include({ side: 'local', reason: 'noEntrypoint', entrypoint: null })
    })

    it('reports an adapter bound to a MultiAdapter no version deploys', async () => {
      const elsewhere = '0x2222222222222222222222222222222222222222' as HexString
      const { centrifuge, build } = setup({ entrypoint: () => elsewhere })

      const error = await refusal(
        build(
          new Pool(centrifuge, pool32Id).setAdapters([
            { centrifugeId: SPOKE, localAdapters: [v32.layerZeroAdapter!], remoteAdapters: [v32.layerZeroAdapter!] },
          ])
        )
      )

      expect(error).to.include({ reason: 'unknownEntrypoint', entrypoint: elsewhere, adapterProtocolVersion: null })
    })

    for (const [what, overrides] of [
      ['code read', { getCode: () => Promise.reject(rpcDown()) }],
      ['entrypoint read', { entrypoint: () => Promise.reject(rpcDown()) }],
    ] as const) {
      it(`throws a failed ${what} as it is, not as a mismatch`, async () => {
        const { centrifuge, build } = setup(overrides)

        const error = await refusal(
          build(
            new Pool(centrifuge, pool32Id).setAdapters([
              { centrifugeId: SPOKE, localAdapters: [v32.layerZeroAdapter!], remoteAdapters: [v32.layerZeroAdapter!] },
            ])
          )
        )

        expect(error).to.be.instanceOf(HttpRequestError)
      })
    }

    it('needs a client for the target network', async () => {
      const { centrifuge, getClient, build } = setup()
      const missing = new Error('No client found for chain ID 84532')
      getClient.withArgs(SPOKE).throws(missing)

      const error = await refusal(
        build(
          new Pool(centrifuge, pool32Id).setAdapters([
            { centrifugeId: SPOKE, localAdapters: [v32.layerZeroAdapter!], remoteAdapters: [v32.layerZeroAdapter!] },
          ])
        )
      )

      expect(error).to.equal(missing)
    })

    it("builds a v3.2 pool's own global set, Wormhole included, reading each chain once per adapter", async () => {
      const { centrifuge, chains, build } = setup()
      const remote = await new Pool(centrifuge, pool32Id).remoteGlobalAdapters(SPOKE)

      const built = await build(
        new Pool(centrifuge, pool32Id).setAdapters([
          { centrifugeId: SPOKE, localAdapters: globalSet32, remoteAdapters: remote.adapters, threshold: 2 },
        ])
      )

      expect(built.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_2.Hub,
          functionName: 'setAdapters',
          args: [pool32Id.raw, SPOKE, globalSet32, remote.adapters.map(addressToBytes32), 2, 4, signer],
        })
      )
      const entrypointReads = (centrifugeId: 1 | 2) =>
        chains[centrifugeId].reads.filter((r) => r.functionName === 'entrypoint').map((r) => getAddress(r.address))
      expect(entrypointReads(HUB)).to.have.members(globalSet32.map((a) => getAddress(a)))
      expect(entrypointReads(SPOKE)).to.have.members(globalSet32.map((a) => getAddress(a)))
    })

    it("builds a v3.3 pool's own adapters", async () => {
      const { centrifuge, build } = setup()

      const built = await build(
        new Pool(centrifuge, pool33Id).setAdapters([
          {
            centrifugeId: SPOKE,
            localAdapters: [v33.layerZeroAdapter!],
            remoteAdapters: [v33Spoke.layerZeroAdapter!],
          },
        ])
      )

      expect(built.to.toLowerCase()).to.equal(v33.hub!.toLowerCase())
    })
  })
})
