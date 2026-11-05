import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import type { BuiltTransaction } from '../types/transaction.js'
import { Price } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

const poolId = PoolId.from(1, 1)
const scId = ShareClassId.from(poolId, 1)
const OTHER_SC_ID = ShareClassId.from(poolId, 2)
const HUB = '0xa4a7bb3831958463b3fe3e27a6a160f764341953' as HexString
const PRICE = Price.fromFloat(1.05)
const UPDATED_AT = new Date('2026-05-05T09:41:07.512Z')

/** The pool is active on `networks`, and the share class is deployed on every one of them. */
function setup(networks: number[]) {
  const centrifuge = new Centrifuge({ environment: 'mainnet' })
  stubChain(centrifuge)
  sinon.stub(centrifuge as any, '_protocolAddresses').returns(makeThenable(of({ hub: HUB })))
  const pool = new Pool(centrifuge, poolId.raw)
  const shareClass = new ShareClass(centrifuge, pool, scId.raw)
  const details = new Map<number, sinon.SinonStub>()
  const poolNetworks = networks.map((centrifugeId) => {
    const network = new PoolNetwork(centrifuge, pool, centrifugeId)
    // A second share class on every network, so a check that ignored the id would pass anyway.
    const stub = sinon
      .stub(network, 'details')
      .returns(makeThenable(of({ isActive: true, activeShareClasses: [{ id: OTHER_SC_ID }, { id: scId }] })) as any)
    details.set(centrifugeId, stub)
    return network
  })
  sinon.stub(pool, 'activeNetworks').returns(makeThenable(of(poolNetworks)) as any)
  return { centrifuge, shareClass, details }
}

/** The networks the built batch carries a `notifySharePrice` for, sorted. */
function notified(built: BuiltTransaction): number[] {
  return built.calls
    .map((call) => decodeFunctionData({ abi: ABI.Hub, data: call.data }))
    .filter((call) => call.functionName === 'notifySharePrice')
    .map((call) => Number(call.args[2]))
    .sort((a, b) => a - b)
}

describe('ShareClass.updateSharePrice skipNetworks', () => {
  afterEach(() => sinon.restore())

  it('notifies every deployed network when nothing is skipped', async () => {
    const { centrifuge, shareClass } = setup([1, 2, 3])

    const built = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT))

    expect(notified(built)).to.deep.equal([1, 2, 3])
    expect(Object.keys(built.messages ?? {}).map(Number)).to.deep.equal([1, 2, 3])
  })

  it('leaves the skipped networks out of the batch and does not read them', async () => {
    const { centrifuge, shareClass, details } = setup([1, 2, 3])

    const built = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks: [2] }))

    expect(notified(built)).to.deep.equal([1, 3])
    expect(Object.keys(built.messages ?? {}).map(Number)).to.deep.equal([1, 3])
    // Not consulted at all: that is what lets an operator untick a chain whose RPC or bridge is down.
    expect(details.get(2)!.callCount).to.equal(0)
    expect(details.get(1)!.callCount).to.be.greaterThan(0)
  })

  it('ignores a skipped network the share class is not deployed on', async () => {
    const { centrifuge, shareClass } = setup([1, 2])

    const built = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks: [9] }))

    expect(notified(built)).to.deep.equal([1, 2])
  })

  it('skipping every deployed network leaves only the hub price update, with no message', async () => {
    const { centrifuge, shareClass } = setup([1, 2])

    const built = await centrifuge.buildOnly(shareClass.updateSharePrice(PRICE, UPDATED_AT, { skipNetworks: [1, 2] }))

    expect(built.calls).to.have.length(1)
    expect(decodeFunctionData({ abi: ABI.Hub, data: built.calls[0]!.data }).functionName).to.equal('updateSharePrice')
    expect(Object.keys(built.messages ?? {})).to.deep.equal([])
  })
})
