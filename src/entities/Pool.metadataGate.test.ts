import { expect } from 'chai'
import { Centrifuge } from '../Centrifuge.js'
import { mockPoolMetadata } from '../tests/mocks/mockPoolMetadata.js'
import { mockPoolMetadataV2 } from '../tests/mocks/mockPoolMetadataV2.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

// No Tenderly / signer / network: the eager v1-rejection guard in `updateMetadata` throws at the
// call site, before `_transact` sets up any signer or client, so it is assertable against a plain
// Centrifuge instance. (The full migrate → pin → on-chain confirm flow is covered in the
// Tenderly-gated suite in Pool.test.ts.)
describe('Pool metadata write gate', () => {
  const poolId = PoolId.from(1, 1)

  function makePool() {
    return new Pool(new Centrifuge({ environment: 'testnet' }), poolId.raw)
  }

  it('updateMetadata throws synchronously on legacy (v1) metadata', () => {
    expect(() => makePool().updateMetadata(mockPoolMetadata)).to.throw(/migrateMetadata/)
  })

  it('updateMetadata accepts v2 metadata (guard passes, returns a transaction without throwing)', () => {
    expect(() => makePool().updateMetadata(mockPoolMetadataV2)).to.not.throw()
  })
})
