import { ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, toHex } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from './Centrifuge.js'
import { Pool } from './entities/Pool.js'
import { randomAddress, stubChain, stubProjectedPools } from './tests/utils.js'
import type { HexString } from './types/index.js'
import { encodeBatchCalldata, wrapTransaction } from './utils/transaction.js'
import { PoolId } from './utils/types.js'

// The batch sender over a real `Centrifuge`: two transactions that each name their pool are merged into one multicall,
// and the real pre-send check reads a scripted hub chain before the single send.

const HUB_CHAIN = 2
const poolId = PoolId.from(HUB_CHAIN, 33)
const hub = randomAddress()
const SIGNER = '0x3333333333333333333333333333333333333333' as const
const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const NOW = 10_000
const instant = encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'notifyPool', args: [poolId.raw, 7, SIGNER] })
const delayed = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateHubManager',
  args: [poolId.raw, '0x4444444444444444444444444444444444444444', true],
})

function setup() {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  stubProjectedPools(centrifuge, [poolId], '3.3')
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
  const readContract = sinon.stub().callsFake(async ({ functionName, args }: { functionName: string; args: any[] }) => {
    switch (functionName) {
      case 'policy':
        return POLICY
      case 'authorizationDelay':
        return args[2] === instant ? 0 : 100
      case 'authId':
        return `0x${'cd'.repeat(32)}`
      case 'authorizedAfter':
        return 0
    }
    throw new Error(`unexpected read ${functionName}`)
  })
  stubChain(centrifuge, {
    readContract,
    getBlock: sinon.stub().resolves({ number: 1n, timestamp: BigInt(NOW) }),
    getCode: sinon.stub().resolves('0x'),
    waitForTransactionReceipt: sinon.stub().resolves({ status: 'success' }),
  })
  sinon.stub(Pool.prototype, 'hubExecutionPolicy').callsFake(() => of({ address: POLICY, expiry: 500n }) as any)

  const hubTransaction = (title: string, data: HexString) =>
    centrifuge._transact(async function* (ctx) {
      yield* wrapTransaction(title, ctx, { contract: hub, data, policy: { poolId } })
    }, HUB_CHAIN)
  return { centrifuge, sent, readContract, hubTransaction }
}

describe('Centrifuge.batchTransactions under a hub policy', () => {
  afterEach(() => sinon.restore())

  it('ends with OutOfPolicy listing only the delayed inner call, and signs and sends nothing', async () => {
    const { centrifuge, sent, hubTransaction } = setup()

    const statuses = await firstValueFrom(
      centrifuge
        .batchTransactions('Update', [hubTransaction('Notify', instant), hubTransaction('Managers', delayed)])
        .pipe(toArray())
    )

    expect(statuses.map((status) => status.type)).to.deep.equal(['OutOfPolicy'])
    const [outOfPolicy] = statuses as any[]
    expect(outOfPolicy.title).to.equal('Update')
    expect(outOfPolicy.calls).to.have.length(1)
    expect(outOfPolicy.calls[0]).to.deep.include({
      data: delayed,
      functionName: 'updateHubManager',
      status: 'needs-authorization',
      delay: 100n,
    })
    expect(sent).to.deep.equal([])
  })

  it('lists every inner call of the batch with its status, in the order they would be sent', async () => {
    const { centrifuge, hubTransaction } = setup()

    const statuses = await firstValueFrom(
      centrifuge
        .batchTransactions('Update', [hubTransaction('Notify', instant), hubTransaction('Managers', delayed)])
        .pipe(toArray())
    )

    expect((statuses[0] as any).batch).to.deep.equal([
      { data: instant, status: 'ready', deferred: false },
      { data: delayed, status: 'needs-authorization', deferred: false },
    ])
  })

  it('sends the one multicall when every inner call is ready', async () => {
    const { centrifuge, sent, hubTransaction } = setup()

    const statuses = await firstValueFrom(
      centrifuge
        .batchTransactions('Update', [hubTransaction('A', instant), hubTransaction('B', instant)])
        .pipe(toArray())
    )

    expect(statuses.map((status) => status.type)).to.deep.equal([
      'SigningTransaction',
      'TransactionPending',
      'TransactionConfirmed',
    ])
    expect(sent).to.have.length(1)
    expect((sent[0] as any).data).to.equal(encodeBatchCalldata([instant, instant]))
  })

  it('judges the batch as the connected wallet’s address', async () => {
    const { centrifuge, readContract, hubTransaction } = setup()

    await firstValueFrom(centrifuge.batchTransactions('Update', [hubTransaction('B', delayed)]).pipe(toArray()))

    const delayReads = readContract.getCalls().filter((call) => call.args[0].functionName === 'authorizationDelay')
    expect(delayReads.map((call) => call.args[0].args[1])).to.deep.equal([SIGNER])
  })
})
