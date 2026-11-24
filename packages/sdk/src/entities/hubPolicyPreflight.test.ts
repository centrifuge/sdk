import { ABIS_V3_3 } from '@centrifuge/protocol'
import type { HubPolicyRow, PoolAuthorizationEventRow } from '@centrifuge/queries/core'
import { expect } from 'chai'
import { of, throwError } from 'rxjs'
import sinon from 'sinon'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
} from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { HubPolicyPreflightError } from '../errors.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import { PoolId } from '../utils/types.js'
import { classifyHubCalls } from './hubPolicyPreflight.js'
import { Pool } from './Pool.js'

// A real Centrifuge reads a scripted hub chain. The pool's hub chain is 2, so a read that lands on chain 1 (the
// default client of a transaction context) is a read on the wrong chain.

const HUB_CHAIN = 2
const poolId = PoolId.from(HUB_CHAIN, 33)
const otherPoolId = PoolId.from(HUB_CHAIN, 34)
const v32PoolId = PoolId.from(HUB_CHAIN, 32)
const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const OTHER_POLICY = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const SIGNER = '0x3333333333333333333333333333333333333333' as const
const MANAGER = '0x4444444444444444444444444444444444444444' as const
const NOW = 10_000n
const EXPIRY = 500n

const hubCall = (who: HexString = MANAGER, pool = poolId) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'updateHubManager', args: [pool.raw, who, true] })
const instantCall = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'notifyPool',
  args: [poolId.raw, 7, SIGNER],
})
const delayedCall = hubCall()
const AUTH_ID = keccak256(toHex('auth'))
const SHARE_CLASS_ID = '0x00000000000000000000000000000001' as const
const SIMPLE_PRICE_MANAGER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const
// Both overloads of updateSharePrice: the three-argument one the SDK sends and the one with a computation time.
const sharePriceCall = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateSharePrice',
  args: [poolId.raw, SHARE_CLASS_ID, 10n ** 18n],
})
const sharePriceCallWithTime = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateSharePrice',
  args: [poolId.raw, SHARE_CLASS_ID, 10n ** 18n, 1_700_000_000n],
})

const revert = (errorName: 'CallerNotAllowed' | 'OnchainAccountingOnly') =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: STD_HUB_POLICY_ABI,
      functionName: 'authorizationDelay',
      data: encodeErrorResult({ abi: STD_HUB_POLICY_ABI, errorName }),
    }),
    { abi: STD_HUB_POLICY_ABI, functionName: 'authorizationDelay', args: [poolId.raw, SIGNER, delayedCall] }
  )

type Chain = {
  installed?: string
  delays?: Map<string, number | Error>
  authorizedAfter?: number
  indexedAddress?: string | null
  indexedExpiry?: bigint | null
  indexError?: Error
  // What `expiry()` answers: seconds, a revert (the contract has no such view) or another failure.
  contractExpiry?: number | 'no answer' | Error
  blockError?: Error
  authIdError?: Error
  authorizedAfterError?: Error
  // What `onchainAccounting()` and `simplePriceManager()` answer: values, a revert (the contract has no such view) or
  // another failure.
  accounting?:
    { onchainAccounting: boolean; simplePriceManager: string } | 'no answer' | 'no simplePriceManager' | Error
}

