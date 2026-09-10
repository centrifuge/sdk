import { expect } from 'chai'
import { concat, encodeAbiParameters } from 'viem'
import {
  CALL,
  FLAG_RAW,
  STATICCALL,
  UNUSED_SLOT,
  VALUECALL,
  buildScript,
  encodeCommand,
  encodeVariableLengthValue,
  fillRuntimeSlots,
  getWorkflowAbiParameter,
  isDynamicAbiType,
  staticHeadWordCount,
} from './weiroll.js'
import type { PoolContext, WorkflowDefinition } from './weiroll.js'

// Addresses used across tests
const TARGET_A = '0x1234567890123456789012345678901234567890' as const
const TARGET_B = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const
const SELECTOR = '0xaabbccdd' as const
const EMPTY = '0x' as const

describe('utils/weiroll', () => {
  describe('encodeCommand', () => {
    it('packs selector, flags, inputs, output, and target into bytes32', () => {
      const result = encodeCommand(SELECTOR, CALL, [0, 1, 2], 3, TARGET_A)

      // Expected layout (32 bytes):
      //   aabbccdd            — selector
      //   01                  — CALL flag
      //   000102ffffff        — inputs [0, 1, 2, 0xFF, 0xFF, 0xFF]
      //   03                  — output slot 3
      //   1234567890123456789012345678901234567890  — target
      expect(result).to.equal('0xaabbccdd01000102ffffff031234567890123456789012345678901234567890')
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
      expect(() => encodeCommand(SELECTOR, CALL, [0, 1, 2, 3, 4, 5, 6], 0, TARGET_A)).to.throw('exceeds maximum of 6')
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

    it('initializes runtime slots to empty bytes and does not set their bitmap bits', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'runtime', key: 'amount' }],
      }
      const { state, stateBitmap } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(state[0]).to.equal(EMPTY)
      expect(stateBitmap).to.equal(0n) // bit 0 stays 0
    })

    it('correctly computes stateBitmap for mixed slot types', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [
          { type: 'literal', value: '0x01' as const }, // slot 0 — pinned
          { type: 'magic', key: 'poolId' }, // slot 1 — pinned
          { type: 'configurable', key: 'slippageBps' }, // slot 2 — pinned
          { type: 'runtime', key: 'amount' }, // slot 3 — NOT pinned
          { type: 'literal', value: '0x02' as const }, // slot 4 — pinned
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
      expect(state[1]).to.equal(EMPTY)
      expect(stateBitmap).to.equal(1n) // only slot 0 pinned
    })

    it('emits an extended command word when an action needs more than 6 input specifiers', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'extended',
        actions: [
          {
            target: TARGET_A,
            selector: SELECTOR,
            callType: CALL,
            inputs: [0, 1, 2, 3, 4, 5, 6],
            output: UNUSED_SLOT,
          },
        ],
        state: Array.from({ length: 7 }, (_, index) => ({
          type: 'literal' as const,
          value: `0x${(index + 1).toString(16).padStart(64, '0')}` as const,
        })),
      }

      const { commands } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(commands).to.have.length(2)
      expect(commands[0]).to.equal('0xaabbccdd41ffffffffffffff' + TARGET_A.slice(2))
      expect(commands[1]).to.match(/^0x00010203040506ff/)
    })

    it('emits an extended VALUECALL command when the ETH value plus args exceed 6 specifiers', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'payable-extended',
        actions: [
          {
            target: TARGET_A,
            selector: SELECTOR,
            callType: VALUECALL,
            inputs: [0, 1, 2, 3, 4, 5, 6],
            output: UNUSED_SLOT,
          },
        ],
        state: Array.from({ length: 7 }, (_, index) => ({
          type: 'literal' as const,
          value: `0x${(index + 1).toString(16).padStart(64, '0')}` as const,
        })),
      }

      const { commands } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(commands).to.have.length(2)
      expect(commands[0]).to.equal('0xaabbccdd43ffffffffffffff' + TARGET_A.slice(2))
      expect(commands[1]).to.match(/^0x00010203040506ff/)
    })

    it('assembles pinned raw calldata slots for dynamic inputs', () => {
      const assets = [[TARGET_B, 100n]] as const
      const encodedAssets = encodeAbiParameters(
        [
          {
            type: 'tuple[]',
            components: [{ type: 'address' }, { type: 'uint256' }],
          },
        ],
        [assets]
      ) as `0x${string}`
      const workflow: WorkflowDefinition = {
        workflowRef: 'raw-dynamic',
        actions: [
          {
            target: TARGET_A,
            selector: SELECTOR,
            callType: CALL,
            inputs: [2],
            output: UNUSED_SLOT,
            rawMode: true,
          },
        ],
        state: [
          { type: 'magic', key: 'poolId' },
          { type: 'configurable', key: 'assets' },
          {
            type: 'rawcalldata',
            selector: SELECTOR,
            parameterTypes: ['uint64', '(address,uint256)[]'],
            sourceSlots: [0, 1],
            actionIndex: 0,
          },
        ],
      }

      const { commands, state, stateBitmap } = buildScript(workflow, {
        poolContext: POOL_CTX,
        configurableValues: { assets: encodedAssets },
      })

      expect(commands[0]).to.equal(
        '0xaabbccdd2102ffffffffff' + UNUSED_SLOT.toString(16).padStart(2, '0') + TARGET_A.slice(2)
      )
      expect(state[0]).to.equal(POOL_CTX['poolId'])
      expect(state[1]).to.equal(encodedAssets)
      expect(state[2]).to.equal(
        concat([
          SELECTOR,
          encodeAbiParameters(
            [{ type: 'uint64' }, { type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }] }],
            [1n, assets]
          ),
        ])
      )
      expect(stateBitmap).to.equal(0b111n)
    })

    it('assembles bytes parameters as ABI dynamic calldata in raw mode', () => {
      const hookData = '0x636374702d686f6f6b2d646174612d30303030303030303030303030303031' as const
      // Literal `bytes` slots are stored in the inner ABI form [length][padded data] (matches
      // encodeLiteralValue); the rawcalldata assembler decodes it back to the raw value.
      const hookDataFramed =
        '0x000000000000000000000000000000000000000000000000000000000000001f636374702d686f6f6b2d646174612d3030303030303030303030303030303100' as const
      const workflow: WorkflowDefinition = {
        workflowRef: 'raw-bytes',
        actions: [
          {
            target: TARGET_A,
            selector: SELECTOR,
            callType: CALL,
            inputs: [1],
            output: UNUSED_SLOT,
            rawMode: true,
          },
        ],
        state: [
          { type: 'literal', value: hookDataFramed },
          {
            type: 'rawcalldata',
            selector: SELECTOR,
            parameterTypes: ['bytes'],
            sourceSlots: [0],
            actionIndex: 0,
          },
        ],
      }

      const { state } = buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })

      expect(state[0]).to.equal(hookDataFramed)
      expect(state[1]).to.equal(concat([SELECTOR, encodeAbiParameters([{ type: 'bytes' }], [hookData])]))
    })

    it('throws when a magic key is missing from pool context', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'magic', key: 'missingKey' }],
      }
      expect(() => buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })).to.throw(
        'magic variable "missingKey" not found in pool context'
      )
    })

    it('throws when a configurable key is not provided', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'configurable', key: 'missingConfig' }],
      }
      expect(() => buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })).to.throw(
        'configurable value "missingConfig" not provided'
      )
    })

    it('resolves magic command targets from pool context', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [
          {
            target: { type: 'magic', key: '$onOffRamp' },
            selector: SELECTOR,
            callType: CALL,
            inputs: [],
            output: UNUSED_SLOT,
          },
        ],
        state: [],
      }

      const { commands } = buildScript(workflow, {
        poolContext: {
          ...POOL_CTX,
          $onOffRamp: '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        configurableValues: {},
      })

      expect(commands[0]).to.equal('0xaabbccdd01ffffffffffffffaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    })

    it('throws when state exceeds 128 slots', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: Array.from({ length: 129 }, () => ({ type: 'runtime' as const, key: 'x' })),
      }
      expect(() => buildScript(workflow, { poolContext: POOL_CTX, configurableValues: {} })).to.throw('maximum is 128')
    })
  })

  describe('fillRuntimeSlots', () => {
    const PINNED = '0x0000000000000000000000000000000000000000000000000000000000000064' as const
    const RUNTIME_VALUE = '0x00000000000000000000000000000000000000000000000000000000000000de' as const

    const workflow: WorkflowDefinition = {
      workflowRef: 'test',
      actions: [],
      state: [
        { type: 'literal', value: PINNED },
        { type: 'runtime', key: 'amount' },
        { type: 'runtime', key: 'recipient' },
      ],
      runtimeVariables: ['amount', 'recipient'],
    }

    it('fills runtime slots and leaves pinned slots unchanged', () => {
      const state: `0x${string}`[] = [PINNED, EMPTY, EMPTY]
      const recipient = '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd' as const
      const filled = fillRuntimeSlots(state, workflow, { amount: RUNTIME_VALUE, recipient })

      expect(filled[0]).to.equal(PINNED)
      expect(filled[1]).to.equal(RUNTIME_VALUE)
      expect(filled[2]).to.equal(recipient)
    })

    it('returns a new array (does not mutate input)', () => {
      const state: `0x${string}`[] = [PINNED, EMPTY, EMPTY]
      const original = [...state]
      fillRuntimeSlots(state, workflow, { amount: RUNTIME_VALUE, recipient: RUNTIME_VALUE })
      expect(state).to.deep.equal(original)
    })

    it('throws when a required runtime variable has no matching value', () => {
      const state: `0x${string}`[] = [PINNED, EMPTY, EMPTY]
      expect(
        () => fillRuntimeSlots(state, workflow, { amount: RUNTIME_VALUE }) // missing 'recipient'
      ).to.throw('"recipient"')
    })

    it('leaves computed runtime slots empty when absent from runtimeValues', () => {
      const computedWorkflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [
          { type: 'literal', value: PINNED },
          { type: 'runtime', key: 'amount' },
          { type: 'runtime', key: 'computed' }, // computed by weiroll VM, not user-filled
        ],
        runtimeVariables: ['amount'], // "computed" not listed — it's weiroll-computed
      }
      const state: `0x${string}`[] = [PINNED, EMPTY, EMPTY]
      const filled = fillRuntimeSlots(state, computedWorkflow, { amount: RUNTIME_VALUE })
      expect(filled[0]).to.equal(PINNED)
      expect(filled[1]).to.equal(RUNTIME_VALUE)
      expect(filled[2]).to.equal(EMPTY) // left empty for VM to fill
    })

    it('handles a workflow with no runtime slots (returns state unchanged)', () => {
      const noRuntimeWorkflow: WorkflowDefinition = {
        workflowRef: 'test',
        actions: [],
        state: [{ type: 'literal', value: PINNED }],
      }
      const state: `0x${string}`[] = [PINNED]
      const filled = fillRuntimeSlots(state, noRuntimeWorkflow, {})
      expect(filled).to.deep.equal([PINNED])
    })

    it('assembles raw calldata slots after runtime values are filled', () => {
      const rawWorkflow: WorkflowDefinition = {
        workflowRef: 'raw-runtime',
        actions: [],
        state: [
          { type: 'runtime', key: 'amount', parameter: 'uint256' },
          {
            type: 'rawcalldata',
            selector: SELECTOR,
            parameterTypes: ['uint256'],
            sourceSlots: [0],
            actionIndex: 0,
          },
        ],
        runtimeVariables: ['amount'],
      }

      const state: `0x${string}`[] = [EMPTY, EMPTY]
      const filled = fillRuntimeSlots(state, rawWorkflow, { amount: RUNTIME_VALUE })

      expect(filled[0]).to.equal(RUNTIME_VALUE)
      expect(filled[1]).to.equal(concat([SELECTOR, RUNTIME_VALUE]))
    })

    it('rejects runtime values for keys the workflow never declared', () => {
      // A key outside runtimeVariables backs a slot the review surface never showed, so
      // accepting it would execute with a value nobody approved.
      const workflow: WorkflowDefinition = {
        workflowRef: 'undeclared',
        actions: [],
        state: [{ type: 'runtime', key: 'amount', parameter: 'uint256' }],
        runtimeVariables: ['amount'],
      }

      expect(() => fillRuntimeSlots([EMPTY], workflow, { amount: RUNTIME_VALUE, recipient: RUNTIME_VALUE })).to.throw(
        /unexpected runtime values for: "recipient"/
      )
    })

    it('still accepts the SDK-internal payable-value slot, which is not a declared variable', () => {
      const workflow: WorkflowDefinition = {
        workflowRef: 'payable',
        actions: [],
        state: [
          { type: 'runtime', key: 'amount', parameter: 'uint256' },
          { type: 'runtime', key: '__sdk_payable_value:0', parameter: 'uint256', system: 'payableValue' },
        ],
        runtimeVariables: ['amount'],
      }

      const filled = fillRuntimeSlots([EMPTY, EMPTY], workflow, {
        amount: RUNTIME_VALUE,
        '__sdk_payable_value:0': RUNTIME_VALUE,
      })
      expect(filled[1]).to.equal(RUNTIME_VALUE)
    })
  })

  describe('buildScript raw calldata pinning', () => {
    it('refuses to build a script whose raw calldata depends on a runtime value', () => {
      // An unassembled raw slot stays out of the state bitmap, so the caller supplies the whole
      // call — selector included — against a pinned target with the proof still valid.
      const workflow: WorkflowDefinition = {
        workflowRef: 'unpinnable-raw',
        actions: [
          { target: TARGET_A, selector: SELECTOR, callType: CALL, inputs: [1], output: UNUSED_SLOT, rawMode: true },
        ],
        state: [
          { type: 'runtime', key: 'amount', parameter: 'uint256' },
          {
            type: 'rawcalldata',
            selector: SELECTOR,
            parameterTypes: ['uint256'],
            sourceSlots: [0],
            actionIndex: 0,
          },
        ],
        runtimeVariables: ['amount'],
      }

      expect(() => buildScript(workflow, { poolContext: {}, configurableValues: {} })).to.throw(
        /depends on a runtime value/
      )
    })
  })

  describe('getWorkflowAbiParameter', () => {
    // These two shapes were hardcoded before the parser went in, and they are the two that
    // still compile to FLAG_RAW for script-hash stability. If parsing ever stopped
    // reproducing them exactly, published hashes would move silently.
    it('reproduces the formerly hardcoded tuple arrays exactly', () => {
      expect(getWorkflowAbiParameter('(address,uint256)[]')).to.deep.equal({
        type: 'tuple[]',
        components: [{ type: 'address' }, { type: 'uint256' }],
      })
      expect(getWorkflowAbiParameter('(address,address)[]')).to.deep.equal({
        type: 'tuple[]',
        components: [{ type: 'address' }, { type: 'address' }],
      })
    })

    it('parses shapes the hardcoded map could not express', () => {
      expect(getWorkflowAbiParameter('(address,uint256,uint256,address)[]')).to.deep.equal({
        type: 'tuple[]',
        components: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
      })
    })

    it('names the parameter it cannot parse', () => {
      expect(() => getWorkflowAbiParameter('(not a type)[]')).to.throw(/cannot parse ABI parameter/)
    })
  })

  describe('encodeVariableLengthValue', () => {
    it('produces a non-zero multiple of 32 bytes for every dynamic shape', () => {
      const cases: Array<[string, unknown]> = [
        ['bytes', '0xdeadbeef'],
        ['string', 'hello'],
        ['uint256[]', [1n, 2n, 3n]],
        [
          '(address,uint256,uint256,address)[]',
          [['0x1111111111111111111111111111111111111111', 1n, 2n, '0x2222222222222222222222222222222222222222']],
        ],
      ]
      for (const [parameter, value] of cases) {
        const encoded = encodeVariableLengthValue(parameter, value)
        const byteLength = (encoded.length - 2) / 2
        expect(byteLength, parameter).to.be.greaterThan(0)
        expect(byteLength % 32, parameter).to.equal(0)
      }
    })

    it('drops only the leading offset word, leaving a relocatable inner encoding', () => {
      const parameter = 'uint256[]'
      const standalone = encodeAbiParameters([{ type: 'uint256[]' }], [[7n, 8n]])
      expect(encodeVariableLengthValue(parameter, [7n, 8n])).to.equal(`0x${standalone.slice(66)}`)
    })
  })

  describe('isDynamicAbiType', () => {
    const MARKET = '(uint256,address,address,(address,uint256,uint256,address)[],uint256,uint256,address,address)'
    const MIDNIGHT_OFFER = `(${MARKET},bool,address,uint256,uint256,uint256,bytes32,address,bytes,address,address,bool,uint128,uint128,uint256)`

    const cases: Array<[string, boolean]> = [
      ['uint256', false],
      ['address', false],
      ['bytes32', false],
      ['bool', false],
      ['(address,uint256)', false],
      ['bytes32[3]', false],
      ['(address,uint256)[2]', false],
      ['bytes', true],
      ['string', true],
      ['uint256[]', true],
      ['(address,uint256)[]', true],
      ['(address,uint256,uint256,address)[]', true],
      // A dynamic tuple with no array member matched neither old heuristic, so it was
      // classified static and encoded as one word where an offset and tail belong.
      ['(address,bytes)', true],
      ['(uint256,string)', true],
      // A fixed-size array is dynamic iff its element is.
      ['bytes[3]', true],
      // Midnight's Offer: contains '[]' but ends in ')', which is what split the two
      // old predicates apart.
      [MIDNIGHT_OFFER, true],
    ]

    for (const [parameter, expected] of cases) {
      it(`${expected ? 'dynamic' : 'static'}: ${parameter.length > 48 ? `${parameter.slice(0, 45)}…` : parameter}`, () => {
        expect(isDynamicAbiType(parameter)).to.equal(expected)
      })
    }

    it('treats an unparseable type as static rather than throwing', () => {
      expect(isDynamicAbiType('(not a type)')).to.equal(false)
    })
  })

  describe('staticHeadWordCount', () => {
    // How many head words a type occupies, which is what decides whether it can ride in a
    // single state slot. A slot is one word, so anything other than 1 is unrepresentable.
    const cases: Array<[string, number]> = [
      // Elementary types are one word each.
      ['uint256', 1],
      ['uint8', 1],
      ['address', 1],
      ['bool', 1],
      ['bytes32', 1],
      // Dynamic types occupy a single offset word in the head, whatever their payload.
      ['bytes', 1],
      ['string', 1],
      ['uint256[]', 1],
      ['(address,uint256)[]', 1],
      ['(address,bytes)', 1],
      // Static aggregates are inlined, so they are as wide as their leaves.
      ['(address,uint256)', 2],
      ['(address,uint256,uint256,address)', 4],
      ['bytes32[3]', 3],
      ['(address,uint256)[2]', 4],
      // Nesting sums all the way down.
      ['((address,uint256),bool)', 3],
      ['((address,uint256)[2],bytes32)', 5],
      // A fixed array of a dynamic element is itself dynamic: one offset word.
      ['bytes[3]', 1],
      // The degenerate case the fuzz surfaced: zero-length fixed array, no head at all.
      ['bytes2[0]', 0],
    ]

    for (const [parameter, words] of cases) {
      it(`${parameter} occupies ${words} word${words === 1 ? '' : 's'}`, () => {
        expect(staticHeadWordCount(parameter)).to.equal(words)
      })
    }

    it('falls back to one word for an unparseable type, rather than throwing', () => {
      expect(staticHeadWordCount('(not a type)')).to.equal(1)
    })
  })
})
