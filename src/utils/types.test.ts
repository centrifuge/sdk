import { expect } from 'chai'
import { AssetId, PoolId, ShareClassId } from './types.js'

const poolId = '562949953421313'
const scId = '0x00020000000000010000000000000003'
const assetId = '10384593717069655257060992658440193'

describe('utils/types', () => {
  describe('PoolId', () => {
    it('should construct a PoolId', () => {
      expect(new PoolId(poolId).toString()).to.equal(poolId)
      expect(new PoolId(BigInt(poolId)).toString()).to.equal(poolId)
      expect(new PoolId(poolId).raw).to.equal(BigInt(poolId))
    })
    it('get the Centrifuge Id', () => {
      const id = new PoolId(poolId)
      expect(id.centrifugeId).to.equal(2)
    })
  })

  describe('ShareClassId', () => {
    it('should construct a ShareClassId', () => {
      const id = new ShareClassId(scId)
      expect(id.toString()).to.equal(scId)
      expect(id.raw).to.equal(scId)

      const id2 = ShareClassId.from(new PoolId(poolId), 3)
      expect(id2.toString()).to.equal(scId)
      expect(id2.poolId.toString()).to.equal(poolId)
    })
    it('get the Centrifuge Id', () => {
      const id = new ShareClassId(scId)
      expect(id.centrifugeId).to.equal(2)
    })
    it('get the Pool Id', () => {
      const id = new ShareClassId(scId)
      expect(id.poolId.toString()).to.equal(poolId)
    })
  })

  describe('AssetId', () => {
    it('should construct an AssetId', () => {
      const id = new AssetId(assetId)
      expect(id.toString()).to.equal(assetId)
      expect(id.raw).to.equal(BigInt(assetId))
    })
    it('get the Centrifuge Id', () => {
      const id = new AssetId(assetId)
      expect(id.centrifugeId).to.equal(2)
    })
    it("should get whether it's a national currency", () => {
      const id = new AssetId(assetId)
      expect(id.isNationalCurrency).to.equal(false)
      const id2 = new AssetId(804)
      expect(id2.isNationalCurrency).to.equal(true)
    })
  })
})
