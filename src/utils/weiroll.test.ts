import { expect } from 'chai'
import {
  CALL,
  FLAG_RAW,
  STATICCALL,
  UNUSED_SLOT,
  VALUECALL,
  buildScript,
  encodeCommand,
} from './weiroll.js'
import type { PoolContext, WorkflowDefinition } from './weiroll.js'

// Addresses used across tests
const TARGET_A = '0x1234567890123456789012345678901234567890' as const
const TARGET_B = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const
const SELECTOR = '0xaabbccdd' as const

describe('utils/weiroll', () => {
  describe('encodeCommand', () => {
    it('packs selector, flags, inputs, output, and target into bytes32', () => {
      const result = encodeCommand(
        SELECTOR,
        CALL,
        [0, 1, 2],
        3,
        TARGET_A
      )

      // Expected layout (32 bytes):
      //   aabbccdd            — selector
      //   01                  — CALL flag
      //   000102ffffff        — inputs [0, 1, 2, 0xFF, 0xFF, 0xFF]
      //   03                  — output slot 3
      //   1234567890123456789012345678901234567890  — target
      expect(result).to.equal(
        '0xaabbccdd01000102ffffff031234567890123456789012345678901234567890'
      )
    })

    it('encodes STATICCALL flag correctly', () => {
      const result = encodeCommand(SELECTOR, STATICCALL, [], UNUSED_SLOT, TARGET_A)
      // flags byte = 0x02, all inputs = 0xFF, output = 0xFF
      const flagsByte = result.slice(10, 12) // bytes[4] of the 32-byte word
      expect(flagsByte).to.equal('02')
    })

    it('encodes VALUECALL flag correctly', () => {
      const result = encodeCommand(SELECTOR, VALUECALL, [0], 1, TARGET_A)
      const flagsByte = result.slice(10, 12)
      expect(flagsByte).to.equal('03')
    })

    it('sets FLAG_RAW when combined with call type', () => {
      const result = encodeCommand(SELECTOR, CALL | FLAG_RAW, [0], UNUSED_SLOT, TARGET_A)
      const flagsByte = result.slice(10, 12)
      expect(flagsByte).to.equal('21') // 0x01 | 0x20 = 0x21
    })

    it('pads missing input slots with UNUSED_SLOT (0xFF)', () => {
      const withZeroInputs = encodeCommand(SELECTOR, CALL, [], 0, TARGET_A)
      const withExplicitFF = encodeCommand(
        SELECTOR,
        CALL,
        [UNUSED_SLOT, UNUSED_SLOT, UNUSED_SLOT, UNUSED_SLOT, UNUSED_SLOT, UNUSED_SLOT],
        0,
        TARGET_A
      )
      expect(withZeroInputs).to.equal(withExplicitFF)
      // All 6 input bytes should be FF
      const inputBytes = withZeroInputs.slice(12, 24) // bytes[5:10] of the word
      expect(inputBytes).to.equal('ffffffffffffff'.slice(0, 12))
    })

    it('places the output slot at the correct byte position', () => {
      const result = encodeCommand(SELECTOR, CALL, [], 42, TARGET_A)
      // output is at byte index 11 (0-based) of the 32-byte word = chars 24:26
      const outputByte = result.slice(24, 26)
      expect(outputByte).to.equal('2a') // 42 = 0x2a
    })

    it('places the target address in the lowest 20 bytes', () => {
      const result = encodeCommand(SELECTOR, CALL, [], UNUSED_SLOT, TARGET_A)
      // Last 40 hex chars = bytes [11:31]
      const addrHex = result.slice(result.length - 40)
      expect(addrHex).to.equal(TARGET_A.slice(2).toLowerCase())
    })

    it('produces a 66-character hex string (0x + 64 chars)', () => {
      const result = encodeCommand(SELECTOR, CALL, [0], 0, TARGET_A)
      expect(result).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('throws if more than 6 inputs are provided', () => {
      expect(() =>
        encodeCommand(SELECTOR, CALL, [0, 1, 2, 3, 4, 5, 6], 0, TARGET_A)
      ).to.throw('exceeds maximum of 6')
    })
  })

  describe('buildScript', () => {
    const POOL_CTX: PoolContext = {
      poolId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      hubAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    }

    const CONFIGURABLE: Record<string, `0x${string}`> = {
      slippageBps: '0x0000000000000000000000000000000000000000000000000000000000000032',
    }

    const SIMPLE_ACTION = {
      target: TARGET_A,
      selector: SELECTOR,
      callType: CALL,
      inputs: [0, 1],
      output: 2,
    }

    it('encodes a single action into commands', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [SIMPLE_ACTION],
        state: [],
      }
      const { commands } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })
      expect(commands).to.have.length(1)
      expect(commands[0]).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('pins literal slots and sets their bitmap bits', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [
          { type: 'literal', value: '0xdeadbeef' as const },
          { type: 'literal', value: '0xcafebabe' as const },
        ],
      }
      const { state, stateBitmap } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(state[0]).to.equal('0xdeadbeef')
      expect(state[1]).to.equal('0xcafebabe')
      expect(stateBitmap).to.equal(0b11n) // bits 0 and 1 set
    })

    it('resolves magic slots from pool context and pins them', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'magic', key: 'poolId' }],
      }
      const { state, stateBitmap } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(state[0]).to.equal(POOL_CTX['poolId'])
      expect(stateBitmap).to.equal(1n) // bit 0 set
    })

    it('resolves configurable slots and pins them', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'configurable', key: 'slippageBps' }],
      }
      const { state, stateBitmap } = buildScript(workflow, {
        poolContext: POOL_CTX,
        configurableValues: CONFIGURABLE,
      })

      expect(state[0]).to.equal(CONFIGURABLE['slippageBps'])
      expect(stateBitmap).to.equal(1n)
    })

    it('leaves runtime slots empty and does not set their bitmap bits', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'runtime', key: 'amount' }],
      }
      const { state, stateBitmap } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(state[0]).to.equal('0x')
      expect(stateBitmap).to.equal(0n) // bit 0 stays 0
    })

    it('correctly computes stateBitmap for mixed slot types', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [
          { type: 'literal', value: '0x01' as const },      // slot 0 — pinned
          { type: 'magic', key: 'poolId' },                  // slot 1 — pinned
          { type: 'configurable', key: 'slippageBps' },     // slot 2 — pinned
          { type: 'runtime', key: 'amount' },                // slot 3 — NOT pinned
          { type: 'literal', value: '0x02' as const },      // slot 4 — pinned
        ],
      }
      const { stateBitmap } = buildScript(workflow, {
        poolContext: POOL_CTX,
        configurableValues: CONFIGURABLE,
      })

      // bits 0, 1, 2, 4 set; bit 3 clear → 0b10111 = 23
      expect(stateBitmap).to.equal(0b10111n)
    })

    it('builds both commands and state together correctly', () => {
      const literalValue = '0x0000000000000000000000000000000000000000000000000000000000000064' as const
      const workflow: WorkflowDefinition = {
        workflowRef: 'swap',
        actions: [
          { target: TARGET_A, selector: '0x12345678' as const, callType: CALL, inputs: [0], output: 1 },
          { target: TARGET_B, selector: '0x87654321' as const, callType: STATICCALL, inputs: [1], output: UNUSED_SLOT },
        ],
        state: [
          { type: 'literal', value: literalValue },
          { type: 'runtime', key: 'result' },
        ],
      }
      const { commands, state, stateBitmap } = buildScript(workflow, {
        poolContext: POOL_CTX,
        configurableValues: {},
      })

      expect(commands).to.have.length(2)
      expect(state).to.have.length(2)
      expect(state[0]).to.equal(literalValue)
      expect(state[1]).to.equal('0x')
      expect(stateBitmap).to.equal(1n) // only slot 0 pinned
    })

    it('throws when a magic key is missing from pool context', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'magic', key: 'missingKey' }],
      }
      expect(() =>
        buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })
      ).to.throw('magic variable "missingKey" not found in pool context')
    })

    it('throws when a configurable key is not provided', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'configurable', key: 'missingConfig' }],
      }
      expect(() =>
        buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })
      ).to.throw('configurable value "missingConfig" not provided')
    })

    it('throws when state exceeds 128 slots', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: Array.from({ length: 129 }, () => ({ type: 'runtime' as const, key: 'x' })),
      }
      expect(() =>
        buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })
      ).to.throw('maximum is 128')
    })
  })

})
