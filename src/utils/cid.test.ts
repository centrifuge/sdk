import { expect } from 'chai'
import { assertCidMatchesContent, cidMatchesContent, decodeCid } from './cid.js'

const encode = (text: string) => new TextEncoder().encode(text)

/**
 * A deterministic multi-chunk fixture. 700 000 bytes spans three 256 KiB chunks, so it
 * exercises the balanced-DAG layer that a single-chunk vector never reaches.
 */
function multiChunkFixture(): Uint8Array {
  const bytes = new Uint8Array(700_000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 251
  return bytes
}

describe('utils/cid', () => {
  describe('cidMatchesContent', () => {
    // Public `ipfs add` vectors — independent of this implementation.
    it('reproduces the canonical empty-file CIDv0', () => {
      expect(cidMatchesContent('QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH', new Uint8Array(0))).to.equal(true)
    })

    it('reproduces the canonical "hello world" CIDv0', () => {
      expect(cidMatchesContent('QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', encode('hello world\n'))).to.equal(
        true
      )
    })

    it('accepts a raw-leaf CIDv1', () => {
      expect(
        cidMatchesContent('bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4', encode('hello world\n'))
      ).to.equal(true)
    })

    it('reproduces a multi-chunk CID under both leaf encodings', () => {
      const content = multiChunkFixture()
      expect(cidMatchesContent('QmS4fQ5xhhzaL55rb6Ly5wAnrx4yVkxVZb6Me8WvvsffuV', content)).to.equal(true)
      expect(cidMatchesContent('bafybeihjvesaqmkfuawfe3nmnuvkgidv75q4cmgojqjldtpi4tz2bggqnm', content)).to.equal(true)
    })

    it('rejects content that does not hash to the CID', () => {
      expect(cidMatchesContent('QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', encode('hello world!\n'))).to.equal(
        false
      )
    })

    // The realistic tamper: a gateway returns a catalog of the same length with one
    // workflow's pinned address swapped.
    it('rejects a single flipped byte in a multi-chunk payload', () => {
      const tampered = multiChunkFixture()
      tampered[500_000] = tampered[500_000]! ^ 0x01
      expect(cidMatchesContent('QmS4fQ5xhhzaL55rb6Ly5wAnrx4yVkxVZb6Me8WvvsffuV', tampered)).to.equal(false)
    })
  })

  describe('decodeCid', () => {
    it('rejects a multibase encoding it cannot verify', () => {
      expect(() => decodeCid('zdj7WabcdefghijkLMNOP')).to.throw(/unsupported CID encoding/)
    })

    it('rejects a malformed base58 CIDv0', () => {
      expect(() => decodeCid('Qm0OIl')).to.throw(/invalid base58 character/)
    })
  })

  describe('assertCidMatchesContent', () => {
    it('names the caller and the CID when content does not match', () => {
      expect(() =>
        assertCidMatchesContent('QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', encode('tampered'), 'testContext')
      ).to.throw(/testContext: content served for CID "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"/)
    })

    it('passes through a CID that verifies', () => {
      expect(() =>
        assertCidMatchesContent('QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', encode('hello world\n'), 'ctx')
      ).to.not.throw()
    })
  })
})
