import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { toHex } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// No Tenderly / signer / network: `metadataUri()` is the on-chain
// `HubRegistry.metadata` read plus the unpadding, so stubbing the protocol
// context and the client covers it end to end. The IPFS fetch that
// `metadata()` layers on top is deliberately not exercised here -- the point
// of the accessor is that it stops short of it.
describe('Pool.metadataUri', () => {
  const poolId = PoolId.from(1, 1)
  const hubRegistry = '0x0000000000000000000000000000000000000abc'

  afterEach(() => sinon.restore())

  // `disableRepeatOnEvents` keeps this offline: without it the `SetMetadata`
  // watcher resubscribes after each emission and reaches for a real RPC.
  // The contract returns a fixed-width bytes field, so a short URI comes back
  // zero-padded. Reproduce that rather than a clean string: stripping the
  // padding is the behaviour under test.
  function makePool(stored: string) {
    const centrifuge = new Centrifuge({ environment: 'testnet', disableRepeatOnEvents: true })
    sinon.stub(centrifuge as any, 'protocolContext').returns(of({ hubRegistry, contractAbis: ABIS_V3_2 } as any))
    sinon.stub(centrifuge as any, 'getClient').returns(
      of({ readContract: async () => toHex(stored, { size: 128 }) } as any)
    )
    return new Pool(centrifuge, poolId.raw)
  }

  it('returns the stored pointer with its zero padding stripped', async () => {
    const uri = await makePool('ipfs://QmPoolMetadataPointer')
    expect(await uri.metadataUri()).to.equal('ipfs://QmPoolMetadataPointer')
  })

  it('returns null when no pointer is set', async () => {
    expect(await makePool('').metadataUri()).to.equal(null)
  })

  it('returns null for a pointer that is only whitespace', async () => {
    expect(await makePool('   ').metadataUri()).to.equal(null)
  })
})
