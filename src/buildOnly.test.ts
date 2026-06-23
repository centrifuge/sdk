import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, getAddress, parseAbi, toHex, zeroAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { ABI } from './abi/index.js'
import { Centrifuge } from './Centrifuge.js'
import { Pool } from './entities/Pool.js'
import { mockPoolMetadata } from './tests/mocks/mockPoolMetadata.js'
import { randomAddress } from './tests/utils.js'
import { HexString } from './types/index.js'
import { MessageType, MessageTypeWithSubType } from './types/transaction.js'
import { PoolId } from './utils/types.js'
import { makeThenable } from './utils/rx.js'
import { wrapTransaction } from './utils/transaction.js'

const chainId = sepolia.id
const centId = 1

// A tiny ABI used to produce deterministic calldata for the byte-equality checks.
const TEST_ABI = parseAbi([
  'function setValue(uint256 v)',
  'function setOwner(address owner)',
  'function multicall(bytes[] data) payable',
])

/**
 * Stub the chain-resolution methods so a real `_transact` build run can resolve
 * its `centrifugeId -> chainId` and clients without an indexer or a Tenderly
 * fork. `wrapTransaction`'s batching branch — which build mode uses — never
 * touches the (absent) wallet client, so these stubs are all the I/O it needs.
 */
function stubChain(centrifuge: Centrifuge) {
  // `buildOnly` and `_transact` await these, so return thenable values. The real
  // methods return awaitable Query observables; a bare `of(...)` is not thenable,
  // so use a thenable that yields the value when awaited.
  const thenable = <T>(value: T) => makeThenable(of(value))
  sinon.stub(centrifuge as any, '_idToChain').returns(thenable(chainId))
  sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
  sinon.stub(centrifuge as any, 'getClient').returns(thenable({} as any))
}

