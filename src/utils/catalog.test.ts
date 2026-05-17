import { expect } from 'chai'
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
      { type: 'runtime', key: 'amount', label: 'Amount', parameter: 'uint256' },
      { type: 'configurable', key: 'configurable:0:1', label: 'Max fee', parameter: 'uint256' },
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
      { type: 'runtime', key: 'amount', label: 'Amount', parameter: 'uint256' },
    ])
  })

  it('rejects empty non-configurable inputs without runtimeVariables metadata', () => {
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

    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw(
      'has 1 empty non-configurable inputs but declares no runtimeVariables'
    )
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
