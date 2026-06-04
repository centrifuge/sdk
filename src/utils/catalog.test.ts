import { expect } from 'chai'
import { decodeAbiParameters, toFunctionSelector } from 'viem'
import type { HexString } from '../types/index.js'
import type { CatalogTemplate, CatalogVariable, MarketplaceWorkflow } from '../types/workflow.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'
import { buildScript } from './weiroll.js'

const ADDRESS_A = '0x1111111111111111111111111111111111111111' as const
const ADDRESS_B = '0x2222222222222222222222222222222222222222' as const
const ADDRESS_C = '0x3333333333333333333333333333333333333333' as const
const ADDRESS_D = '0x4444444444444444444444444444444444444444' as const
const ONCHAIN_PM_BYTES32 = '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

// Build a MarketplaceWorkflow in the tagged (explicit-input-kinds) format: the template's
// `variables` declare each variable's kind, and the workflow carries the template registry so
// the builder can read those kinds.
function tagged(
  template: string,
  variables: CatalogVariable[],
  actions: CatalogTemplate['actions'],
  workflowVariables: Record<string, string>,
): MarketplaceWorkflow {
  const templates = { [template]: { actions, variables } }
  return {
    workflowRef: template,
    name: template,
    template,
    chainId: 1,
    variables: workflowVariables,
    workflowId: '0x01',
    version: 1,
    templates,
    actions,
    runtimeVariables: variables.filter((v) => v.kind === 'runtime').map((v) => v.name),
  }
}

