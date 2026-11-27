import { expect } from 'chai'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { workflowDefinitionHash } from './workflowDefinitionHash.js'

const ROUTER = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

const deposit = (router: string, over: Partial<MarketplaceWorkflow> = {}): MarketplaceWorkflow => {
  const actions = [
    {
      target: '$router',
      selector: 'function deposit(uint256)',
      inputs: [{ parameter: 'uint256', label: 'Amount', input: ['$amount'] }],
    },
  ]
  const variables = [
    { name: 'router', kind: 'pinned' as const },
    { name: 'amount', kind: 'runtime' as const },
  ]
  return {
    workflowRef: 'deposit',
    name: 'Deposit',
    template: 'deposit',
    chainId: 1,
    variables: { router },
    workflowId: `0x${'1'.repeat(64)}`,
    version: 1,
    templates: { deposit: { actions, variables } },
    actions,
    runtimeVariables: ['amount'],
    ...over,
  }
}

describe('workflowDefinitionHash', () => {
  it('is the same for the same definition, whatever its display name or address case', () => {
    expect(workflowDefinitionHash(deposit(ROUTER))).to.equal(
      workflowDefinitionHash(deposit(ROUTER.toUpperCase().replace('0X', '0x'), { name: 'Renamed' }))
    )
  })

  it('changes when a target moves, even under the same workflowId', () => {
    expect(workflowDefinitionHash(deposit(ROUTER))).to.not.equal(workflowDefinitionHash(deposit(OTHER)))
  })

  it('changes when an action calls another function', () => {
    const changed = deposit(ROUTER)
    const actions = [{ ...changed.actions[0]!, selector: 'function withdraw(uint256)' }]
    expect(workflowDefinitionHash(deposit(ROUTER))).to.not.equal(
      workflowDefinitionHash({
        ...changed,
        actions,
        templates: { deposit: { actions, variables: changed.templates!.deposit!.variables } },
      })
    )
  })
})
