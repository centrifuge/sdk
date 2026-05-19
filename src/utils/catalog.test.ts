import { expect } from 'chai'
import { toFunctionSelector } from 'viem'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'

const ADDRESS_A = '0x1111111111111111111111111111111111111111' as const
const ADDRESS_B = '0x2222222222222222222222222222222222222222' as const

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
    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 1, 2])
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
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 1])
    expect(definition.actions[0]!.output).to.equal(2)
    expect(definition.actions[1]!.inputs).to.deep.equal([2])
    expect(definition.state[2]).to.deep.equal({
      type: 'runtime',
      key: 'payload',
      label: 'payload',
      parameter: '',
    })
  })

  it('compiles over-6-input actions into raw calldata commands', () => {
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
    const selector = toFunctionSelector('function execute(uint256,uint256,uint256,uint256,uint256,uint256,uint256)')
    expect(definition.actions[0]!.rawMode).to.equal(true)
    expect(definition.actions[0]!.inputs).to.deep.equal([7])
    expect(definition.state[7]).to.deep.equal({
      type: 'rawcalldata',
      selector,
      parameterTypes: ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      sourceSlots: [0, 1, 2, 3, 4, 5, 6],
      actionName: 'function execute(uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
      actionIndex: 0,
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
