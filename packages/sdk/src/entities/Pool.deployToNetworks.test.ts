import { ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, toHex, zeroAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { randomAddress, stubChain, stubProjectedPools } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { wrapTransaction } from '../utils/transaction.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

// `deployToNetworks` with two networks that share the hub's transaction: one batch is sent, or none. The deploys are
// real transactions (`_transact`), so `batchTransactions` returns the thenable observable it returns in production,
// and a signer records what reaches the wallet. A stub that returns a plain observable would hide how the batch is
// handed on.

const HUB_CHAIN = 2
const poolId = PoolId.from(HUB_CHAIN, 33)
const hub = randomAddress()
const SIGNER = '0x3333333333333333333333333333333333333333' as const
const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const HOOK = '0x9999999999999999999999999999999999999999' as HexString
const targets = [3, 9].map((centrifugeId) => ({
  centrifugeId,
  shareClasses: [{ id: ShareClassId.from(poolId, 1), hook: HOOK }],
}))
const callFor = (centrifugeId: number) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'notifyPool', args: [poolId.raw, centrifugeId, SIGNER] })

type Setup = { version: '3.2' | '3.3'; policy: 'none' | 'delays' }

function setup({ version, policy }: Setup) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  stubProjectedPools(centrifuge, [poolId], version)
  const sent: unknown[] = []
  centrifuge.setSigner({
    async request({ method, params }: any) {
      switch (method) {
        case 'eth_accounts':
          return [SIGNER]
        case 'eth_chainId':
          return toHex(sepolia.id)
        case 'eth_sendTransaction':
          sent.push(params[0])
          return `0x${'ab'.repeat(32)}`
      }
      throw new Error(`Unknown method ${method}`)
    },
  })
  const readContract = sinon.stub().callsFake(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case 'policy':
        return policy === 'delays' ? POLICY : zeroAddress
      case 'authorizationDelay':
        return 100
      case 'authId':
        return `0x${'cd'.repeat(32)}`
      case 'authorizedAfter':
        return 0
    }
    throw new Error(`unexpected read ${functionName}`)
  })
  stubChain(centrifuge, {
    readContract,
    getBlock: sinon.stub().resolves({ number: 1n, timestamp: 10_000n }),
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon.stub().resolves({ status: 'success' }),
  })
  sinon.stub(Pool.prototype, 'hubExecutionPolicy').callsFake(() => of({ address: POLICY, expiry: 500n }) as any)
  // Every target is wired, so v3.3 takes the same single batch a v3.2 pool does.
  sinon.stub(PoolNetwork.prototype, '_hasPoolAdapters').resolves(true)
  sinon.stub(PoolNetwork.prototype, 'deploy').callsFake(function (this: PoolNetwork) {
    const data = callFor(this.centrifugeId)
    return centrifuge._transact(async function* (ctx) {
      yield* wrapTransaction('Deploy', ctx, { contract: hub, data, policy: { poolId } })
    }, HUB_CHAIN)
  })
  return { pool: new Pool(centrifuge, poolId), sent }
}

/** Every status of the stream, or the error that ended it. */
const run = (stream: Parameters<typeof firstValueFrom>[0]) =>
  firstValueFrom((stream as any).pipe(toArray())).then(
    (statuses) => ({ statuses: statuses as { type: string }[], error: undefined }),
    (error: Error) => ({ statuses: [] as { type: string }[], error })
  )

describe('Pool.deployToNetworks with every network in one batch', () => {
  afterEach(() => sinon.restore())

  for (const version of ['3.2', '3.3'] as const) {
    it(`streams the progress of the one batch it sends on a v${version} pool, and completes`, async () => {
      const { pool, sent } = setup({ version, policy: 'none' })

      const { statuses, error } = await run(pool.deployToNetworks(targets))

      expect(error, error?.message).to.equal(undefined)
      expect(statuses.map((status) => status.type)).to.deep.equal([
        'SigningTransaction',
        'TransactionPending',
        'TransactionConfirmed',
      ])
      expect(sent).to.have.length(1)
    })
  }

  it('ends in OutOfPolicy, and signs nothing, on a pool whose policy delays a call', async () => {
    const { pool, sent } = setup({ version: '3.3', policy: 'delays' })

    const { statuses, error } = await run(pool.deployToNetworks(targets))

    expect(error, error?.message).to.equal(undefined)
    expect(statuses.map((status) => status.type)).to.deep.equal(['OutOfPolicy'])
    expect(sent).to.deep.equal([])
  })

  it('resolves, when awaited, with the last status of the batch', async () => {
    const { pool } = setup({ version: '3.2', policy: 'none' })

    const result = (await pool.deployToNetworks(targets)) as { type: string }

    expect(result.type).to.equal('TransactionConfirmed')
  })
})
