import { expect } from 'chai';
import sinon from 'sinon';
import { pinToApi } from './ipfs.js';
const fakeHash = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
describe('pinToApi function', () => {
    let fetchStub;
    beforeEach(() => {
        fetchStub = sinon.stub(globalThis, 'fetch');
    });
    afterEach(() => {
        sinon.restore();
    });
    it('should resolve with JSON when response.ok is true', async () => {
        const fakeData = { foo: 'bar' };
        const fakeResponse = {
            ok: true,
            json: sinon.stub().resolves({ uri: fakeHash }),
        };
        fetchStub.resolves(fakeResponse);
        const init = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ json: fakeData }),
        };
        const url = 'https://example.com/pinJson';
        const result = await pinToApi(url, init);
        sinon.assert.calledOnceWithExactly(fetchStub, url, init);
        expect(result).to.equal(fakeHash);
    });
    it('should throw an Error with the response text when response.ok is false', async () => {
        const errorText = 'Not found';
        const fakeResponse = {
            ok: false,
            text: sinon.stub().resolves(errorText),
        };
        fetchStub.resolves(fakeResponse);
        const init = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ json: { foo: 'bar' } }),
        };
        const url = 'https://example.com/pinJson';
        let caught;
        try {
            await pinToApi(url, init);
        }
        catch (err) {
            caught = err;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught.message).to.equal(`Error pinning: ${errorText}`);
    });
});
//# sourceMappingURL=ipfs.test.js.map