describe('buildOnly', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('builds calldata with no signer set', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [42n] })

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('Set value', ctx, { contract, data })
    }, centId)

    expect(centrifuge.signer).to.equal(null)
    const built = await centrifuge.buildOnly(tx)

    expect(built.to.toLowerCase()).to.equal(contract.toLowerCase())
    expect(built.data).to.equal(data)
    expect(built.value).to.equal(0n)
    expect(built.centrifugeId).to.equal(centId)
    expect(built.chainId).to.equal(chainId)
    expect(built.calls).to.have.length(1)
    expect(built.calls[0]!.data).to.equal(data)
  })

  it('produces byte-equal calldata for a single call', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [7n] })

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('Set value', ctx, { contract, data, value: 123n })
    }, centId)

    const built = await centrifuge.buildOnly(tx)
    // Single call is sent verbatim — no multicall wrapper.
    expect(built.data).to.equal(data)
    expect(built.value).to.equal(123n)
  })

  it('wraps multiple inner calls in multicall(bytes[]) byte-equally', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    const call1 = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [1n] })
    const call2 = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [2n] })

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('Set values', ctx, { contract, data: [call1, call2] })
    }, centId)

    const built = await centrifuge.buildOnly(tx)
    const expected = encodeFunctionData({ abi: TEST_ABI, functionName: 'multicall', args: [[call1, call2]] })
    expect(built.data).to.equal(expected)
    expect(built.calls).to.have.length(2)
    expect(built.calls.map((c) => c.data)).to.eql([call1, call2])
  })

  it('uses the zero address as signingAddress when no fromAddress is given', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    let seenSigningAddress: HexString | undefined

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      seenSigningAddress = ctx.signingAddress
      const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setOwner', args: [ctx.signingAddress] })
      yield* wrapTransaction('Set owner', ctx, { contract, data })
    }, centId)

    const built = await centrifuge.buildOnly(tx)
    expect(seenSigningAddress).to.equal(zeroAddress)
    const expected = encodeFunctionData({ abi: TEST_ABI, functionName: 'setOwner', args: [zeroAddress] })
    expect(built.data).to.equal(expected)
  })

  it('embeds a provided fromAddress as the build-time signingAddress', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    const from = randomAddress()
    let seenSigningAddress: HexString | undefined

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      seenSigningAddress = ctx.signingAddress
      const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setOwner', args: [ctx.signingAddress] })
      yield* wrapTransaction('Set owner', ctx, { contract, data })
    }, centId)

    const built = await centrifuge.buildOnly(tx, { fromAddress: from })
    // Checksummed so it matches what a wallet would produce.
    expect(seenSigningAddress).to.equal(getAddress(from))
    const expected = encodeFunctionData({ abi: TEST_ABI, functionName: 'setOwner', args: [getAddress(from)] })
    expect(built.data).to.equal(expected)
  })

  it('throws on an invalid fromAddress', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('Noop', ctx, { contract: randomAddress(), data: '0x' })
    }, centId)

    let error: unknown
    try {
      await centrifuge.buildOnly(tx, { fromAddress: 'not-an-address' as HexString })
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.contain('invalid fromAddress')
  })

  it('carries cross-chain messages through for fee estimation', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    const contract = randomAddress()
    const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [1n] })
    const messages: Record<number, MessageTypeWithSubType[]> = { 2: [MessageType.RegisterAsset] }

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('With messages', ctx, { contract, data, messages })
    }, centId)

    const built = await centrifuge.buildOnly(tx)
    expect(built.messages).to.eql(messages)
  })

  it('throws a descriptive error if a build callback dereferences walletClient or signer', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)

    const walletTx = (centrifuge as any)._transact(async function* (ctx: any) {
      // A method that needs to sign would touch the wallet client — invalid in build mode.
      void ctx.walletClient
      yield* wrapTransaction('Needs wallet', ctx, { contract: randomAddress(), data: '0x' })
    }, centId)

    let walletError: unknown
    try {
      await centrifuge.buildOnly(walletTx)
    } catch (e) {
      walletError = e
    }
    expect(walletError).to.be.instanceOf(Error)
    expect((walletError as Error).message).to.contain('build-only mode')
    expect((walletError as Error).message).to.contain('walletClient')

    const signerTx = (centrifuge as any)._transact(async function* (ctx: any) {
      void ctx.signer
      yield* wrapTransaction('Needs signer', ctx, { contract: randomAddress(), data: '0x' })
    }, centId)

    let signerError: unknown
    try {
      await centrifuge.buildOnly(signerTx)
    } catch (e) {
      signerError = e
    }
    expect(signerError).to.be.instanceOf(Error)
    expect((signerError as Error).message).to.contain('signer')
  })

  it('does not consume the signer when one is set', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge)
    // A signer whose `request` would throw if the build path ever touched it.
    const signer = {
      request: sinon.stub().rejects(new Error('signer must not be used in build mode')),
    }
    centrifuge.setSigner(signer as any)
    const contract = randomAddress()
    const data = encodeFunctionData({ abi: TEST_ABI, functionName: 'setValue', args: [9n] })

    const tx = (centrifuge as any)._transact(async function* (ctx: any) {
      yield* wrapTransaction('Set value', ctx, { contract, data })
    }, centId)

    const built = await centrifuge.buildOnly(tx)
    expect(built.data).to.equal(data)
    expect(signer.request.called).to.equal(false)
  })

  describe('real entity methods', () => {
    const poolId = PoolId.from(centId, 1)
    const hub = randomAddress()
    const cid = 'QmTestCidForBuildOnlyMetadata'

    // Drives a real entity method (Pool.updateMetadata) through buildOnly end to
    // end — pinning + address resolution + wrapTransaction — and asserts the
    // calldata is byte-equal to the known Hub.setPoolMetadata encoding. Stubs the
    // network I/O (indexer/IPFS) so it runs in the fast suite without Tenderly.
    function makeCentrifuge() {
      const centrifuge = new Centrifuge({
        environment: 'testnet',
        // Deterministic pin so the encoded CID is known.
        pinJson: async () => cid,
      })
      stubChain(centrifuge)
      sinon.stub(centrifuge as any, '_protocolAddresses').returns(makeThenable(of({ hub } as any)))
      return centrifuge
    }

    it('builds Pool.updateMetadata() byte-equal to the signing-path encoding', async () => {
      const centrifuge = makeCentrifuge()
      const pool = new Pool(centrifuge, poolId.raw)

      const built = await centrifuge.buildOnly(pool.updateMetadata(mockPoolMetadata))

      const expected = encodeFunctionData({
        abi: ABI.Hub,
        functionName: 'setPoolMetadata',
        args: [poolId.raw, toHex(cid)],
      })
      expect(built.to.toLowerCase()).to.equal(hub.toLowerCase())
      expect(built.data).to.equal(expected)
      expect(built.value).to.equal(0n)
      expect(built.chainId).to.equal(chainId)
      expect(built.calls).to.have.length(1)
      expect(built.calls[0]!.data).to.equal(expected)
    })

    it('builds a real entity method with no signer set', async () => {
      const centrifuge = makeCentrifuge()
      const pool = new Pool(centrifuge, poolId.raw)
      expect(centrifuge.signer).to.equal(null)
      const built = await centrifuge.buildOnly(pool.updateMetadata(mockPoolMetadata))
      expect(built.data).to.match(/^0x/)
    })
  })
})
