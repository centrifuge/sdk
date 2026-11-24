import { ABIS_V3_2, ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { keccak256 } from 'viem'
import { Centrifuge } from './Centrifuge.js'
import { RetryMessageError } from './errors.js'
import { stubChain } from './tests/utils.js'
import type { HexString } from './types/index.js'
import { makeThenable } from './utils/rx.js'

const MESSAGE = '0x0102030405' as HexString
const HASH = keccak256(MESSAGE)
const FROM = 1
const TWO_VERSIONS = 2
const ONE_VERSION = 3
const SIGNER = '0x1000000000000000000000000000000000000001' as HexString
const GATEWAY_V32 = '0x3200000000000000000000000000000000000032' as HexString
const GATEWAY_V33 = '0x3300000000000000000000000000000000000033' as HexString
const GATEWAY_ONLY = '0x3400000000000000000000000000000000000034' as HexString

const VERSIONS: Record<number, string[]> = { [TWO_VERSIONS]: ['3.2', '3.3'], [ONE_VERSION]: ['3.3'] }
const GATEWAYS: Record<string, HexString> = {
  [`${TWO_VERSIONS}:3.2`]: GATEWAY_V32,
  [`${TWO_VERSIONS}:3.3`]: GATEWAY_V33,
  [`${ONE_VERSION}:3.3`]: GATEWAY_ONLY,
}

async function setup(parkedOn: (gateway: HexString) => bigint) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const book = await centrifuge._addressBook()
  const registry = Object.create(book.registry, {
    versionsForChain: { value: (_environment: unknown, centrifugeId: number) => VERSIONS[centrifugeId] ?? [] },
  })
  sinon.stub(centrifuge, '_addressBook').resolves({ ...book, registry })
  const protocolContext = sinon.stub(centrifuge, 'protocolContext').callsFake(
    (target) =>
      makeThenable(
        of({
          gateway: GATEWAYS[`${(target as any).centrifugeId}:${(target as any).protocolVersion}`],
          contractAbis: (target as any).protocolVersion === '3.2' ? ABIS_V3_2 : ABIS_V3_3,
        })
      ) as any
  )
  const readContract = sinon
    .stub()
    .callsFake(
      async ({ address, functionName, args }: { address: HexString; functionName: string; args: unknown[] }) => {
        if (functionName !== 'failedMessages') throw new Error(`unexpected read ${functionName}`)
        expect(args).to.deep.equal([FROM, HASH])
        return parkedOn(address)
      }
    )
  stubChain(centrifuge, { readContract })
  return { centrifuge, readContract, protocolContext }
}

async function refusal(centrifuge: Centrifuge, to: number) {
  return centrifuge.buildOnly(centrifuge.retryMessage(FROM, to, MESSAGE), { fromAddress: SIGNER }).then(
    () => expect.fail('expected the retry to refuse'),
    (error: unknown) => {
      expect(error).to.be.instanceOf(RetryMessageError)
      return error as RetryMessageError
    }
  )
}

describe('retryMessage', () => {
  afterEach(() => sinon.restore())

  it('retries in the v3.2 Gateway that holds the message on a chain that also hosts v3.3', async () => {
    const { centrifuge, readContract, protocolContext } = await setup((gateway) => (gateway === GATEWAY_V32 ? 1n : 0n))

    const built = await centrifuge.buildOnly(centrifuge.retryMessage(FROM, TWO_VERSIONS, MESSAGE), {
      fromAddress: SIGNER,
    })

    expect(built.calls).to.have.length(1)
    expect(built.calls[0]!.to).to.equal(GATEWAY_V32)
    expect(readContract.callCount).to.equal(2)
    expect(readContract.args.map(([call]) => call.address)).to.have.members([GATEWAY_V32, GATEWAY_V33])
    expect(protocolContext.args.map(([target]) => target)).to.deep.equal([
      { centrifugeId: TWO_VERSIONS, protocolVersion: '3.2' },
      { centrifugeId: TWO_VERSIONS, protocolVersion: '3.3' },
    ])
  })

  it('throws before signing, naming the hash, when no Gateway holds the message', async () => {
    const { centrifuge } = await setup(() => 0n)

    const error = await refusal(centrifuge, TWO_VERSIONS)

    expect(error.reason).to.equal('not-parked')
    expect(error.messageHash).to.equal(HASH)
    expect(error.fromCentrifugeId).to.equal(FROM)
    expect(error.toCentrifugeId).to.equal(TWO_VERSIONS)
    expect(error.gateways).to.deep.equal([
      { protocolVersion: '3.2', gateway: GATEWAY_V32 },
      { protocolVersion: '3.3', gateway: GATEWAY_V33 },
    ])
    expect(error.message).to.match(/^No Gateway on centrifugeId 2 holds a failed message/)
    expect(error.message).to.contain(HASH)
    expect(error.message).to.contain(`checked v3.2 ${GATEWAY_V32}, v3.3 ${GATEWAY_V33}`)
  })

  it('throws before signing when more than one Gateway holds the message', async () => {
    const { centrifuge } = await setup(() => 1n)

    const error = await refusal(centrifuge, TWO_VERSIONS)

    expect(error.reason).to.equal('ambiguous')
    expect(error.gateways.map((g) => g.gateway)).to.deep.equal([GATEWAY_V32, GATEWAY_V33])
    expect(error.message).to.match(/^More than one Gateway on centrifugeId 2 holds a failed message/)
  })

  it('retries in the only Gateway of a single-version chain', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const built = await centrifuge.buildOnly(centrifuge.retryMessage(FROM, ONE_VERSION, MESSAGE), {
      fromAddress: SIGNER,
    })

    expect(built.calls[0]!.to).to.equal(GATEWAY_ONLY)
    expect(readContract.callCount).to.equal(1)
  })
})
