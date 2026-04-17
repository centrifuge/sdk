import { expect } from 'chai'
import { computeScriptHash } from './scriptHash.js'
import type { Callback } from './scriptHash.js'
import type { HexString } from '../types/index.js'

// Reusable fixtures
const CMD = '0xaabbccdd01000102ffffff031234567890123456789012345678901234567890' as HexString
const SLOT_A = '0x0000000000000000000000000000000000000000000000000000000000000001' as HexString
const SLOT_B = '0x0000000000000000000000000000000000000000000000000000000000000002' as HexString
const SLOT_C = '0x0000000000000000000000000000000000000000000000000000000000000003' as HexString

describe('utils/scriptHash', () => {
  describe('computeScriptHash', () => {
    it('returns a 32-byte hex string', () => {
      const hash = computeScriptHash([CMD], [SLOT_A], 1n, [])
      expect(hash).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('is deterministic for identical inputs', () => {
      const h1 = computeScriptHash([CMD], [SLOT_A], 1n, [])
      const h2 = computeScriptHash([CMD], [SLOT_A], 1n, [])
      expect(h1).to.equal(h2)
    })

    it('works with empty commands, state, and callbacks', () => {
      const hash = computeScriptHash([], [], 0n, [])
      expect(hash).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('changes when commands change', () => {
      const h1 = computeScriptHash([CMD], [SLOT_A], 1n, [])
      const cmd2 = CMD.replace('aabb', 'ccdd') as HexString
      const h2 = computeScriptHash([cmd2], [SLOT_A], 1n, [])
      expect(h1).to.not.equal(h2)
    })

    it('changes when a pinned state slot changes', () => {
      // slot 0 is pinned (bitmap bit 0 = 1)
      const h1 = computeScriptHash([CMD], [SLOT_A], 1n, [])
      const h2 = computeScriptHash([CMD], [SLOT_B], 1n, [])
      expect(h1).to.not.equal(h2)
    })

    it('does NOT change when a runtime state slot changes — key property', () => {
      // state: [SLOT_A (pinned, bit 0), SLOT_B (runtime, bit 1 = 0)]
      // Changing the runtime slot must not affect the hash.
      const bitmap = 1n // only bit 0 set
      const h1 = computeScriptHash([CMD], [SLOT_A, SLOT_B], bitmap, [])
      const h2 = computeScriptHash([CMD], [SLOT_A, SLOT_C], bitmap, [])
      expect(h1).to.equal(h2)
    })

    it('does NOT change when all slots are runtime (bitmap = 0)', () => {
      const h1 = computeScriptHash([CMD], [SLOT_A], 0n, [])
      const h2 = computeScriptHash([CMD], [SLOT_B], 0n, [])
      expect(h1).to.equal(h2)
    })

    it('changes when stateBitmap changes', () => {
      // Pinning an extra slot changes the hash even if slot values are the same
      const h1 = computeScriptHash([CMD], [SLOT_A, SLOT_B], 1n, []) // slot 0 pinned only
      const h2 = computeScriptHash([CMD], [SLOT_A, SLOT_B], 3n, []) // slots 0+1 pinned
      expect(h1).to.not.equal(h2)
    })

    it('changes when state.length changes, even if bitmap = 0', () => {
      // state.length is packed directly into the hash
      const h1 = computeScriptHash([CMD], [SLOT_A], 0n, [])
      const h2 = computeScriptHash([CMD], [SLOT_A, SLOT_B], 0n, [])
      expect(h1).to.not.equal(h2)
    })

    it('changes when a callback is added', () => {
      const h1 = computeScriptHash([CMD], [SLOT_A], 1n, [])
      const callback: Callback = {
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        caller: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }
      const h2 = computeScriptHash([CMD], [SLOT_A], 1n, [callback])
      expect(h1).to.not.equal(h2)
    })

    it('changes when a callback hash changes', () => {
      const cb1: Callback = {
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        caller: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }
      const cb2: Callback = {
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        caller: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }
      const h1 = computeScriptHash([CMD], [SLOT_A], 1n, [cb1])
      const h2 = computeScriptHash([CMD], [SLOT_A], 1n, [cb2])
      expect(h1).to.not.equal(h2)
    })

    it('correctly isolates pinned slots across mixed bitmap', () => {
      // slots: [A(pinned), B(runtime), C(pinned)] — bitmap = 0b101 = 5
      // Changing slot 1 (B, runtime) must not change the hash
      const bitmap = 5n // bits 0 and 2 set
      const state1: HexString[] = [SLOT_A, SLOT_B, SLOT_C]
      const state2: HexString[] = [SLOT_A, SLOT_C, SLOT_C] // slot 1 changed to C
      expect(computeScriptHash([CMD], state1, bitmap, []))
        .to.equal(computeScriptHash([CMD], state2, bitmap, []))

      // But changing slot 0 (A, pinned) must change the hash
      const state3: HexString[] = [SLOT_B, SLOT_B, SLOT_C] // slot 0 changed to B
      expect(computeScriptHash([CMD], state1, bitmap, []))
        .to.not.equal(computeScriptHash([CMD], state3, bitmap, []))
    })
  })
})
