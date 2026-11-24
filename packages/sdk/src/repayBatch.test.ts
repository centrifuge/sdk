import { ABIS_V3_2, ABIS_V3_3, addEstimateBuffer } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData, keccak256 } from 'viem'
import { Centrifuge } from './Centrifuge.js'
import { RepayBatchError } from './errors.js'
import { stubChain } from './tests/utils.js'
import type { HexString } from './types/index.js'
import { makeThenable } from './utils/rx.js'

const BATCH = '0x0102030405' as HexString
const HASH = keccak256(BATCH)
const TO = 1
const TWO_VERSIONS = 2
const ONE_VERSION = 3
const NO_VERSION = 4
const SHARED_GATEWAY = 5
const SHARED_GATEWAY_SPLIT_ADAPTERS = 6
const GAS_LIMIT = 300_000n
const ESTIMATE = 1_000n
const SIGNER = '0x1000000000000000000000000000000000000001' as HexString
const GATEWAY_V32 = '0x3200000000000000000000000000000000000032' as HexString
const GATEWAY_V33 = '0x3300000000000000000000000000000000000033' as HexString
const GATEWAY_ONLY = '0x3400000000000000000000000000000000000034' as HexString
const MULTI_V32 = '0xa320000000000000000000000000000000000032' as HexString
const MULTI_V33 = '0xa330000000000000000000000000000000000033' as HexString
const MULTI_ONLY = '0xa340000000000000000000000000000000000034' as HexString

const VERSIONS: Record<number, string[]> = {
  [TWO_VERSIONS]: ['3.2', '3.3'],
  [ONE_VERSION]: ['3.3'],
  [NO_VERSION]: [],
  [SHARED_GATEWAY]: ['3.2', '3.3'],
  [SHARED_GATEWAY_SPLIT_ADAPTERS]: ['3.2', '3.3'],
}
const CONTEXTS: Record<string, { gateway: HexString; multiAdapter: HexString }> = {
  [`${TWO_VERSIONS}:3.2`]: { gateway: GATEWAY_V32, multiAdapter: MULTI_V32 },
  [`${TWO_VERSIONS}:3.3`]: { gateway: GATEWAY_V33, multiAdapter: MULTI_V33 },
  [`${ONE_VERSION}:3.3`]: { gateway: GATEWAY_ONLY, multiAdapter: MULTI_ONLY },
  [`${SHARED_GATEWAY}:3.2`]: { gateway: GATEWAY_ONLY, multiAdapter: MULTI_ONLY },
  [`${SHARED_GATEWAY}:3.3`]: { gateway: GATEWAY_ONLY, multiAdapter: MULTI_ONLY },
  [`${SHARED_GATEWAY_SPLIT_ADAPTERS}:3.2`]: { gateway: GATEWAY_ONLY, multiAdapter: MULTI_V32 },
  [`${SHARED_GATEWAY_SPLIT_ADAPTERS}:3.3`]: { gateway: GATEWAY_ONLY, multiAdapter: MULTI_V33 },
}

async function setup(underpaidOn: (gateway: HexString) => bigint) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const book = await centrifuge._addressBook()
  const registry = Object.create(book.registry, {
    versionsForChain: { value: (_environment: unknown, centrifugeId: number) => VERSIONS[centrifugeId] ?? [] },
  })
  sinon.stub(centrifuge, '_addressBook').resolves({ ...book, registry })
  const protocolContext = sinon.stub(centrifuge, 'protocolContext').callsFake((target) => {
    const { centrifugeId, protocolVersion } = target as { centrifugeId: number; protocolVersion: string }
    return makeThenable(
      of({
        ...CONTEXTS[`${centrifugeId}:${protocolVersion}`],
        contractAbis: protocolVersion === '3.2' ? ABIS_V3_2 : ABIS_V3_3,
      })
    ) as any
  })
  const readContract = sinon
    .stub()
    .callsFake(
      async ({ address, functionName, args }: { address: HexString; functionName: string; args: unknown[] }) => {
        if (functionName === 'underpaid') {
          expect(args).to.deep.equal([TO, HASH])
          return [GAS_LIMIT, underpaidOn(address)]
        }
        if (functionName === 'estimate') {
          expect(args).to.deep.equal([TO, BATCH, GAS_LIMIT])
          return ESTIMATE
        }
        throw new Error(`unexpected read ${functionName}`)
      }
    )
  stubChain(centrifuge, { readContract })
  return { centrifuge, readContract, protocolContext }
}

function reads(readContract: sinon.SinonStub, functionName: string) {
  return readContract.args.map(([call]) => call).filter((call) => call.functionName === functionName)
}

async function build(centrifuge: Centrifuge, from: number, extraPayment?: bigint) {
  const built = await centrifuge.buildOnly(centrifuge.repayBatch(from, TO, BATCH, extraPayment), {
    fromAddress: SIGNER,
  })
  expect(built.calls).to.have.length(1)
  return built
}

async function refusal(centrifuge: Centrifuge, from: number) {
  return centrifuge.buildOnly(centrifuge.repayBatch(from, TO, BATCH), { fromAddress: SIGNER }).then(
    () => expect.fail('expected the repay to refuse'),
    (error: unknown) => {
      expect(error).to.be.instanceOf(RepayBatchError)
      return error as RepayBatchError
    }
  )
}