function setup(chain: Chain = {}) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  stubProjectedPools(centrifuge, [poolId, otherPoolId], '3.3')
  const readContract = sinon.stub().callsFake(async ({ functionName, args }: { functionName: string; args: any[] }) => {
    switch (functionName) {
      case 'policy':
        return chain.installed ?? POLICY
      case 'authorizationDelay': {
        const delay = chain.delays?.get(args[2]) ?? 100
        if (delay instanceof Error) throw delay
        return delay
      }
      case 'authId':
        if (chain.authIdError) throw chain.authIdError
        return AUTH_ID
      case 'authorizedAfter':
        if (chain.authorizedAfterError) throw chain.authorizedAfterError
        return chain.authorizedAfter ?? 0
      case 'expiry': {
        const expiry = chain.contractExpiry ?? Number(EXPIRY)
        if (expiry === 'no answer') throw new ContractFunctionRevertedError({ abi: STD_HUB_POLICY_ABI, functionName })
        if (expiry instanceof Error) throw expiry
        return expiry
      }
      case 'onchainAccounting':
      case 'simplePriceManager': {
        const guard = chain.accounting ?? { onchainAccounting: false, simplePriceManager: SIMPLE_PRICE_MANAGER }
        if (guard === 'no answer' || (guard === 'no simplePriceManager' && functionName === 'simplePriceManager')) {
          throw new ContractFunctionRevertedError({ abi: STD_HUB_POLICY_ABI, functionName })
        }
        if (guard instanceof Error) throw guard
        if (guard === 'no simplePriceManager') return true
        return functionName === 'onchainAccounting' ? guard.onchainAccounting : guard.simplePriceManager
      }
    }
    throw new Error(`unexpected read ${functionName}`)
  })
  const getBlock = chain.blockError
    ? sinon.stub().rejects(chain.blockError)
    : sinon.stub().resolves({ number: 1n, timestamp: NOW })
  stubChain(centrifuge, { readContract, getBlock })
  const indexed = chain.indexedAddress === null ? null : (chain.indexedAddress ?? POLICY)
  const index = sinon
    .stub(Pool.prototype, 'hubExecutionPolicy')
    .callsFake(() =>
      chain.indexError
        ? (throwError(() => chain.indexError) as any)
        : (of(
            indexed === null
              ? null
              : { address: indexed, expiry: chain.indexedExpiry === undefined ? EXPIRY : chain.indexedExpiry }
          ) as any)
    )
  return { centrifuge, readContract, getBlock, index }
}

const calls = (...datas: HexString[]) => datas.map((data) => ({ poolId, data }))
const readsOf = (readContract: sinon.SinonStub, functionName: string) =>
  readContract.getCalls().filter((c) => c.args[0].functionName === functionName)