describe('utils/catalog', () => {
  it('classifies pinned / runtime / configurable / returns / magic slots from variable kinds', () => {
    const workflow = tagged(
      'deposit',
      [
        { name: 'router', kind: 'pinned' },
        { name: 'maxFee', kind: 'configurable' },
        { name: 'amount', kind: 'runtime' },
      ],
      [
        {
          target: '$router',
          selector: 'function deposit(uint256,uint256)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['$amount'] },
            { parameter: 'uint256', label: 'Max fee', input: ['$maxFee'] },
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
      { router: ADDRESS_A },
    )

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.runtimeVariables).to.deep.equal(['amount'])
    expect(definition.actions[1]!.target).to.deep.equal({ type: 'magic', key: '$onOffRamp' })
    // amount → runtime, maxFee → configurable (keyed by name), sharesReceived → computed runtime,
    // executor → magic.
    expect(definition.state[0]).to.deep.include({ type: 'runtime', key: 'amount', parameter: 'uint256' })
    expect(definition.state[1]).to.deep.include({ type: 'configurable', key: 'maxFee', parameter: 'uint256' })
    expect(definition.state[2]).to.deep.include({ type: 'runtime', key: 'sharesReceived' })
    expect(definition.state[3]).to.deep.equal({ type: 'magic', key: '$executor' })
  })

  it('throws on an empty input array that is not a useTemplate', () => {
    const workflow = tagged(
      'bad-empty',
      [{ name: 'router', kind: 'pinned' }],
      [
        {
          target: '$router',
          selector: 'function deposit(uint256)',
          inputs: [{ parameter: 'uint256', label: 'Amount', input: [] }],
        },
      ],
      { router: ADDRESS_A },
    )
    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw('has an empty input')
  })

  it('throws when a pinned variable has no value in workflow.variables', () => {
    const workflow = tagged(
      'missing-pinned',
      [{ name: 'router', kind: 'pinned' }],
      [
        {
          target: '$router',
          selector: 'function poke(address)',
          inputs: [{ parameter: 'address', label: 'Router', input: ['$router'] }],
        },
      ],
      {}, // router not provided
    )
    expect(() => buildWorkflowDefinitionFromCatalog(workflow)).to.throw('pinned variable "router" has no value')
  })

  it('uses FLAG_RAW for non-variable-length dynamic types (tuple arrays) sourced from a configurable', () => {
    const selector = toFunctionSelector('function open(uint64,bytes16,(address,uint256)[])')
    const workflow = tagged(
      'slippage-open',
      [
        { name: 'guard', kind: 'pinned' },
        { name: 'slippageAssets', kind: 'configurable' },
      ],
      [
        {
          target: '$guard',
          selector: 'function open(uint64,bytes16,(address,uint256)[])',
          inputs: [
            { parameter: 'uint64', label: 'Pool ID', input: ['$poolId'] },
            { parameter: 'bytes16', label: 'SC ID', input: ['$scId'] },
            { parameter: '(address,uint256)[]', label: 'Assets', input: ['$slippageAssets'] },
          ],
        },
      ],
      { guard: ADDRESS_A },
    )

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]).to.deep.include({ target: ADDRESS_A, selector })
    expect(definition.actions[0]!.rawMode).to.equal(true)
    expect(definition.actions[0]!.inputs).to.deep.equal([3])
    expect(definition.state[2]).to.deep.include({ type: 'configurable', key: 'slippageAssets', parameter: '(address,uint256)[]' })
    expect(definition.state[3]).to.deep.equal({
      type: 'rawcalldata',
      selector,
      parameterTypes: ['uint64', 'bytes16', '(address,uint256)[]'],
      sourceSlots: [0, 1, 2],
      actionName: 'function open(uint64,bytes16,(address,uint256)[])',
      actionIndex: 0,
    })
  })

  it('encodes a pinned bytes literal in the inner ABI form via the 0x80 specifier (no FLAG_RAW)', () => {
    const hookData = '0x636374702d686f6f6b2d646174612d30303030303030303030303030303031' as const
    const workflow = tagged(
      'cctp_send_auto',
      [
        { name: 'messenger', kind: 'pinned' },
        { name: 'hookData', kind: 'pinned' },
      ],
      [
        {
          target: '$messenger',
          selector: 'function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['100'] },
            { parameter: 'uint32', label: 'Destination domain', input: ['0'] },
            { parameter: 'bytes32', label: 'Mint recipient', input: ['0x0000000000000000000000002222222222222222222222222222222222222222'] },
            { parameter: 'address', label: 'Burn token', input: [ADDRESS_B] },
            { parameter: 'bytes32', label: 'Destination caller', input: ['0x0000000000000000000000001111111111111111111111111111111111111111'] },
            { parameter: 'uint256', label: 'Max fee', input: ['0'] },
            { parameter: 'uint32', label: 'Min finality threshold', input: ['1000'] },
            { parameter: 'bytes', label: 'Hook data', input: ['$hookData'] },
          ],
        },
      ],
      { messenger: ADDRESS_A, hookData },
    )

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    // Inner ABI form: 31-byte value → length 0x1f + 32-byte padded data.
    expect(definition.state[5]).to.deep.equal({
      type: 'literal',
      value:
        '0x000000000000000000000000000000000000000000000000000000000000001f636374702d686f6f6b2d646174612d3030303030303030303030303030303100',
    })
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 1, 2, 2, 3, 1, 4, 0x80 | 5])
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)
  })

  it('encodes a configurable bytes parameter as its own slot via the 0x80 specifier (no FLAG_RAW)', () => {
    const workflow = tagged(
      'cctp_send_auto',
      [
        { name: 'messenger', kind: 'pinned' },
        { name: 'hookData', kind: 'configurable' },
        { name: 'amount', kind: 'runtime' },
      ],
      [
        {
          target: '$messenger',
          selector: 'function depositForBurnWithHook(uint256,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['$amount'] },
            { parameter: 'bytes', label: 'Hook data', input: ['$hookData'] },
          ],
        },
      ],
      { messenger: ADDRESS_A },
    )

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(definition.state[0]).to.deep.include({ type: 'runtime', key: 'amount' })
    expect(definition.state[1]).to.deep.include({ type: 'configurable', key: 'hookData', parameter: 'bytes' })
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 0x80 | 1])
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)
  })

  it('encodes a runtime bytes argument via the 0x80 specifier, not FLAG_RAW (selector pinned)', () => {
    // A runtime bytes argument keeps the call's selector in the (hashed) command word — the
    // strategist varies only the argument, never the function (audit #18 / SECURITY.md §11).
    const workflow = tagged(
      'runtime-bytes',
      [
        { name: 'target', kind: 'pinned' },
        { name: 'amount', kind: 'runtime' },
        { name: 'payload', kind: 'runtime' },
      ],
      [
        {
          target: '$target',
          selector: 'function call(uint256,bytes)',
          inputs: [
            { parameter: 'uint256', label: 'Amount', input: ['$amount'] },
            { parameter: 'bytes', label: 'Payload', input: ['$payload'] },
          ],
        },
      ],
      { target: ADDRESS_A },
    )

    const definition = buildWorkflowDefinitionFromCatalog(workflow)

    expect(definition.actions[0]!.rawMode).to.equal(undefined)
    expect(definition.actions[0]!.inputs).to.deep.equal([0, 0x80 | 1])
    expect(definition.state.every((s) => s.type !== 'rawcalldata')).to.equal(true)
    expect(definition.state[1]).to.deep.include({ type: 'runtime', key: 'payload', parameter: 'bytes' })
  })

  it('injects useTemplate bytes inputs as pinned callback script data', () => {
    const callbackVariables: CatalogVariable[] = [
      { name: 'data', kind: 'configurable' },
      { name: 'asset', kind: 'param' },
      { name: 'vault', kind: 'param' },
    ]
    const workflow: MarketplaceWorkflow = {
      workflowRef: 'morpho-loop',
      name: 'Morpho loop',
      template: 'morpho_loop_deposit',
      chainId: 1,
      variables: { flashLoanHelper: ADDRESS_A, pool: ADDRESS_B, asset: ADDRESS_C, vault: ADDRESS_D },
      workflowId: '0x01',
      version: 1,
      runtimeVariables: ['amount'],
      templates: {
        morpho_loop_deposit: {
          variables: [
            { name: 'flashLoanHelper', kind: 'pinned' },
            { name: 'pool', kind: 'pinned' },
            { name: 'asset', kind: 'pinned' },
            { name: 'vault', kind: 'pinned' },
            { name: 'amount', kind: 'runtime' },
          ],
          actions: [],
        },
        morpho_loop_deposit_callback: {
          variables: callbackVariables,
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
                { parameter: 'bytes', label: 'Data', input: ['$data'] },
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
            { parameter: 'uint256', label: 'Amount', input: ['$amount'] },
            { parameter: 'address', label: 'OnchainPM', input: ['$onchainPM'] },
            {
              parameter: 'bytes',
              label: 'Callback data',
              input: [],
              useTemplate: { template: 'morpho_loop_deposit_callback', map: { asset: '$asset', vault: '$vault' } },
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
    expect(definition.state[callbackSlot]).to.deep.include({ type: 'template', label: 'Callback data', actionIndex: 0, inputIndex: 4 })
    const templateSlot = definition.state[callbackSlot]
    if (!templateSlot || templateSlot.type !== 'template') throw new Error('Expected callback slot to be a template slot')
    expect(templateSlot.workflow.actions[2]!.rawMode).to.equal(undefined)
    expect(definition.runtimeVariables).to.deep.equal(['amount'])

    const { state, stateBitmap } = buildScript(definition, {
      poolContext: { $onchainPM: ONCHAIN_PM_BYTES32 },
      // The callback's `data` is configurable — supply an empty value (encoded as length-0 bytes).
      configurableValues: { data: `0x${'00'.repeat(32)}` },
    })
    expect((stateBitmap & (1n << BigInt(callbackSlot))) !== 0n).to.equal(true)

    // weiroll copies state[idx] verbatim into the parent's calldata at the bytes-input offset
    // (no length-prefix word), so state[callbackSlot] is [length][abi-encoded callback].
    const callbackSlotData = state[callbackSlot]!
    const callbackBytes = `0x${callbackSlotData.slice(2 + 64)}` as HexString
    const declaredLength = Number(BigInt(`0x${callbackSlotData.slice(2, 2 + 64)}`))
    expect(declaredLength).to.equal((callbackBytes.length - 2) / 2)
    const [commands, callbackState, callbackStateBitmap] = decodeAbiParameters(
      [{ type: 'bytes32[]' }, { type: 'bytes[]' }, { type: 'uint128' }],
      callbackBytes,
    )
    expect(Array.isArray(commands)).to.equal(true)
    expect(Array.isArray(callbackState)).to.equal(true)
    expect(typeof callbackStateBitmap).to.equal('bigint')
  })
})
