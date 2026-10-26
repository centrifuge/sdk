import { expect } from 'chai'
import { lastValueFrom, Observable, toArray } from 'rxjs'
import sinon from 'sinon'
import { ABI } from '../abi/index.js'
import { Balance } from '../utils/BigInt.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { OnOffRampManager } from './OnOffRampManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

const hubCentrifugeId = 1
const rampCentrifugeId = 13
const poolId = PoolId.from(hubCentrifugeId, 15)
const scId = ShareClassId.from(poolId, 1)
const ramp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const usdc = '0x4444444444444444444444444444444444444444'
const receiver = '0x5555555555555555555555555555555555555555'
const signingAddress = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}`

function subject() {
  const writeContract = sinon.stub().resolves(hash)
  const root: any = {
    _query: (_keys: unknown, callback: () => unknown) => callback(),
    _transact: (callback: (ctx: any) => AsyncGenerator<unknown>, centrifugeId: number) => {
      const tx = new Observable<unknown>((subscriber) => {
        const ctx = {
          isBatching: false,
          signingAddress,
          centrifugeId,
          root,
          walletClient: { writeContract },
          publicClient: {
            getCode: async () => '0x',
            waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
          },
        }
        ;(async () => {
          try {
            for await (const item of callback(ctx)) subscriber.next(item)
            subscriber.complete()
          } catch (error) {
            subscriber.error(error)
          }
        })()
      })
      return Object.assign(tx, { centrifugeId })
    },
  }
  const pool = new Pool(root, poolId.raw)
  const network = new PoolNetwork(root, pool, rampCentrifugeId)
  const manager = new OnOffRampManager(root, network, new ShareClass(root, pool, scId), ramp)
  return { manager, writeContract }
}

describe('OnOffRampManager deposit and withdraw', () => {
  afterEach(() => sinon.restore())

  for (const [method, title] of [
    ['deposit', 'Deposit'],
    ['withdraw', 'Withdraw'],
  ] as const) {
    it(`${method} calls the ramp on its own chain and confirms`, async () => {
      const { manager, writeContract } = subject()

      const tx = manager[method](usdc, Balance.fromFloat(10, 6), receiver)
      const statuses = (await lastValueFrom(tx.pipe(toArray()))) as { type: string; title: string }[]

      expect(tx.centrifugeId).to.equal(rampCentrifugeId)
      expect(statuses.map(({ type, title }) => [type, title])).to.deep.equal([
        ['SigningTransaction', title],
        ['TransactionPending', title],
        ['TransactionConfirmed', title],
      ])
      expect(writeContract.calledOnce).to.equal(true)
      expect(writeContract.firstCall.args[0]).to.deep.equal({
        address: ramp,
        abi: ABI.OnOffRampManager,
        functionName: method,
        args: [usdc, 0n, 10_000_000n, receiver],
      })
    })
  }
})
