import { expect } from 'chai'
import { decodeAbiParameters, toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'
import { buildScript } from './weiroll.js'

const ADDRESS_A = '0x1111111111111111111111111111111111111111' as const
const ADDRESS_B = '0x2222222222222222222222222222222222222222' as const
const ADDRESS_C = '0x3333333333333333333333333333333333333333' as const
const ADDRESS_D = '0x4444444444444444444444444444444444444444' as const
const ONCHAIN_PM_BYTES32 = '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

describe('utils/catalog', () => {
  it('normalizes runtime keys and configurable slots from catalog actions', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'deposit',
      name: 'Deposit',
      template: 'deposit',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      actions: [
        {
          target: '$router',
          selector: 'function deposit(uint256,uint256)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['$amount'] },
            { parameter: 'uint256', label: 'Max fee', input: [], configurable: true },
          ],
          returns: '$sharesReceived',
        },
        {
          target: '$onOffRamp',
          selector: 'function send(uint256,address)',
          inputs: [
            { parameter: 'uint256', label: 'Shares', input: ['$sharesReceived'] },
            { parameter: 'address', label: 'Receiver', input: ['$executor'] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.runtimeVariables).to.deep.equal(['amount'])
    expect(definition.actions[1]!.target).to.deep.equal({ type: 'magic', key: '$onOffRamp' })
    expect(definition.state).to.deep.equal([
      {
        type: 'runtime',
        key: 'amount',
        label: 'Amount',
        parameter: 'uint256',
        actionName: 'function deposit(uint256,uint256)',
        actionIndex: 0,
        inputIndex: 0,
      },
      {
        type: 'configurable',
        key: 'configurable:0:1',
        label: 'Max fee',
        parameter: 'uint256',
        actionName: 'function deposit(uint256,uint256)',
        actionIndex: 0,
        inputIndex: 1,
      },
      { type: 'runtime', key: 'sharesReceived', label: 'sharesReceived', parameter: '' },
      { type: 'magic', key: '$executor' },
    ])
  })

  it('maps empty non-configurable inputs from declared runtimeVariables', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'request-deposit',
      name: 'Request deposit',
      template: 'request-deposit',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      actions: [
        {
          target: '$router',
          selector: 'function deposit(uint256)',
          inputs: [{ parameter: 'uint256', label: 'Amount', input: [] }],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    expect(definition.runtimeVariables).to.deep.equal(['amount'])
    expect(definition.state).to.deep.equal([
      {
        type: 'runtime',
        key: 'amount',
        label: 'Amount',
        parameter: 'uint256',
        actionName: 'function deposit(uint256)',
        actionIndex: 0,
        inputIndex: 0,
      },
    ])
  })

  it('synthesizes runtime inputs when empty non-configurable inputs have no runtimeVariables metadata', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'bad-empty',
      name: 'Bad',
      template: 'bad',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$router',
          selector: 'function deposit(uint256)',
          inputs: [{ parameter: 'uint256', label: 'Amount', input: [] }],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    expect(definition.runtimeVariables).to.deep.equal(['runtime:0:0'])
    expect(definition.state).to.deep.equal([
      {
        type: 'runtime',
        key: 'runtime:0:0',
        label: 'Amount',
        parameter: 'uint256',
        actionName: 'function deposit(uint256)',
        actionIndex: 0,
        inputIndex: 0,
        anonymous: true,
      },
    ])
  })

  it('rejects ambiguous empty non-configurable input mappings', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'bad-empty-count',
      name: 'Bad',
      template: 'bad',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      actions: [
        {
          target: '$router',
          selector: 'function deposit(uint256,uint256)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: [] },
            { parameter: 'uint256', label: 'Amount 2', input: [] },
          ],
        },
      ],
    }

    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw(
      'declares 1 runtimeVariables for 2 empty non-configurable inputs'
    )
  })

  it('keeps dynamic-input actions as standard workflow actions when they fit the weiroll command shape', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'slippage-open',
      name: 'Slippage open',
      template: 'slippage-open',
      chainId: 1,
      variables: { guard: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$guard',
          selector: 'function open(uint64,bytes16,(address,uint256)[])',
          inputs: [
            { parameter: 'uint64', label: 'Pool ID', input: ['$poolId'] },
            { parameter: 'bytes16', label: 'SC ID', input: ['$scId'] },
            { parameter: '(address,uint256)[]', label: 'Assets', input: [], configurable: true },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    const selector = toFunctionSelector('function open(uint64,bytes16,(address,uint256)[])')
    expect(definition.actions[0]).to.deep.include({
      target: ADDRESS_A,
      selector,
    })
    expect(definition.actions[0]!.rawMode).to.equal(true)
    expect(definition.actions[0]!.inputs).to.deep.equal([3])
    expect(definition.state[3]).to.deep.equal({
      type: 'rawcalldata',
      selector,
      parameterTypes: ['uint64', 'bytes16', '(address,uint256)[]'],
      sourceSlots: [0, 1, 2],
      actionName: 'function open(uint64,bytes16,(address,uint256)[])',
      actionIndex: 0,
    })
    expect(definition.state[2]).to.deep.equal({
      type: 'configurable',
      key: 'configurable:0:2',
      label: 'Assets',
      parameter: '(address,uint256)[]',
      actionName: 'function open(uint64,bytes16,(address,uint256)[])',
      actionIndex: 0,
      inputIndex: 2,
    })
  })

  it('encodes bytes parameters with literal workflow-variable values as individual slots without FLAG_RAW', () => {
    // $hookData is a declared workflow variable (literal, bit-1).  With the
    // fix, hasDynamicInput returns false for this bytes input because its value
    // is known at build time — FLAG_RAW must NOT fire and the parameter should
    // get its own literal slot encoded with the 0x80 dynamic specifier.
    const hookData = '0x636374702d686f6f6b2d646174612d30303030303030303030303030303031' as const
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'cctp-send-auto',
      name: 'CCTP send auto',
      template: 'cctp_send_auto',
      chainId: 1,
      variables: { messenger: ADDRESS_A, hookData },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$messenger',
          selector: 'function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['100'] },
            { parameter: 'uint32', label: 'Destination domain', input: ['0'] },
            {
              parameter: 'bytes32',
              label: 'Mint recipient',
              input: ['0x0000000000000000000000002222222222222222222222222222222222222222'],
            },
            { parameter: 'address', label: 'Burn token', input: [ADDRESS_B] },
            {
              parameter: 'bytes32',
              label: 'Destination caller',
              input: ['0x0000000000000000000000001111111111111111111111111111111111111111'],
            },
            { parameter: 'uint256', label: 'Max fee', input: ['0'] },
            { parameter: 'uint32', label: 'Min finality threshold', input: ['1000'] },
            { parameter: 'bytes', label: 'Hook data', input: ['$hookData'] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    // No FLAG_RAW — each parameter has its own slot.
    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    // Slots: 0=amount(100), 1=domain/maxFee(0), 2=mintRecipient/burnToken, 3=destCaller, 4=minFinality(1000), 5=hookData
    expect(definition.state[5]).to.deep.equal({ type: 'literal', value: hookData })
    // The 8 inputs reference slots [0,1,2,2,3,1,4,5]; bytes gets 0x80|5 = 133.
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 1, 2, 2, 3, 1, 4, 133])
    // No rawcalldata slot.
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)
  })

  it('encodes configurable bytes parameters as individual slots without FLAG_RAW', () => {
    // configurable: true on a bytes input means the hub manager pins the value
    // at leaf-creation time.  FLAG_RAW must NOT fire — the parameter should get
    // its own configurable slot (bit-1) with the 0x80 dynamic specifier.
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'cctp-send-auto-configurable',
      name: 'CCTP send auto (configurable hook)',
      template: 'cctp_send_auto',
      chainId: 1,
      variables: { messenger: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      actions: [
        {
          target: '$messenger',
          selector: 'function depositForBurnWithHook(uint256,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: [] },
            { parameter: 'bytes', label: 'Hook data', input: [], configurable: true },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    // slot 0 = runtime amount (bit-0), slot 1 = configurable hookData (bit-1)
    expect(definition.state[1]).to.deep.include({ type: 'configurable', parameter: 'bytes' })
    // bytes slot uses 0x80 dynamic specifier; amount slot uses plain index 0
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 0x80 | 1])
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)
  })

  it('still uses FLAG_RAW for runtime bytes parameters', () => {
    // A bytes input with input: [] (runtime, non-configurable) must still
    // produce a rawcalldata blob — FLAG_RAW behaviour is preserved for the
    // case where the bytes value is not known at build time.
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'runtime-bytes',
      name: 'Runtime bytes',
      template: 'runtime-bytes',
      chainId: 1,
      variables: { target: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount', 'payload'],
      actions: [
        {
          target: '$target',
          selector: 'function call(uint256,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: [] },
            { parameter: 'bytes', label: 'Payload', input: [] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]!.rawMode).to.equal(true)
    // The action's single input points at the rawcalldata blob slot.
    const blobSlotIndex = definition.actions[0]!.inputs[0]
    expect(definition.state[blobSlotIndex!]).to.deep.include({ type: 'rawcalldata' })
  })

  it('injects useTemplate bytes inputs as pinned callback script data', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'morpho-loop',
      name: 'Morpho loop',
      template: 'morpho_loop_deposit',
      chainId: 1,
      variables: {
        flashLoanHelper: ADDRESS_A,
        pool: ADDRESS_B,
        asset: ADDRESS_C,
        vault: ADDRESS_D,
      },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      templates: {
        morpho_loop_deposit_callback: {
          actions: [
            {
              target: '$asset',
              selector: 'function balanceOf(address)',
              inputs: [{ parameter: 'address', label: 'Account', input: ['$onchainPM'] }],
              returns: '$totalAmount',
            },
            {
              target: '$vault',
              selector: 'function deposit(uint256,address)',
              inputs: [
                { parameter: 'uint256', label: 'Assets', input: ['$totalAmount'] },
                { parameter: 'address', label: 'Receiver', input: ['$onchainPM'] },
              ],
            },
            {
              target: '$vault',
              selector: 'function supplyCollateral(uint256,bytes)',
              inputs: [
                { parameter: 'uint256', label: 'Shares', input: ['$totalAmount'] },
                { parameter: 'bytes', label: 'Data', input: [], configurable: true },
              ],
            },
          ],
        },
      },
      actions: [
        {
          target: '$flashLoanHelper',
          selector: 'function requestFlashLoan(address,address,uint256,address,bytes)',
          inputs: [
            { parameter: 'address', label: 'Aave Pool', input: ['$pool'] },
            { parameter: 'address', label: 'Token', input: ['$asset'] },
            { parameter: 'uint256', label: 'Amount', input: [] },
            { parameter: 'address', label: 'OnchainPM', input: ['$onchainPM'] },
            {
              parameter: 'bytes',
              label: 'Callback data',
              input: [],
              useTemplate: {
                template: 'morpho_loop_deposit_callback',
                map: {
                  asset: '$asset',
                  vault: '$vault',
                },
              },
            },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    const callbackInput = definition.actions[0]!.inputs[4]!
    const callbackSlot = callbackInput & 0x7f

    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(callbackInput).to.equal(0x80 | callbackSlot)
    expect(definition.state[callbackSlot]).to.deep.include({
      type: 'template',
      label: 'Callback data',
      actionIndex: 0,
      inputIndex: 4,
    })
    const templateSlot = definition.state[callbackSlot]
    if (!templateSlot || templateSlot.type !== 'template') {
      throw new Error('Expected callback slot to be a template slot')
    }
    expect(templateSlot.workflow.actions[2]!.rawMode).to.equal(undefined)
    // The callback's `bytes data = 0x` literal must materialize as a 32-byte
    // zero word (abi-encoded `bytes("")`), not raw `'0x'` (0 bytes). The latter
    // trips weiroll's CommandBuilder check that dynamic state variables be a
    // non-zero multiple of 32 bytes when the callback's supplyCollateral runs.
    expect(
      templateSlot.workflow.state.some((slot) => slot.type === 'literal' && slot.value === `0x${'00'.repeat(32)}`)
    ).to.equal(true)
    expect(definition.runtimeVariables).to.deep.equal(['amount'])

    const { state, stateBitmap } = buildScript(definition, {
      poolContext: { $onchainPM: ONCHAIN_PM_BYTES32 },
      configurableValues: {},
    })
    expect((stateBitmap & (1n << BigInt(callbackSlot))) !== 0n).to.equal(true)

    // weiroll's CommandBuilder copies state[idx] verbatim into the parent's
    // calldata at the bytes-input offset, without writing a length-prefix word.
    // The first 32 bytes of state[callbackSlot] must therefore BE the length,
    // and the remainder must abi-decode to (bytes32[], bytes[], uint128).
    const callbackSlotData = state[callbackSlot]!
    const callbackBytes = `0x${callbackSlotData.slice(2 + 64)}` as HexString
    const declaredLength = Number(BigInt(`0x${callbackSlotData.slice(2, 2 + 64)}`))
    expect(declaredLength).to.equal((callbackBytes.length - 2) / 2)
    const [commands, callbackState, callbackStateBitmap] = decodeAbiParameters(
      [{ type: 'bytes32[]' }, { type: 'bytes[]' }, { type: 'uint128' }],
      callbackBytes
    )
    expect(commands).to.have.length(3)
    expect(callbackState).to.include(ONCHAIN_PM_BYTES32)
    expect(typeof callbackStateBitmap).to.equal('bigint')
    // Every PINNED state slot must be a non-zero multiple of 32 bytes —
    // weiroll's CommandBuilder.setupDynamicVariable enforces this at execute
    // time, so violations here would only surface as opaque on-chain reverts.
    // Runtime slots (bit = 0) are filled later via fillRuntimeSlots.
    for (const [i, slot] of state.entries()) {
      if (((stateBitmap >> BigInt(i)) & 1n) === 0n) continue
      const byteLen = (slot.length - 2) / 2
      expect(byteLen, `state[${i}] = ${slot} must be non-zero`).to.be.greaterThan(0)
      expect(byteLen % 32, `state[${i}] length ${byteLen} must be a multiple of 32`).to.equal(0)
    }
  })

  it('keeps empty bytes literals with computed returns on the standard dynamic path', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'empty-bytes-computed',
      name: 'Empty bytes with computed return',
      template: 'empty-bytes-computed',
      chainId: 1,
      variables: { vault: ADDRESS_A, morpho: ADDRESS_B },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$vault',
          selector: 'function deposit(uint256,address)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['100'] },
            { parameter: 'address', label: 'Receiver', input: ['$onchainPM'] },
          ],
          returns: '$shares',
        },
        {
          target: '$morpho',
          selector: 'function supplyCollateral(uint256,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Shares', input: ['$shares'] },
            { parameter: 'bytes', label: 'Data', input: ['0x'] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    const bytesInput = definition.actions[1]!.inputs[1]!
    const bytesSlot = bytesInput & 0x7f

    expect(definition.actions[1]!.rawMode).to.equal(undefined)
    expect(bytesInput).to.equal(0x80 | bytesSlot)
    // The natural empty-bytes literal `0x` must materialize as a 32-byte zero
    // word so weiroll's CommandBuilder.setupDynamicVariable accepts it. A raw
    // 0-byte state slot reverts at execute time with "Dynamic state variables
    // must be a multiple of 32 bytes".
    expect(definition.state[bytesSlot]).to.deep.equal({ type: 'literal', value: `0x${'00'.repeat(32)}` })
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)

    // Build the script and confirm every pinned state slot is a non-zero
    // multiple of 32 bytes — the invariant weiroll enforces on-chain.
    const { state, stateBitmap } = buildScript(definition, {
      poolContext: { $onchainPM: ONCHAIN_PM_BYTES32 },
      configurableValues: {},
    })
    for (const [i, slot] of state.entries()) {
      if (((stateBitmap >> BigInt(i)) & 1n) === 0n) continue
      const byteLen = (slot.length - 2) / 2
      expect(byteLen, `state[${i}] = ${slot} must be non-zero`).to.be.greaterThan(0)
      expect(byteLen % 32, `state[${i}] length ${byteLen} must be a multiple of 32`).to.equal(0)
    }
  })

  it('allows bytes-valued helper actions to return values for downstream use', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'bytes-helper',
      name: 'Bytes helper',
      template: 'bytes-helper',
      chainId: 1,
      variables: { helper: ADDRESS_A, target: ADDRESS_B },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$helper',
          selector: 'function bytesConcat(bytes,bytes)',
          inputs: [
            { parameter: 'bytes', label: 'A', input: ['0x01'] },
            { parameter: 'bytes', label: 'B', input: ['0x02'] },
          ],
          returns: '$payload',
        },
        {
          target: '$target',
          selector: 'function usePayload(bytes)',
          inputs: [{ parameter: 'bytes', label: 'Payload', input: ['$payload'] }],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(definition.actions[0]!.inputs).to.deep.equal([0x80, 0x81])
    expect(definition.actions[0]!.output).to.equal(0x82)
    expect(definition.actions[1]!.inputs).to.deep.equal([0x82])
    expect(definition.state[2]).to.deep.equal({
      type: 'runtime',
      key: 'payload',
      label: 'payload',
      parameter: '',
    })
  })

  it('keeps over-6-input static actions as standard commands for extended weiroll encoding', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'many-inputs',
      name: 'Many inputs',
      template: 'many-inputs',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$router',
          selector: 'function execute(uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
          inputs: [
            { parameter: 'uint256', label: 'A', input: ['1'] },
            { parameter: 'uint256', label: 'B', input: ['2'] },
            { parameter: 'uint256', label: 'C', input: ['3'] },
            { parameter: 'uint256', label: 'D', input: ['4'] },
            { parameter: 'uint256', label: 'E', input: ['5'] },
            { parameter: 'uint256', label: 'F', input: ['6'] },
            { parameter: 'uint256', label: 'G', input: ['7'] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 1, 2, 3, 4, 5, 6])
  })

  it('adds internal runtime slots for payable actions without exposing them to the user', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'payable-update',
      name: 'Payable update',
      template: 'payable-update',
      chainId: 1,
      variables: { spoke: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$spoke',
          selector: 'function submitQueuedAssets(uint64,bytes16,uint128,uint128,address)',
          valueNonZero: true,
          inputs: [
            { parameter: 'uint64', label: 'Pool', input: ['1'] },
            { parameter: 'bytes16', label: 'SC', input: ['0x01'] },
            { parameter: 'uint128', label: 'Asset', input: ['2'] },
            { parameter: 'uint128', label: 'Gas', input: ['0'] },
            { parameter: 'address', label: 'Refund', input: [ADDRESS_B] },
          ],
        },
      ],
    }

    const definition = buildWorkflowDefinitionFromCatalog(workflow)
    expect(definition.runtimeVariables).to.deep.equal([])
    expect(definition.actions[0]!.callType).to.equal(3)
    const payableSlotIndex = definition.state.findIndex(
      (slot) => slot.type === 'runtime' && slot.system === 'payableValue'
    )
    expect(payableSlotIndex).to.equal(4)
    expect(definition.actions[0]!.inputs[0]).to.equal(payableSlotIndex)
    expect(definition.actions[0]!.inputs).to.have.length(6)
    expect(definition.state[4]).to.deep.equal({
      type: 'runtime',
      key: '__sdk_payable_value:0',
      parameter: 'uint256',
      actionName: 'function submitQueuedAssets(uint64,bytes16,uint128,uint128,address)',
      actionIndex: 0,
      inputIndex: -1,
      system: 'payableValue',
    })
  })

  it('rejects multi-value inputs', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'bad-multi',
      name: 'Bad',
      template: 'bad',
      chainId: 1,
      variables: { router: ADDRESS_A, token: ADDRESS_B },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$router',
          selector: 'function check((address,address)[])',
          inputs: [{ parameter: '(address,address)[]', label: 'Pairs', input: ['$router', '$token'] }],
        },
      ],
    }

    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw('multi-value inputs are not supported')
  })

  it('rejects targets that are not workflow variables or magic variables', () => {
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'bad-target',
      name: 'Bad',
      template: 'bad',
      chainId: 1,
      variables: { router: ADDRESS_A },
      workflowId: '0x01',
      version: 1,
      actions: [
        {
          target: '$computedTarget',
          selector: 'function deposit(uint256)',
          inputs: [{ parameter: 'uint256', label: 'Amount', input: ['$amount'] }],
        },
      ],
    }

    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw('is not a workflow variable or magic variable')
  })
})