describe('classifyHubCalls', () => {
  afterEach(() => sinon.restore())

  it('lets an instant call through without asking for an authorization', async () => {
    const { centrifuge, readContract } = setup({ delays: new Map([[instantCall, 0]]) })

    const out = await classifyHubCalls(centrifuge, SIGNER, calls(instantCall))

    expect(out).to.deep.equal([])
    expect(readsOf(readContract, 'authId')).to.have.length(0)
    expect(readsOf(readContract, 'authorizedAfter')).to.have.length(0)
  })

  it('lets a matured authorization through, at validAfter and at the last second of its expiry', async () => {
    for (const authorizedAfter of [Number(NOW), Number(NOW - EXPIRY)]) {
      const { centrifuge } = setup({ authorizedAfter })
      expect(await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))).to.deep.equal([])
      sinon.restore()
    }
  })

  it('reports a delayed call with nothing scheduled as needs-authorization', async () => {
    const { centrifuge } = setup({ authorizedAfter: 0 })

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    expect(call).to.deep.include({
      data: delayedCall,
      status: 'needs-authorization',
      delay: 100n,
      validAfter: null,
      expiresAt: null,
    })
  })

  it('reports an authorization that matures later as pending, with when it matures and no expiry', async () => {
    const { centrifuge } = setup({ authorizedAfter: Number(NOW) + 1 })

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    expect(call).to.deep.include({ status: 'pending', validAfter: NOW + 1n, expiresAt: null })
  })

  it('reports an authorization one second past its expiry as expired', async () => {
    const validAfter = NOW - EXPIRY - 1n
    const { centrifuge } = setup({ authorizedAfter: Number(validAfter) })

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    expect(call).to.deep.include({ status: 'expired', validAfter, expiresAt: validAfter + EXPIRY })
  })

  it('reports a matured authorization of unknown expiry as undetermined, and a pending one as pending', async () => {
    const matured = setup({ authorizedAfter: Number(NOW) - 1, contractExpiry: 'no answer', indexedExpiry: null })
    const [maturedCall] = await classifyHubCalls(matured.centrifuge, SIGNER, calls(delayedCall))
    sinon.restore()
    const pending = setup({ authorizedAfter: Number(NOW) + 1, contractExpiry: 'no answer', indexedExpiry: null })
    const [pendingCall] = await classifyHubCalls(pending.centrifuge, SIGNER, calls(delayedCall))

    expect(maturedCall).to.deep.include({ status: 'undetermined', validAfter: NOW - 1n, expiresAt: null })
    expect(pendingCall).to.deep.include({ status: 'pending', validAfter: NOW + 1n, expiresAt: null })
  })

  for (const errorName of ['CallerNotAllowed', 'OnchainAccountingOnly'] as const) {
    it(`reports a call whose delay read reverts with ${errorName} as forbidden`, async () => {
      const { centrifuge, readContract } = setup({ delays: new Map([[delayedCall, revert(errorName)]]) })

      const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

      expect(call).to.deep.include({
        status: 'forbidden',
        reason: errorName === 'CallerNotAllowed' ? 'callerNotAllowed' : 'accountingOnly',
        delay: null,
        validAfter: null,
        expiresAt: null,
      })
      expect(readsOf(readContract, 'authorizedAfter')).to.have.length(0)
    })
  }

  for (const [name, error] of [
    [
      'a bare revert',
      new ContractFunctionRevertedError({ abi: STD_HUB_POLICY_ABI, functionName: 'authorizationDelay' }),
    ],
    [
      'a custom error the policy ABI does not list',
      new ContractFunctionRevertedError({
        abi: STD_HUB_POLICY_ABI,
        functionName: 'authorizationDelay',
        data: '0xdeadbeef',
      }),
    ],
  ] as const) {
    it(`reports a call whose delay read reverts with ${name} as forbidden for another reason`, async () => {
      const wrapped = new ContractFunctionExecutionError(error, {
        abi: STD_HUB_POLICY_ABI,
        functionName: 'authorizationDelay',
        args: [poolId.raw, SIGNER, delayedCall],
      })
      const { centrifuge } = setup({ delays: new Map([[delayedCall, wrapped]]) })

      const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

      expect(call).to.deep.include({ status: 'forbidden', reason: 'other', delay: null })
    })
  }

  it('gives no reason to a call that is not forbidden', async () => {
    const { centrifuge } = setup()

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    expect(call).to.deep.include({ status: 'needs-authorization', reason: null })
  })

  it('fails with a clear error, never a ready call, when the delay read fails for another reason', async () => {
    const { centrifuge } = setup({ delays: new Map([[delayedCall, new Error('rpc unavailable')]]) })

    let error: unknown
    try {
      await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(HubPolicyPreflightError)
    expect((error as Error).message)
      .to.contain('rpc unavailable')
      .and.to.contain(poolId.toString())
  })

  it('fails with a clear error when the installed policy cannot be read', async () => {
    const { centrifuge, readContract } = setup()
    readContract.withArgs(sinon.match({ functionName: 'policy' })).rejects(new Error('rpc unavailable'))

    let error: unknown
    try {
      await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(HubPolicyPreflightError)
  })

  for (const [read, chain] of [
    ['the block time', { blockError: new Error('block unavailable') }],
    ['the authorization id', { authIdError: new Error('authId unavailable') }],
    ['the authorization time', { authorizedAfterError: new Error('authorizedAfter unavailable') }],
  ] as const) {
    it(`fails with a clear error, and never lets the call through, when reading ${read} fails`, async () => {
      const { centrifuge } = setup(chain)

      const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

      expect(error).to.be.instanceOf(HubPolicyPreflightError)
      expect((error as Error).message)
        .to.contain('unavailable')
        .and.to.contain(poolId.toString())
    })
  }

  it('fails with a clear error when the pool’s protocol context cannot be resolved', async () => {
    const { centrifuge } = setup()
    sinon.stub(centrifuge, 'protocolContext').throws(new Error('no version for this pool'))

    const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

    expect(error).to.be.instanceOf(HubPolicyPreflightError)
    expect((error as Error).message).to.contain('no version for this pool')
  })

  it('fails with a clear error when the hub chain has no client', async () => {
    const { centrifuge } = setup()
    ;(centrifuge.getClient as unknown as sinon.SinonStub).returns(Promise.reject(new Error('no client for chain 2')))

    const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

    expect(error).to.be.instanceOf(HubPolicyPreflightError)
    expect((error as Error).message).to.contain('no client for chain 2')
  })

  describe('a share price update under onchain accounting', () => {
    const guarded = { onchainAccounting: true, simplePriceManager: SIMPLE_PRICE_MANAGER }

    for (const [name, data] of [
      ['updateSharePrice', sharePriceCall],
      ['updateSharePrice with a computation time', sharePriceCallWithTime],
    ] as const) {
      it(`is forbidden for a signer that is not the SimplePriceManager: ${name}`, async () => {
        const { centrifuge } = setup({ accounting: guarded, delays: new Map([[data, 0]]) })

        const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(data))

        expect(call).to.deep.include({ status: 'forbidden', reason: 'accountingOnly', delay: null })
      })
    }

    it('is forbidden even when the policy would delay it and an authorization has matured', async () => {
      const { centrifuge } = setup({ accounting: guarded, authorizedAfter: Number(NOW) })

      const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(sharePriceCall))

      expect(call).to.deep.include({ status: 'forbidden', reason: 'accountingOnly' })
    })

    it('is ready for the SimplePriceManager when the policy lets the move through', async () => {
      const { centrifuge } = setup({ accounting: guarded, delays: new Map([[sharePriceCall, 0]]) })

      expect(await classifyHubCalls(centrifuge, SIMPLE_PRICE_MANAGER, calls(sharePriceCall))).to.deep.equal([])
    })

    it('compares the signer and the SimplePriceManager whatever their casing', async () => {
      const { centrifuge } = setup({
        accounting: { onchainAccounting: true, simplePriceManager: getAddress(SIMPLE_PRICE_MANAGER) },
        delays: new Map([[sharePriceCall, 0]]),
      })

      expect(await classifyHubCalls(centrifuge, SIMPLE_PRICE_MANAGER, calls(sharePriceCall))).to.deep.equal([])
    })

    it('keeps the policy’s own verdict when onchain accounting is off', async () => {
      const { centrifuge } = setup({
        accounting: { onchainAccounting: false, simplePriceManager: SIMPLE_PRICE_MANAGER },
        authorizedAfter: 0,
      })

      const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(sharePriceCall))

      expect(call).to.deep.include({ status: 'needs-authorization', reason: null, delay: 100n })
    })

    for (const accounting of ['no answer', 'no simplePriceManager'] as const) {
      it(`keeps the policy’s own verdict when the policy cannot answer a view (${accounting})`, async () => {
        const { centrifuge } = setup({ accounting, delays: new Map([[sharePriceCall, 0]]) })

        expect(await classifyHubCalls(centrifuge, SIGNER, calls(sharePriceCall))).to.deep.equal([])
      })
    }

    it('fails with a clear error when a view fails to answer for another reason', async () => {
      const { centrifuge } = setup({ accounting: new Error('rpc unavailable') })

      const error = await classifyHubCalls(centrifuge, SIGNER, calls(sharePriceCall)).catch((e: unknown) => e)

      expect(error).to.be.instanceOf(HubPolicyPreflightError)
      expect((error as Error).message).to.contain('rpc unavailable')
    })

    it('reads the two views once per policy, and only for a share price update', async () => {
      const { centrifuge, readContract } = setup({
        accounting: guarded,
        delays: new Map([
          [sharePriceCall, 0],
          [sharePriceCallWithTime, 0],
          [instantCall, 0],
        ]),
      })

      await classifyHubCalls(centrifuge, SIMPLE_PRICE_MANAGER, calls(sharePriceCall, sharePriceCallWithTime))
      await classifyHubCalls(centrifuge, SIMPLE_PRICE_MANAGER, calls(sharePriceCall))
      const afterShareClassPrices = readContract.callCount
      await classifyHubCalls(centrifuge, SIGNER, calls(instantCall))

      expect(readsOf(readContract, 'onchainAccounting')).to.have.length(1)
      expect(readsOf(readContract, 'simplePriceManager')).to.have.length(1)
      expect(readContract.callCount - afterShareClassPrices).to.equal(2)
    })
  })

  it('reports only the calls that are not ready, in transaction order, with their decoded arguments', async () => {
    const second = hubCall('0x5555555555555555555555555555555555555555')
    const { centrifuge } = setup({ delays: new Map([[instantCall, 0]]) })

    const out = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall, instantCall, second))

    expect(out.map((call) => call.data)).to.deep.equal([delayedCall, second])
    expect(out[0]).to.deep.include({ functionName: 'updateHubManager' })
    expect(out[0]?.args).to.deep.equal({ poolId: poolId.raw, who: MANAGER, canManage: true })
  })

  it('names no function and no arguments for a selector the Hub ABI does not carry', async () => {
    const unknown = '0xdeadbeef00' as HexString
    const { centrifuge } = setup({ delays: new Map([[unknown, 100]]) })

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(unknown))

    expect(call).to.deep.include({ functionName: null, args: null })
  })

  it('asks the policy about the signer, the pool and the exact calldata, and the registry about its id', async () => {
    const { centrifuge, readContract } = setup({ authorizedAfter: 0 })

    await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    const [delay] = readsOf(readContract, 'authorizationDelay')
    expect(delay?.args[0]).to.deep.include({ address: POLICY, args: [poolId.raw, SIGNER, delayedCall] })
    expect(readsOf(readContract, 'authId')[0]?.args[0].args).to.deep.equal([poolId.raw, delayedCall])
    expect(readsOf(readContract, 'authorizedAfter')[0]?.args[0].args).to.deep.equal([AUTH_ID])
  })

  it('reads on the pool’s hub chain and nowhere else', async () => {
    const { centrifuge } = setup()

    await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    const requested = (centrifuge.getClient as unknown as sinon.SinonStub).args.map((args: unknown[]) => args[0])
    expect(requested).to.not.be.empty
    expect(requested.every((id: unknown) => id === HUB_CHAIN)).to.equal(true)
  })

  it('does nothing when no policy is installed, the zero address included', async () => {
    const { centrifuge, readContract, getBlock } = setup({ installed: zeroAddress })

    expect(await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))).to.deep.equal([])
    expect(readsOf(readContract, 'authorizationDelay')).to.have.length(0)
    expect(getBlock.called).to.equal(false)
  })

  it('does nothing on a v3.2 pool, and reads nothing', async () => {
    const v32 = new Centrifuge({ environment: 'testnet' })
    stubProjectedPools(v32, [v32PoolId], '3.2')
    const readContract = sinon.stub().rejects(new Error('unexpected read'))
    stubChain(v32, { readContract, getBlock: sinon.stub().rejects(new Error('unexpected read')) })

    const out = await classifyHubCalls(v32, SIGNER, [{ poolId: v32PoolId, data: delayedCall }])

    expect(out).to.deep.equal([])
    expect(readContract.called).to.equal(false)
  })

  describe('the policy’s expiry', () => {
    const unreadable = { contractExpiry: new Error('expiry unavailable'), indexError: new Error('indexer unavailable') }
    const expiryReads = (readContract: sinon.SinonStub) => readsOf(readContract, 'expiry')

    it('is not read for an instant call, so a failing contract read and a failing index do not block it', async () => {
      const { centrifuge, readContract, index } = setup({ delays: new Map([[instantCall, 0]]), ...unreadable })

      expect(await classifyHubCalls(centrifuge, SIGNER, calls(instantCall))).to.deep.equal([])
      expect(expiryReads(readContract)).to.have.length(0)
      expect(index.called).to.equal(false)
    })

    it('is not read for a call that needs an authorization, is pending or is forbidden', async () => {
      for (const [chain, status] of [
        [{ authorizedAfter: 0 }, 'needs-authorization'],
        [{ authorizedAfter: Number(NOW) + 1 }, 'pending'],
        [{ delays: new Map([[delayedCall, revert('CallerNotAllowed')]]) }, 'forbidden'],
      ] as const) {
        const { centrifuge, readContract, index } = setup({ ...chain, ...unreadable })

        const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

        expect(call?.status).to.equal(status)
        expect(expiryReads(readContract)).to.have.length(0)
        expect(index.called).to.equal(false)
        sinon.restore()
      }
    })

    it('is read from the installed policy’s contract the second an authorization matures, and not from the index', async () => {
      const { centrifuge, readContract, index } = setup({
        authorizedAfter: Number(NOW),
        indexError: unreadable.indexError,
      })

      expect(await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))).to.deep.equal([])

      expect(expiryReads(readContract)).to.have.length(1)
      expect(expiryReads(readContract)[0]?.args[0].address).to.equal(POLICY)
      expect(index.called).to.equal(false)
    })

    it('judges a matured authorization by the contract’s expiry, whatever the index holds', async () => {
      const validAfter = Number(NOW - EXPIRY - 1n)
      const shorter = setup({ authorizedAfter: validAfter, contractExpiry: Number(EXPIRY), indexedExpiry: 99_999n })
      const [expired] = await classifyHubCalls(shorter.centrifuge, SIGNER, calls(delayedCall))
      sinon.restore()
      const longer = setup({ authorizedAfter: validAfter, contractExpiry: 99_999, indexedExpiry: 1n })

      expect(expired).to.deep.include({ status: 'expired', expiresAt: NOW - 1n })
      expect(await classifyHubCalls(longer.centrifuge, SIGNER, calls(delayedCall))).to.deep.equal([])
    })

    it('is read once per pool however many matured calls it judges', async () => {
      const { centrifuge, readContract } = setup({ authorizedAfter: Number(NOW) })

      await classifyHubCalls(
        centrifuge,
        SIGNER,
        calls(delayedCall, hubCall('0x5555555555555555555555555555555555555555'))
      )

      expect(expiryReads(readContract)).to.have.length(1)
    })

    it('falls back to the index when the contract has no expiry() view', async () => {
      const { centrifuge, index } = setup({
        contractExpiry: 'no answer',
        indexedExpiry: EXPIRY,
        authorizedAfter: Number(NOW - EXPIRY - 1n),
      })

      const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

      expect(call).to.deep.include({ status: 'expired', expiresAt: NOW - 1n })
      expect(index.calledOnce).to.equal(true)
    })

    it('leaves the expiry unknown when that index describes another policy, none, or no expiry', async () => {
      for (const indexed of [
        { indexedAddress: OTHER_POLICY, indexedExpiry: EXPIRY },
        { indexedAddress: null },
        { indexedExpiry: null },
      ]) {
        const { centrifuge } = setup({ contractExpiry: 'no answer', authorizedAfter: Number(NOW) - 1, ...indexed })

        const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

        expect(call).to.deep.include({ status: 'undetermined', expiresAt: null })
        sinon.restore()
      }
    })

    it('fails with a clear error, never a ready call, when the index cannot answer in that fallback', async () => {
      const { centrifuge } = setup({
        contractExpiry: 'no answer',
        indexError: unreadable.indexError,
        authorizedAfter: Number(NOW),
      })

      const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

      expect(error).to.be.instanceOf(HubPolicyPreflightError)
      expect((error as Error).message)
        .to.contain('indexer unavailable')
        .and.to.contain(poolId.toString())
    })

    it('fails with a clear error, never a ready call, when the contract read fails for a matured call', async () => {
      const { centrifuge, index } = setup({ ...unreadable, authorizedAfter: Number(NOW) })

      const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

      expect(error).to.be.instanceOf(HubPolicyPreflightError)
      expect((error as Error).message)
        .to.contain('expiry unavailable')
        .and.to.contain(poolId.toString())
      expect(index.called).to.equal(false)
    })
  })

  it('reads a pool’s policy and block time once, however many calls it has, and each pool separately', async () => {
    const { centrifuge, readContract, getBlock } = setup({ authorizedAfter: 0 })
    const other = hubCall(MANAGER, otherPoolId)

    const out = await classifyHubCalls(centrifuge, SIGNER, [
      { poolId, data: delayedCall },
      { poolId, data: hubCall('0x5555555555555555555555555555555555555555') },
      { poolId: otherPoolId, data: other },
    ])

    expect(out).to.have.length(3)
    expect(readsOf(readContract, 'policy').map((c) => c.args[0].args[0])).to.deep.equal([poolId.raw, otherPoolId.raw])
    expect(getBlock.callCount).to.equal(2)
  })

  it('reads nothing for an empty call list', async () => {
    const { centrifuge, readContract } = setup()

    expect(await classifyHubCalls(centrifuge, SIGNER, [])).to.deep.equal([])
    expect(readContract.called).to.equal(false)
  })
})

