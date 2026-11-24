/**
 * Whether a deployed runtime can forward execution at all — i.e. its code contains a DELEGATECALL.
 *
 * This is the proof a bytecode-provenance gate needs before it substitutes an implementation's code
 * for a target's. `implementation()` and `masterCopy()` are ordinary view functions that any
 * contract can answer, and the EIP-1967 slots are storage any contract can write; treating either as
 * authority means hashing and approving one contract's bytecode while the workflow executes the code
 * actually deployed at the target. A runtime with no DELEGATECALL cannot delegate to an
 * implementation, so substituting for it is definitionally wrong.
 *
 * The scan is opcode-aware: PUSH immediates are skipped, so an `f4` byte inside push data is not
 * mistaken for the opcode. Malformed input (odd length, non-hex) returns `false` — an unparseable
 * runtime is not proof of anything.
 */
export function canDelegate(bytecode: string): boolean {
  const hex = bytecode.startsWith('0x') || bytecode.startsWith('0X') ? bytecode.slice(2) : bytecode
  if (hex.length % 2 !== 0) return false

  for (let i = 0; i + 1 < hex.length; ) {
    const op = Number.parseInt(hex.slice(i, i + 2), 16)
    if (Number.isNaN(op)) return false
    if (op === 0xf4) return true // DELEGATECALL
    // PUSH1..PUSH32 (0x60..0x7f) carry (op - 0x5f) bytes of immediate data, which are not opcodes.
    const immediates = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0
    i += 2 + immediates * 2
  }
  return false
}
