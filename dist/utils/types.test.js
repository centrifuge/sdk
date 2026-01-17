import { expect } from 'chai';
import { AssetId, PoolId, ShareClassId } from './types.js';
const poolId = '562949953421313';
const scId = '0x00020000000000010000000000000003';
const assetId = '10384593717069655257060992658440193';
describe('utils/types', () => {
    describe('PoolId', () => {
        it('should construct a PoolId', () => {
            expect(new PoolId(poolId).toString()).to.equal(poolId);
            expect(new PoolId(BigInt(poolId)).toString()).to.equal(poolId);
            expect(new PoolId(poolId).raw).to.equal(BigInt(poolId));
        });
        it('get the Centrifuge Id', () => {
            const id = new PoolId(poolId);
            expect(id.centrifugeId).to.equal(2);
        });
        it('can compare pool IDs', () => {
            const id = new PoolId(poolId);
            expect(id.equals(poolId)).to.equal(true);
            expect(id.equals(BigInt(poolId))).to.equal(true);
            expect(id.equals('123')).to.equal(false);
            expect(id.equals(new PoolId(poolId))).to.equal(true);
        });
    });
    describe('ShareClassId', () => {
        it('should construct a ShareClassId', () => {
            const id = new ShareClassId(scId);
            expect(id.toString()).to.equal(scId);
            expect(id.raw).to.equal(scId);
            const id2 = ShareClassId.from(new PoolId(poolId), 3);
            expect(id2.toString()).to.equal(scId);
            expect(id2.poolId.toString()).to.equal(poolId);
        });
        it('get the Centrifuge Id', () => {
            const id = new ShareClassId(scId);
            expect(id.centrifugeId).to.equal(2);
        });
        it('get the Pool Id', () => {
            const id = new ShareClassId(scId);
            expect(id.poolId.toString()).to.equal(poolId);
        });
        it('can compare share class IDs', () => {
            const id = new ShareClassId(scId);
            expect(id.equals(scId)).to.equal(true);
            expect(id.equals('0x00020000000000010000000000000004')).to.equal(false);
            expect(id.equals(new ShareClassId(scId))).to.equal(true);
        });
        it('should throw if the share class ID is invalid', () => {
            expect(() => new ShareClassId('0x123')).to.throw();
            expect(() => new ShareClassId('0x1234567890123456789012345678901234567890')).to.throw();
            expect(() => new ShareClassId('0x0002000000000001000000000000000Z')).to.throw();
            expect(() => new ShareClassId('00020000000000010000000000000003')).to.throw();
        });
    });
    describe('AssetId', () => {
        it('should construct an AssetId', () => {
            const id = new AssetId(assetId);
            expect(id.toString()).to.equal(assetId);
            expect(id.raw).to.equal(BigInt(assetId));
        });
        it('gets the Centrifuge Id', () => {
            const id = new AssetId(assetId);
            expect(id.centrifugeId).to.equal(2);
        });
        it('gets the address', () => {
            const id = new AssetId(assetId);
            expect(id.addr).to.equal('0x0000000000020000000000000000000000000001');
        });
        it("should get whether it's a national currency", () => {
            const id = new AssetId(assetId);
            expect(id.isNationalCurrency).to.equal(false);
            const id2 = AssetId.fromIso(804);
            expect(id2.isNationalCurrency).to.equal(true);
        });
        it('can compare asset IDs', () => {
            const id = new AssetId(assetId);
            expect(id.equals(assetId)).to.equal(true);
            expect(id.equals('123')).to.equal(false);
            expect(id.equals(new AssetId(assetId))).to.equal(true);
        });
        it('should get the national currency code', () => {
            const id = new AssetId(assetId);
            expect(id.nationalCurrencyCode).to.equal(null);
            const id2 = AssetId.fromIso(804);
            expect(id2.nationalCurrencyCode).to.equal(804);
        });
    });
});
//# sourceMappingURL=types.test.js.map