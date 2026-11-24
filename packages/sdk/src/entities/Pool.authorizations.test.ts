import { ABIS_V3_3, resolveProtocolContext, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// Built against the bundled testnet registry, where both versions are deployed on Sepolia (the hub chain of the
// pools below).

const HUB = 1
const pool33Id = PoolId.from(HUB, 33)
const pool32Id = PoolId.from(HUB, 32)
const manager = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const updateHubManager = (who: string, canManage: boolean) =>
  encodeFunctionData({
    abi: ABIS_V3_3.Hub,
    functionName: 'updateHubManager',
    args: [pool33Id.raw, who as HexString, canManage],
  })
const first = updateHubManager('0x19f46d8130e610c6c0f0116ea40fb781defade93', true)
const second = updateHubManager('0x19f46d8130e610c6c0f0116ea40fb781defade93', false)

const hub33 = resolveProtocolContext(pool33Id.raw.toString(), '3.3', { environment: 'testnet' }).addresses.hub!

const initiateAuthorization = (data: HexString) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'initiateAuthorization', args: [pool33Id.raw, data] })
const multicall = (calls: HexString[]) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'multicall', args: [calls] })
const executeMulticall = (calls: HexString[]) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'executeMulticall', args: [calls] })
const oddLength = `${first}0` as HexString

function setup() {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
    ])
  )
  stubChain(centrifuge)
  const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: manager })
  return { centrifuge, build }
}

async function refusal(promise: Promise<unknown>) {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  return error
}

describe('Pool hub policy writes', () => {
  afterEach(() => sinon.restore())

  describe('initiateAuthorizations', () => {
    it('encodes one Hub.multicall of one initiateAuthorization(poolId, data) per calldata', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const built = await build(pool.initiateAuthorizations([first, second]))

      expect(built.to.toLowerCase()).to.equal(hub33.toLowerCase())
      expect(built.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'multicall',
          args: [[initiateAuthorization(first), initiateAuthorization(second)]],
        })
      )
      expect(built.calls.map((call: { data: HexString }) => call.data)).to.deep.equal([
        initiateAuthorization(first),
        initiateAuthorization(second),
      ])
    })

    it('sends a single calldata as the plain initiateAuthorization call, as every one-call hub write does', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const built = await build(pool.initiateAuthorizations([first]))

      expect(built.data).to.equal(initiateAuthorization(first))
    })

    it('keeps the order of the calldatas', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const built = await build(pool.initiateAuthorizations([second, first]))

      expect(built.calls.map((call: { data: HexString }) => call.data)).to.deep.equal([
        initiateAuthorization(second),
        initiateAuthorization(first),
      ])
    })

    it('refuses a v3.2 pool, which has no authorizations', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool32Id)

      const error = await refusal(build(pool.initiateAuthorizations([first])))

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect((error as Error).message).to.contain('initiateAuthorizations')
    })

    it('refuses an empty list', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const error = await refusal(build(pool.initiateAuthorizations([])))

      expect((error as Error).message).to.contain('at least one')
    })

    it('refuses calldata that is not hex or has no function selector', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const notHex = await refusal(build(pool.initiateAuthorizations(['updateHubManager' as HexString])))
      const noSelector = await refusal(build(pool.initiateAuthorizations(['0x1234' as HexString])))

      expect((notHex as Error).message).to.contain('calldata')
      expect((noSelector as Error).message).to.contain('calldata')
    })

    it('refuses hex that is not whole bytes, which encoding would pad into other calldata', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const error = await refusal(build(pool.initiateAuthorizations([first, oddLength])))

      expect((error as Error).message).to.contain('whole-byte')
    })

    it('refuses the calldata of a multicall, and points at the inner calls', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      for (const wrapper of [multicall([first, second]), executeMulticall([first, second])]) {
        const error = await refusal(build(pool.initiateAuthorizations([wrapper])))

        expect((error as Error).message).to.contain('built.calls')
      }
    })

    it('refuses a multicall whatever the hex casing', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)
      const upper = `0x${multicall([first, second]).slice(2).toUpperCase()}` as HexString

      const error = await refusal(build(pool.initiateAuthorizations([upper])))

      expect((error as Error).message).to.contain('built.calls')
    })

    it('refuses the data of a build that has several calls, which is the outer multicall', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)
      const several = await build(pool.initiateAuthorizations([first, second]))

      const error = await refusal(build(pool.initiateAuthorizations([several.data])))

      expect((error as Error).message).to.contain('built.calls')
    })

    it('refuses the same calldata twice, which would revert the whole batch on chain', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const error = await refusal(build(pool.initiateAuthorizations([first, second, first])))

      expect((error as Error).message).to.contain('twice')
    })

    it('compares duplicates whatever the hex casing', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)
      const upper = `0x${first.slice(2).toUpperCase()}` as HexString

      const error = await refusal(build(pool.initiateAuthorizations([first, upper])))

      expect((error as Error).message).to.contain('twice')
    })
  })

  describe('cancelAuthorization', () => {
    it('encodes Hub.cancelAuthorization(poolId, data)', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const built = await build(pool.cancelAuthorization(first))

      expect(built.to.toLowerCase()).to.equal(hub33.toLowerCase())
      expect(built.data).to.equal(
        encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'cancelAuthorization', args: [pool33Id.raw, first] })
      )
    })

    it('refuses a v3.2 pool, which has no authorizations', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool32Id)

      const error = await refusal(build(pool.cancelAuthorization(first)))

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect((error as Error).message).to.contain('cancelAuthorization')
    })

    it('refuses calldata that is not hex or has no function selector', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const error = await refusal(build(pool.cancelAuthorization('0x' as HexString)))

      expect((error as Error).message).to.contain('calldata')
    })

    it('refuses hex that is not whole bytes', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      const error = await refusal(build(pool.cancelAuthorization(oddLength)))

      expect((error as Error).message).to.contain('whole-byte')
    })

    it('refuses the calldata of a multicall, and points at the inner calls', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)

      for (const wrapper of [multicall([first, second]), executeMulticall([first, second])]) {
        const error = await refusal(build(pool.cancelAuthorization(wrapper)))

        expect((error as Error).message).to.contain('built.calls')
      }
    })
  })
})
