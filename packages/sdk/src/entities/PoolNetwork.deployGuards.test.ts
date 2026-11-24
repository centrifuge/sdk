import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

/**
 * The factory addresses these deploy flows write against
 * are OPTIONAL in the registry's contract schema (not every chain has them).
 * When a factory is absent the flow must fail loud with a typed message
 * before any transaction is sent — never pass `undefined` to writeContract.
 *
 * Offline: chain resolution is stubbed, `_protocolContext` is stubbed to a
 * contract set WITHOUT the factory, and the fake EIP-1193 signer records
 * every request so the tests can assert no `eth_sendTransaction` happened.
 */
describe('PoolNetwork deploy guards (optional factories)', () => {
  afterEach(() => {
    sinon.restore()
  })

  function setup() {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const thenable = <T>(value: T) => makeThenable(of(value))

    sinon.stub(centrifuge as any, '_idToChain').returns(thenable(sepolia.id))
    sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
    sinon.stub(centrifuge as any, 'getClient').returns(
      thenable({
        getCode: async () => '0x',
      } as any)
    )
    // A contract set as the registry returns it on a chain WITHOUT the
    // optional factories.
    sinon.stub(centrifuge as any, 'protocolContext').returns(
      thenable({
        centrifugeId: centId,
        chainId: sepolia.id,
        protocolVersion: '3.2',
        hub: '0x1111111111111111111111111111111111111111',
      } as any)
    )

    const requests: string[] = []
    const signer = {
      request: async ({ method }: { method: string }) => {
        requests.push(method)
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          return ['0x2222222222222222222222222222222222222222']
        }
        if (method === 'eth_chainId') return `0x${sepolia.id.toString(16)}`
        throw new Error(`unexpected signer request: ${method}`)
      },
    }
    centrifuge.setSigner(signer as any)

    const poolNetwork = new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), centId)
    return { centrifuge, poolNetwork, requests }
  }

  it('deployMerkleProofManager fails loud when MerkleProofManagerFactory is absent, without sending', async () => {
    const { poolNetwork, requests } = setup()
    sinon.stub(poolNetwork as any, '_findDeployedMerkleProofManagerAddress').resolves(null)

    let error: unknown
    try {
      await poolNetwork.deployMerkleProofManager()
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.equal(
      `Merkle proof managers are not available on centrifugeId ${centId} — no MerkleProofManagerFactory is deployed on this network`
    )
    expect(requests).to.not.include('eth_sendTransaction')
  })

  it('deployOnOfframpManager fails loud when neither on/off-ramp factory is listed, without sending', async () => {
    const { poolNetwork, requests } = setup()

    let error: unknown
    try {
      await poolNetwork.deployOnOfframpManager(scId)
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.equal(
      `On/off ramp managers are not available on centrifugeId ${centId} — neither onOffRampFactory nor onOfframpManagerFactory is deployed on this network`
    )
    expect(requests).to.not.include('eth_sendTransaction')
  })

  it('computeMerkleProofManagerAddress and computeOnOffRampManagerAddress fail loud, not opaquely', async () => {
    const { poolNetwork } = setup()

    let merkleError: unknown
    try {
      await poolNetwork.computeMerkleProofManagerAddress()
    } catch (e) {
      merkleError = e
    }
    expect((merkleError as Error).message).to.contain('no MerkleProofManagerFactory is deployed')

    let rampError: unknown
    try {
      await poolNetwork.computeOnOffRampManagerAddress(scId)
    } catch (e) {
      rampError = e
    }
    expect((rampError as Error).message).to.contain('neither onOffRampFactory nor onOfframpManagerFactory is deployed')
  })
})
