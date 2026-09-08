import { expect } from 'chai'
import { canDelegate } from './bytecode.js'

// The opcodes used below, for reference: 0xf4 DELEGATECALL, 0xf1 CALL, 0x60 PUSH1, 0x7f PUSH32.
describe('utils/canDelegate', () => {
  it('finds a DELEGATECALL opcode', () => {
    expect(canDelegate('0xf4')).to.equal(true)
    expect(canDelegate('0x6000600060006000f4')).to.equal(true)
  })

  it('is false for a runtime that only ever CALLs', () => {
    expect(canDelegate('0x6000600060006000f1')).to.equal(false)
  })

  it('does not mistake push data for the opcode', () => {
    // PUSH1 0xf4 — the f4 is data. Reading it as DELEGATECALL would let any contract that happens
    // to push 0xf4 pass as a proxy, which is the whole thing this predicate is meant to prevent.
    expect(canDelegate('0x60f4')).to.equal(false)
    // PUSH32 with an f4 in the middle of its 32 immediate bytes.
    expect(canDelegate('0x7f' + '00'.repeat(15) + 'f4' + '00'.repeat(16))).to.equal(false)
  })

  it('still finds a DELEGATECALL that follows push data', () => {
    expect(canDelegate('0x60f4f4')).to.equal(true)
    expect(canDelegate('0x7f' + 'f4'.repeat(32) + 'f4')).to.equal(true)
  })

  it('accepts bytecode with or without the 0x prefix', () => {
    expect(canDelegate('f4')).to.equal(true)
    expect(canDelegate('0Xf4')).to.equal(true)
  })

  it('is false for empty or malformed input', () => {
    // An unparseable runtime is not proof of anything, so it must not read as a proxy.
    expect(canDelegate('0x')).to.equal(false)
    expect(canDelegate('')).to.equal(false)
    expect(canDelegate('0xf')).to.equal(false)
    expect(canDelegate('0xzz')).to.equal(false)
  })

  it('recognizes the EIP-1167 minimal proxy runtime', () => {
    // The canonical minimal-proxy runtime, which ends in DELEGATECALL.
    const minimal = '0x363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3'
    expect(canDelegate(minimal)).to.equal(true)
  })
})
