import {
  ABIS_V3_2,
  addressBook,
  bookIdOf,
  DeployedContractVersionError,
  getDeployment,
  type AddressBook,
} from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { encodeFunctionData } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import { addressToBytes32 } from '../utils/index.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

const feeder = '0x2222222222222222222222222222222222222222'
const spokeCentrifugeId = 2
/** The OracleValuation the address book excludes on Plume and six other mainnet hubs. */
const excludedOracle = '0xCBdb6EFFC9b954D05dF89c747eCaa8A143c26E6D'

/**
 * OracleValuation still runs v3.1 (`updateFeeder(uint64,address,bool)`) on some mainnet hubs, while the bundled
 * 3.2 ABI encodes `updateFeeder(uint64,uint16,bytes32,bool)`, which reverts there (#711). The pool context resolves
 * for real against the bundled registry; only the pools entry and the chain are stubbed.
 */
describe('Pool.updateOracleValuationFeeder', () => {
  afterEach(() => sinon.restore())

  function setup(hubCentrifugeId: number, book?: AddressBook) {
    const centrifuge = new Centrifuge({
      environment: 'mainnet',
      ...(book && { addressBook: { book, allowUnsafeMainnet: true } }),
    })
    const poolId = PoolId.from(hubCentrifugeId, 1)
    stubChain(centrifuge)
    stubProjectedPools(centrifuge, [poolId])
    const oracleValuation = getDeployment('mainnet', '3.2', hubCentrifugeId).contracts.oracleValuation ?? excludedOracle
    return { centrifuge, pool: new Pool(centrifuge, poolId.raw), poolId, oracleValuation }
  }

  for (const hubCentrifugeId of [1, 3]) {
    it(`builds the bundled 3.2 calldata for a pool hubbed on centrifugeId ${hubCentrifugeId}`, async () => {
      const { centrifuge, pool, poolId, oracleValuation } = setup(hubCentrifugeId)

      const built = await centrifuge.buildOnly(
        pool.updateOracleValuationFeeder(oracleValuation, spokeCentrifugeId, feeder, true)
      )

      expect(built.to.toLowerCase()).to.equal(oracleValuation.toLowerCase())
      expect(built.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_2.OracleValuation,
          functionName: 'updateFeeder',
          args: [poolId.raw, spokeCentrifugeId, addressToBytes32(feeder), true],
        })
      )
    })
  }

  it('refuses a pool hubbed on centrifugeId 4 (Plume), whose book lists no OracleValuation, before signing', async () => {
    const { centrifuge, pool, oracleValuation } = setup(4)
    const requests: string[] = []
    centrifuge.setSigner({
      request: async ({ method }: { method: string }) => {
        requests.push(method)
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [feeder]
        if (method === 'eth_chainId') return `0x${sepolia.id.toString(16)}`
        throw new Error(`unexpected signer request: ${method}`)
      },
    } as any)

    let error: unknown
    try {
      await pool.updateOracleValuationFeeder(oracleValuation, spokeCentrifugeId, feeder, true)
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(DeployedContractVersionError)
    expect(error).to.include({
      operation: 'Pool.updateOracleValuationFeeder',
      environment: 'mainnet',
      centrifugeId: 4,
      chainName: 'plume',
      contract: 'oracleValuation',
      protocolVersion: '3.2',
      address: null,
      bookDigest: null,
    })
    expect(requests).to.not.include('eth_sendTransaction')
    expect(requests).to.not.include('eth_signTypedData_v4')
  })

  it('builds for an OracleValuation other than the registry one, which the book does not describe', async () => {
    const { centrifuge, pool, poolId } = setup(1)
    const ownOracle = '0x3333333333333333333333333333333333333333'

    const built = await centrifuge.buildOnly(
      pool.updateOracleValuationFeeder(ownOracle, spokeCentrifugeId, feeder, true)
    )

    expect(built.to.toLowerCase()).to.equal(ownOracle)
    expect(built.data).to.equal(
      encodeFunctionData({
        abi: ABIS_V3_2.OracleValuation,
        functionName: 'updateFeeder',
        args: [poolId.raw, spokeCentrifugeId, addressToBytes32(feeder), true],
      })
    )
  })

  it('refuses any OracleValuation on centrifugeId 4, where the book lists none to tell it from', async () => {
    const { centrifuge, pool } = setup(4)
    const ownOracle = '0x3333333333333333333333333333333333333333'

    let error: unknown
    try {
      await centrifuge.buildOnly(pool.updateOracleValuationFeeder(ownOracle, spokeCentrifugeId, feeder, true))
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(DeployedContractVersionError)
  })

  it('refuses the same pool in build-only mode', async () => {
    const { centrifuge, pool, oracleValuation } = setup(4)

    let error: unknown
    try {
      await centrifuge.buildOnly(pool.updateOracleValuationFeeder(oracleValuation, spokeCentrifugeId, feeder, true))
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(DeployedContractVersionError)
  })

  describe('with a provided address book', () => {
    beforeEach(() => {
      sinon.stub(console, 'warn')
      sinon.stub(console, 'info')
    })

    /**
     * The bundled book with mainnet chain 1's v3.2 OracleValuation at `address`, recorded with the bundled
     * OracleValuation's ABI as `build-book` records every stack address, its `bookId` recomputed.
     */
    function bookWithOracleValuation(address: `0x${string}`): AddressBook {
      const book = structuredClone(addressBook)
      const chain = book.networks.mainnet.chains['1']!
      const stack = chain.stacks['v3.2.0']!
      const bundledRecord = chain.addresses[stack.oracleValuation!.toLowerCase() as `0x${string}`]!
      chain.addresses[address.toLowerCase() as `0x${string}`] ??= bundledRecord
      stack.oracleValuation = address
      return { ...book, bookId: bookIdOf(book) }
    }

    it('builds for a book that moves the v3.2 OracleValuation and records the v3.2 ABI digest for it', async () => {
      const otherOracle = '0x4444444444444444444444444444444444444444'
      const { centrifuge, pool, poolId } = setup(1, bookWithOracleValuation(otherOracle))

      const built = await centrifuge.buildOnly(
        pool.updateOracleValuationFeeder(otherOracle, spokeCentrifugeId, feeder, true)
      )

      expect(built.to.toLowerCase()).to.equal(otherOracle)
      expect(built.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_2.OracleValuation,
          functionName: 'updateFeeder',
          args: [poolId.raw, spokeCentrifugeId, addressToBytes32(feeder), true],
        })
      )
    })

    it('refuses any address when the book lists no OracleValuation on the hub chain', async () => {
      const book = structuredClone(addressBook)
      delete book.networks.mainnet.chains['1']!.stacks['v3.2.0']!.oracleValuation
      const { centrifuge, pool } = setup(1, { ...book, bookId: bookIdOf(book) })
      const ownOracle = '0x3333333333333333333333333333333333333333'

      let error: unknown
      try {
        await centrifuge.buildOnly(pool.updateOracleValuationFeeder(ownOracle, spokeCentrifugeId, feeder, true))
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(DeployedContractVersionError)
      expect(error).to.include({ centrifugeId: 1, contract: 'oracleValuation', address: null, bookDigest: null })
    })

    it('builds for a book that keeps the bundled OracleValuation', async () => {
      const bundled = getDeployment('mainnet', '3.2', 1).contracts.oracleValuation!
      const { centrifuge, pool } = setup(1, bookWithOracleValuation(bundled))

      const built = await centrifuge.buildOnly(
        pool.updateOracleValuationFeeder(bundled, spokeCentrifugeId, feeder, true)
      )

      expect(built.to.toLowerCase()).to.equal(bundled.toLowerCase())
    })
  })
})