describe('repayBatch', () => {
  afterEach(() => sinon.restore())

  it('repays in the v3.2 Gateway that holds the batch, priced by the v3.2 MultiAdapter, on a chain that also hosts v3.3', async () => {
    const { centrifuge, readContract, protocolContext } = await setup((gateway) => (gateway === GATEWAY_V32 ? 1n : 0n))

    const built = await build(centrifuge, TWO_VERSIONS, 7n)

    expect(built.to).to.equal(GATEWAY_V32)
    expect(built.value).to.equal(addEstimateBuffer(ESTIMATE) + 7n)
    expect(decodeFunctionData({ abi: ABIS_V3_2.Gateway, data: built.data })).to.deep.include({
      functionName: 'repay',
      args: [TO, BATCH, SIGNER],
    })
    expect(reads(readContract, 'underpaid').map((read) => read.address)).to.have.members([GATEWAY_V32, GATEWAY_V33])
    expect(reads(readContract, 'estimate').map((read) => read.address)).to.deep.equal([MULTI_V32])
    expect(protocolContext.args.map(([target]) => target)).to.deep.equal([
      { centrifugeId: TWO_VERSIONS, protocolVersion: '3.2' },
      { centrifugeId: TWO_VERSIONS, protocolVersion: '3.3' },
    ])
  })

  it('repays in the v3.3 Gateway that holds the batch, priced by the v3.3 MultiAdapter', async () => {
    const { centrifuge, readContract } = await setup((gateway) => (gateway === GATEWAY_V33 ? 2n : 0n))

    const built = await build(centrifuge, TWO_VERSIONS)

    expect(built.to).to.equal(GATEWAY_V33)
    expect(built.value).to.equal(addEstimateBuffer(ESTIMATE))
    expect(decodeFunctionData({ abi: ABIS_V3_3.Gateway, data: built.data })).to.deep.include({
      functionName: 'repay',
      args: [TO, BATCH, SIGNER],
    })
    expect(reads(readContract, 'estimate').map((read) => read.address)).to.deep.equal([MULTI_V33])
  })

  it('throws before signing, naming the hash, when no Gateway holds the batch', async () => {
    const { centrifuge, readContract } = await setup(() => 0n)

    const error = await refusal(centrifuge, TWO_VERSIONS)

    expect(error.reason).to.equal('not-underpaid')
    expect(error.batchHash).to.equal(HASH)
    expect(error.fromCentrifugeId).to.equal(TWO_VERSIONS)
    expect(error.toCentrifugeId).to.equal(TO)
    expect(error.gateways).to.deep.equal([
      { protocolVersion: '3.2', gateway: GATEWAY_V32 },
      { protocolVersion: '3.3', gateway: GATEWAY_V33 },
    ])
    expect(error.message).to.match(/^No Gateway on centrifugeId 2 holds an underpaid batch/)
    expect(error.message).to.contain(HASH)
    expect(error.message).to.contain(`checked v3.2 ${GATEWAY_V32}, v3.3 ${GATEWAY_V33}`)
    expect(reads(readContract, 'estimate')).to.be.empty
  })

  it('throws before signing when more than one Gateway holds the batch', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const error = await refusal(centrifuge, TWO_VERSIONS)

    expect(error.reason).to.equal('ambiguous')
    expect(error.gateways.map((g) => g.gateway)).to.deep.equal([GATEWAY_V32, GATEWAY_V33])
    expect(error.message).to.match(/^More than one Gateway on centrifugeId 2 holds an underpaid batch/)
    expect(reads(readContract, 'estimate')).to.be.empty
  })

  it('refuses to build without a fromAddress, which would send the refund to the zero address', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const error = await centrifuge.buildOnly(centrifuge.repayBatch(TWO_VERSIONS, TO, BATCH)).then(
      () => expect.fail('expected the repay to refuse'),
      (error: unknown) => {
        expect(error).to.be.instanceOf(RepayBatchError)
        return error as RepayBatchError
      }
    )

    expect(error.reason).to.equal('no-refund-address')
    expect(error.batchHash).to.equal(HASH)
    expect(error.gateways).to.be.empty
    expect(error.message).to.contain('build it with a `fromAddress`')
    expect(readContract.called).to.equal(false)
  })

  it('repays in the only Gateway of a single-version chain', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const built = await build(centrifuge, ONE_VERSION)

    expect(built.to).to.equal(GATEWAY_ONLY)
    expect(reads(readContract, 'underpaid')).to.have.length(1)
    expect(reads(readContract, 'estimate').map((read) => read.address)).to.deep.equal([MULTI_ONLY])
  })

  it('refuses without reading when the chain hosts no protocol version', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const error = await refusal(centrifuge, NO_VERSION)

    expect(error.reason).to.equal('not-underpaid')
    expect(error.gateways).to.be.empty
    expect(error.message).to.contain('checked none')
    expect(readContract.called).to.equal(false)
  })

  it('counts a Gateway that two versions share with one MultiAdapter once', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const built = await build(centrifuge, SHARED_GATEWAY)

    expect(built.to).to.equal(GATEWAY_ONLY)
    expect(reads(readContract, 'underpaid')).to.have.length(1)
  })

  it('throws before signing when the holding Gateway is shared by versions with different MultiAdapters', async () => {
    const { centrifuge, readContract } = await setup(() => 1n)

    const error = await refusal(centrifuge, SHARED_GATEWAY_SPLIT_ADAPTERS)

    expect(error.reason).to.equal('ambiguous')
    expect(error.gateways).to.deep.equal([
      { protocolVersion: '3.2', gateway: GATEWAY_ONLY },
      { protocolVersion: '3.3', gateway: GATEWAY_ONLY },
    ])
    expect(error.message).to.contain(
      `shared by versions with different MultiAdapters: v3.2 ${MULTI_V32}, v3.3 ${MULTI_V33}`
    )
    expect(reads(readContract, 'underpaid')).to.have.length(1)
    expect(reads(readContract, 'estimate')).to.be.empty
  })
})