describe('classifyHubCalls with the indexed policy', () => {
  afterEach(() => sinon.restore())

  const eventRow = (overrides: Partial<PoolAuthorizationEventRow>): PoolAuthorizationEventRow => ({
    centrifugeId: String(HUB_CHAIN),
    poolId: poolId.toString(),
    eventKind: 'HUB_REGISTRY_SET_POLICY',
    sourceAddress: '0x1111111111111111111111111111111111111111',
    targetCentrifugeId: null,
    policy: POLICY,
    caller: null,
    authId: null,
    calldata: null,
    validAfter: null,
    createdAt: '2026-11-01T10:00:00.000000+00:00',
    createdAtBlock: 10,
    createdAtTxHash: keccak256(toHex('install')),
    createdAtLogIndex: 0,
    ...overrides,
  })
  const parameterRow = (expiry: string | null): HubPolicyRow => ({
    centrifugeId: String(HUB_CHAIN),
    poolId: poolId.toString(),
    policy: POLICY,
    delay: '100',
    expiry,
    escalation: '200',
    maxAbsolutePriceDelta: null,
    thresholdPerSecond: null,
    maxBrmPriceDeviation: null,
    isRestrictionUpdateInstant: null,
    onchainAccounting: null,
    createdAt: '2026-11-01T10:00:00.000000+00:00',
    createdAtBlock: 10,
    createdAtTxHash: keccak256(toHex('install')),
    createdAtLogIndex: 0,
  })

  function setupIndexed(
    expiry: string | null,
    { delay = 100, queryError }: { delay?: number; queryError?: Error } = {}
  ) {
    const centrifuge = new Centrifuge({
      environment: 'testnet',
      dataSource: {
        query: (name: string) =>
          queryError
            ? throwError(() => queryError)
            : of(name === 'poolAuthorizationEvents' ? [eventRow({})] : [parameterRow(expiry)]),
      } as any,
    })
    stubProjectedPools(centrifuge, [poolId], '3.3')
    const readContract = sinon.stub().callsFake(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'policy') return POLICY
      if (functionName === 'authorizationDelay') return delay
      if (functionName === 'authId') return AUTH_ID
      if (functionName === 'authorizedAfter') return Number(NOW - EXPIRY - 1n)
      // The policy has no expiry() view: the index is the only source.
      if (functionName === 'expiry') throw new ContractFunctionRevertedError({ abi: STD_HUB_POLICY_ABI, functionName })
      throw new Error(`unexpected read ${functionName}`)
    })
    stubChain(centrifuge, { readContract, getBlock: sinon.stub().resolves({ number: 1n, timestamp: NOW }) })
    return { centrifuge, readContract }
  }

  it('judges a policy with no expiry() view by the install row’s published expiry', async () => {
    const { centrifuge } = setupIndexed(String(EXPIRY))

    const [call] = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))

    expect(call?.status).to.equal('expired')
  })

  it('fails with a clear error when a policy with no expiry() view meets an indexer that cannot answer', async () => {
    const { centrifuge } = setupIndexed(String(EXPIRY), { queryError: new Error('indexer unavailable') })

    const error = await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall)).catch((e: unknown) => e)

    expect(error).to.be.instanceOf(HubPolicyPreflightError)
    expect((error as Error).message).to.contain('indexer unavailable')
  })

  it('sends an instant call whatever the indexer does, since it never asks it', async () => {
    const { centrifuge } = setupIndexed(String(EXPIRY), { delay: 0, queryError: new Error('indexer unavailable') })

    expect(await classifyHubCalls(centrifuge, SIGNER, calls(delayedCall))).to.deep.equal([])
  })
})
