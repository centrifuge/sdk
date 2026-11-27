import { expect } from 'chai'
import sinon from 'sinon'
import { Centrifuge } from './Centrifuge.js'
import { canonicalCids } from './utils/cid.js'
import { ipfsPathFromHash } from './utils/ipfs.js'

const metadata = { pool: { name: 'Pool A', asset: { class: 'Private credit' } } }
const bytes = new TextEncoder().encode(JSON.stringify(metadata))
const { v0, v1 } = canonicalCids(bytes)

describe('Centrifuge._queryIPFS', () => {
  let centrifuge: Centrifuge
  let fetchStub: sinon.SinonStub

  beforeEach(() => {
    centrifuge = new Centrifuge({ environment: 'testnet' })
    fetchStub = sinon.stub(globalThis, 'fetch')
  })

  afterEach(() => {
    sinon.restore()
  })

  it('returns the metadata when the served bytes hash to the CID, for CIDv0 and CIDv1', async () => {
    fetchStub.callsFake(async () => new Response(bytes))

    expect(await centrifuge._queryIPFS(`ipfs://${v0}`)).to.deep.equal(metadata)
    expect(await centrifuge._queryIPFS(`ipfs://${v1}`)).to.deep.equal(metadata)
  })

  it('throws when the gateway serves other bytes than the CID names', async () => {
    const substituted = new TextEncoder().encode(JSON.stringify({ pool: { name: 'Attacker' } }))
    fetchStub.resolves(new Response(substituted))

    let error: unknown
    try {
      await centrifuge._queryIPFS(`ipfs://${v0}`)
    } catch (e) {
      error = e
    }
    expect(String(error)).to.contain('does not hash to it')
  })

  it('refuses a file path inside a directory CID, which the content cannot be checked against', async () => {
    fetchStub.resolves(new Response(bytes))

    let error: unknown
    try {
      await centrifuge._queryIPFS(`ipfs://${v1}/metadata.json`)
    } catch (e) {
      error = e
    }
    expect(String(error)).to.contain('could not verify CID')
  })
})

describe('ipfsPathFromHash', () => {
  it('reads the CID from every form a pool metadata field takes, never keeping a host', () => {
    for (const uri of [v0, `/ipfs/${v0}`, `ipfs://${v0}`, `ipfs://ipfs/${v0}`, `https://evil.example/ipfs/${v0}?x=1`]) {
      expect(ipfsPathFromHash(uri)).to.equal(v0)
    }
    expect(ipfsPathFromHash('')).to.equal('')
    expect(ipfsPathFromHash('https://evil.example/metadata.json')).to.equal('')
  })
})
