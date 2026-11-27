import { of } from 'rxjs'
import sinon from 'sinon'
import { sepolia } from 'viem/chains'
import type { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { PoolNetwork } from '../entities/PoolNetwork.js'
import { makeThenable } from '../utils/rx.js'

export function randomAddress(): HexString {
  return `0x${Math.random().toString(16).slice(2).padStart(40, '0')}`
}

/**
 * Stubs the pools catalogue entry so a pool-scoped `protocolContext` resolves the given version
 * without an indexer. Every listed pool is projected on `protocolVersion` and `live`.
 */
export function stubProjectedPools(
  centrifuge: Centrifuge,
  poolIds: readonly { toString(): string }[],
  protocolVersion = '3.2'
) {
  sinon
    .stub(centrifuge as any, '_poolRows')
    .returns(of(poolIds.map((id) => ({ id: id.toString(), protocolVersion, migrationStatus: 'live' }))))
}

/**
 * Answers the migration rows a pool-scoped read on a v3.3 pool asks the indexer for with none,
 * so nothing leaves the process and no poll timer outlives the test.
 */
export function stubMigrationRows(centrifuge: Centrifuge) {
  const queryData = (centrifuge as any)._queryData.bind(centrifuge)
  sinon.stub(centrifuge as any, '_queryData').callsFake((name: unknown, ...rest: unknown[]) => {
    if (name === 'poolMigration') return of(null)
    if (name === 'poolMigrationSteps') return of([])
    return queryData(name, ...rest)
  })
}

/**
 * Stubs chain and client resolution so a real `_transact` build run needs no indexer or Tenderly fork.
 * Build mode never touches the wallet client, so these stubs are all the I/O it needs.
 */
type SimulateCallsStub = (args: { account: unknown; calls: unknown[] }) => Promise<{ results: unknown[] }>

export function simulatingClient(simulateCalls: SimulateCallsStub) {
  return {
    getBlock: async () => ({ gasLimit: 30_000_000n }),
    simulateBlocks: async ({ blocks }: { blocks: { calls: { account?: unknown }[] }[] }) => {
      const calls = blocks[0]!.calls
      const { results } = await simulateCalls({
        account: calls[0]?.account,
        calls: calls.map(({ account: _account, ...call }) => call),
      })
      return [{ calls: results }]
    },
  }
}

export function stubChain(centrifuge: Centrifuge, client: object = {}) {
  // The real methods return awaitable queries; a bare `of(...)` is not awaitable.
  const thenable = <T>(value: T) => makeThenable(of(value))
  sinon.stub(centrifuge as any, '_idToChain').returns(thenable(sepolia.id))
  sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
  sinon.stub(centrifuge as any, 'getClient').returns(thenable(notMigrating(client) as any))
}

/**
 * The migration gate reads the hub facade's `hubPhase` before any write; a
 * client whose reads do not answer it stands for a pool that never armed.
 */
export function notMigrating(client: object): object {
  const reads = (client as { readContract?: (call: { functionName: string }) => Promise<unknown> }).readContract
  return {
    ...client,
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'hubPhase') return 0
      if (!reads) throw new Error(`unexpected read ${call.functionName}`)
      return reads(call)
    },
  }
}

export function stubHubPoolSet(empty = false) {
  if ((PoolNetwork.prototype._hubHoldsNoPoolSet as any).restore) return
  sinon.stub(PoolNetwork.prototype, '_hubHoldsNoPoolSet').resolves(empty)
}

/** The protocol's global adapter set for a deploy route: each side's LayerZero adapter, 1/1. */
export function stubLayerZeroGlobalSet() {
  if ((PoolNetwork.prototype._globalAdapterSet as any).restore) return
  sinon.stub(PoolNetwork.prototype, '_globalAdapterSet').callsFake(async function (this: PoolNetwork, hubContext) {
    const spokeContext = await this._protocolContext()
    return {
      local: [hubContext.layerZeroAdapter!],
      remote: [spokeContext.layerZeroAdapter!],
      threshold: 1,
      recoveryIndex: 1,
      names: ['layerZero'],
    }
  })
}
