import { expect } from 'chai'
import type { CatalogAction, CatalogTemplate } from '../types/workflow.js'
import {
  checkActionSelectorSchema,
  checkNoDeclaredRawMode,
  checkNoForwardReferences,
  checkReturnsDoNotShadow,
  checkDuplicateWorkflowIds,
  checkRawCalldataTaint,
  checkTemplateIsNotUseOnly,
  checkWorkflowVariableKinds,
  parseSelectorParameters,
  validateCatalogWorkflow,
} from './workflowRules.js'

const action = (partial: Partial<CatalogAction>): CatalogAction => ({
  target: '$router',
  selector: 'function noop()',
  inputs: [],
  ...partial,
})

const rules = (violations: { rule: string }[]) => violations.map((v) => v.rule)

describe('utils/workflowRules', () => {
  describe('parseSelectorParameters', () => {
    it('lists a flat parameter list in order', () => {
      expect(parseSelectorParameters('function deposit(uint256,address)')).to.deep.equal(['uint256', 'address'])
    })

    it('flattens a tuple struct into its leaves', () => {
      // Template convention: `function f((a,b),c)` takes three inputs, not two.
      expect(parseSelectorParameters('function f((uint256,address),bytes32)')).to.deep.equal([
        'uint256',
        'address',
        'bytes32',
      ])
    })

    it('keeps a tuple array atomic', () => {
      expect(parseSelectorParameters('function open(uint64,bytes16,(address,uint256)[])')).to.deep.equal([
        'uint64',
        'bytes16',
        '(address,uint256)[]',
      ])
    })

    it('handles a nested tuple', () => {
      expect(parseSelectorParameters('function f((uint256,(address,bool)))')).to.deep.equal([
        'uint256',
        'address',
        'bool',
      ])
    })

    it('returns an empty list for a no-argument selector', () => {
      expect(parseSelectorParameters('function poke()')).to.deep.equal([])
    })

    it('returns null for a malformed selector', () => {
      expect(parseSelectorParameters('function broken(uint256')).to.equal(null)
      expect(parseSelectorParameters('not a function')).to.equal(null)
    })
  })

  describe('checkActionSelectorSchema', () => {
    it('accepts inputs matching the selector', () => {
      const violations = checkActionSelectorSchema(
        action({
          selector: 'function deposit(uint256,address)',
          inputs: [
            { parameter: 'uint256', input: ['$amount'] },
            { parameter: 'address', input: ['$receiver'] },
          ],
        }),
        'a'
      )
      expect(violations).to.deep.equal([])
    })

    it('rejects an extra visible input the selector never consumes', () => {
      // A "Max slippage" field a manager reviews as a constraint, absent from the executed call.
      const violations = checkActionSelectorSchema(
        action({
          selector: 'function deposit(uint256,address)',
          inputs: [
            { parameter: 'uint256', input: ['$amount'] },
            { parameter: 'address', input: ['$receiver'] },
            { parameter: 'uint256', label: 'Max slippage', input: ['$maxSlippage'] },
          ],
        }),
        'a'
      )
      expect(rules(violations)).to.deep.equal(['selector-arity'])
    })

    it('rejects inputs whose types disagree with the selector', () => {
      const violations = checkActionSelectorSchema(
        action({
          selector: 'function transfer(address,uint256)',
          inputs: [
            { parameter: 'uint256', input: ['$amount'] },
            { parameter: 'address', input: ['$recipient'] },
          ],
        }),
        'a'
      )
      expect(rules(violations)).to.deep.equal(['selector-parameter-type', 'selector-parameter-type'])
    })

    it('rejects a selector that is not human-readable', () => {
      expect(rules(checkActionSelectorSchema(action({ selector: '0xdeadbeef' }), 'a'))).to.deep.equal([
        'selector-format',
      ])
    })
  })

  describe('checkRawCalldataTaint', () => {
    const flashLoan = (inputs: CatalogAction['inputs']) =>
      ({
        id: 'flash',
        variables: [
          { name: 'pool', kind: 'pinned' as const },
          { name: 'callbackData', kind: 'runtime' as const },
          { name: 'amount', kind: 'runtime' as const },
        ],
        actions: [action({ selector: 'function requestFlashLoan(address,uint256,bytes)', inputs })],
      }) as CatalogTemplate & { id: string }

    it('rejects a runtime variable reaching a bytes payload', () => {
      const violations = checkRawCalldataTaint(
        flashLoan([
          { parameter: 'address', input: ['$pool'] },
          { parameter: 'uint256', input: ['$amount'] },
          { parameter: 'bytes', input: ['$callbackData'] },
        ]),
        { describe: () => 'a' }
      )
      expect(rules(violations)).to.deep.equal(['raw-calldata-taint'])
    })

    it('follows taint laundered through an intermediate returns', () => {
      const template = {
        id: 'launder',
        variables: [
          { name: 'helper', kind: 'pinned' as const },
          { name: 'attackerValue', kind: 'runtime' as const },
        ],
        actions: [
          action({
            selector: 'function encode(uint256)',
            inputs: [{ parameter: 'uint256', input: ['$attackerValue'] }],
            returns: '$encoded',
          }),
          action({
            selector: 'function execute(bytes)',
            inputs: [{ parameter: 'bytes', input: ['$encoded'] }],
          }),
        ],
      } as CatalogTemplate & { id: string }

      expect(rules(checkRawCalldataTaint(template, { describe: () => 'a' }))).to.deep.equal(['raw-calldata-taint'])
    })

    it('accepts a bytes payload built only from pinned values', () => {
      const violations = checkRawCalldataTaint(
        flashLoan([
          { parameter: 'address', input: ['$pool'] },
          { parameter: 'uint256', input: ['$amount'] },
          { parameter: 'bytes', input: ['0x00'] },
        ]),
        { describe: () => 'a' }
      )
      expect(violations).to.deep.equal([])
    })

    it('honours runtimeBytesAck for a target that validates the content', () => {
      const violations = checkRawCalldataTaint(
        flashLoan([
          { parameter: 'address', input: ['$pool'] },
          { parameter: 'uint256', input: ['$amount'] },
          { parameter: 'bytes', input: ['$callbackData'], runtimeBytesAck: 'CCTP attestation, verified on-chain' },
        ]),
        { describe: () => 'a' }
      )
      expect(violations).to.deep.equal([])
    })

    it('crosses a use boundary when the caller supplies a resolver', () => {
      // The authoring shape: taint enters a helper through its use.map binding.
      const helper = {
        id: 'helper',
        variables: [{ name: 'payload', kind: 'param' as const }],
        actions: [
          action({ selector: 'function forward(bytes)', inputs: [{ parameter: 'bytes', input: ['$payload'] }] }),
        ],
      } as CatalogTemplate & { id: string }

      const parent = {
        id: 'parent',
        variables: [{ name: 'attackerValue', kind: 'runtime' as const }],
        actions: [{ use: 'helper', map: { payload: '$attackerValue' } }],
      } as unknown as CatalogTemplate & { id: string }

      const violations = checkRawCalldataTaint(parent, {
        describe: () => 'a',
        resolveUse: (entry: any) =>
          entry?.use ? { template: helper, map: entry.map ?? {}, returns: entry.returns } : null,
      })
      expect(rules(violations)).to.deep.equal(['raw-calldata-taint'])
    })
  })

  describe('template action rules', () => {
    const withActions = (variables: CatalogTemplate['variables'], actions: CatalogAction[]) =>
      ({ id: 't', variables, actions }) as CatalogTemplate & { id: string }

    it('rejects a return that shadows a declared configurable variable', () => {
      // The output and the manager-pinned slot would share one weiroll index: the proof is
      // built over the configured pre-state, then execution overwrites it before it is read.
      const template = withActions(
        [
          { name: 'router', kind: 'pinned' },
          { name: 'minOut', kind: 'configurable' },
        ],
        [action({ selector: 'function quote(uint256)', returns: '$minOut' })]
      )
      expect(rules(checkReturnsDoNotShadow(template, (i) => `action ${i}`))).to.deep.equal(['returns-shadows-variable'])
    })

    it('rejects a return that shadows a declared runtime variable', () => {
      const template = withActions(
        [{ name: 'amount', kind: 'runtime' }],
        [action({ selector: 'function quote(uint256)', returns: '$amount' })]
      )
      expect(rules(checkReturnsDoNotShadow(template, (i) => `action ${i}`))).to.deep.equal(['returns-shadows-variable'])
    })

    it('allows a return name that shadows nothing', () => {
      const template = withActions(
        [{ name: 'router', kind: 'pinned' }],
        [action({ selector: 'function quote(uint256)', returns: '$shares' })]
      )
      expect(checkReturnsDoNotShadow(template, (i) => `action ${i}`)).to.deep.equal([])
    })

    it('rejects a forward reference to a value returned by a later action', () => {
      // Compiles to a slot neither hashed nor listed in runtimeVariables — invisible in
      // review, still fillable by anyone assembling the execute calldata directly.
      const template = withActions(
        [],
        [
          action({
            selector: 'function send(address)',
            inputs: [{ parameter: 'address', input: ['$recipient'] }],
          }),
          action({ selector: 'function resolve()', returns: '$recipient' }),
        ]
      )
      expect(rules(checkNoForwardReferences(template, (a, i) => `action ${a} input ${i}`))).to.deep.equal([
        'forward-reference',
      ])
    })

    it('allows a backward reference to an earlier return', () => {
      const template = withActions(
        [],
        [
          action({ selector: 'function resolve()', returns: '$recipient' }),
          action({
            selector: 'function send(address)',
            inputs: [{ parameter: 'address', input: ['$recipient'] }],
          }),
        ]
      )
      expect(checkNoForwardReferences(template, (a, i) => `action ${a} input ${i}`)).to.deep.equal([])
    })

    it("rejects an action that reads its own action's return", () => {
      const template = withActions(
        [],
        [
          action({
            selector: 'function f(uint256)',
            inputs: [{ parameter: 'uint256', input: ['$self'] }],
            returns: '$self',
          }),
        ]
      )
      expect(rules(checkNoForwardReferences(template, (a, i) => `action ${a} input ${i}`))).to.deep.equal([
        'forward-reference',
      ])
    })

    it('rejects a catalog-declared rawMode', () => {
      // `rawMode` is not in CatalogAction — that is the point of the rule — so it has to be
      // attached the way a hostile catalog would, as an extra JSON field.
      const rogue = { ...action({ selector: 'function ping()' }), rawMode: true }
      const template = withActions([], [rogue as CatalogAction])
      expect(rules(checkNoDeclaredRawMode(template, (i) => `action ${i}`))).to.deep.equal(['declared-raw-mode'])
    })
  })

  describe('workflow-level rules', () => {
    const erc20Approve: CatalogTemplate = {
      id: 'erc20_approve',
      variables: [
        { name: 'token', kind: 'pinned' },
        { name: 'spender', kind: 'param' },
        { name: 'amount', kind: 'param' },
      ],
      actions: [],
    }

    it('rejects a top-level workflow backed by a param helper template', () => {
      const violations = checkTemplateIsNotUseOnly(
        { id: 'sneaky_approve', template: 'erc20_approve', variables: { token: '0x00' } },
        erc20Approve
      )
      expect(rules(violations)).to.deep.equal(['param-template-use-only'])
    })

    const deposit: CatalogTemplate = {
      id: 'deposit',
      variables: [
        { name: 'router', kind: 'pinned' },
        { name: 'maxFee', kind: 'configurable' },
        { name: 'amount', kind: 'runtime' },
      ],
      actions: [],
    }

    it('accepts a workflow filling only pinned variables', () => {
      expect(
        checkWorkflowVariableKinds({ id: 'a', template: 'deposit', variables: { router: '0x00' } }, deposit)
      ).to.deep.equal([])
    })

    it('rejects a workflow pinning a configurable variable', () => {
      const violations = checkWorkflowVariableKinds(
        { id: 'a', template: 'deposit', variables: { router: '0x00', maxFee: '1' } },
        deposit
      )
      expect(rules(violations)).to.deep.equal(['workflow-overrides-variable'])
    })

    it('rejects a workflow pinning a runtime variable', () => {
      const violations = checkWorkflowVariableKinds(
        { id: 'a', template: 'deposit', variables: { router: '0x00', amount: '1' } },
        deposit
      )
      expect(rules(violations)).to.deep.equal(['workflow-overrides-variable'])
    })

    it('rejects an undeclared variable but allows a magic one', () => {
      expect(
        rules(
          checkWorkflowVariableKinds(
            { id: 'a', template: 'deposit', variables: { router: '0x00', bogus: '1' } },
            deposit
          )
        )
      ).to.deep.equal(['undeclared-workflow-variable'])
      expect(
        checkWorkflowVariableKinds(
          { id: 'a', template: 'deposit', variables: { router: '0x00', poolId: '1' } },
          deposit
        )
      ).to.deep.equal([])
    })

    it('reports a missing pinned variable', () => {
      expect(rules(checkWorkflowVariableKinds({ id: 'a', template: 'deposit', variables: {} }, deposit))).to.deep.equal(
        ['missing-pinned-variable']
      )
    })
  })

  describe('checkDuplicateWorkflowIds', () => {
    it('rejects a repeated id', () => {
      expect(rules(checkDuplicateWorkflowIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }]))).to.deep.equal([
        'duplicate-workflow-id',
      ])
    })

    it('ignores callback entries, which are not addressable by id', () => {
      expect(checkDuplicateWorkflowIds([{ id: 'a' }, { id: 'a', useTemplate: {} }])).to.deep.equal([])
    })
  })

  describe('validateCatalogWorkflow', () => {
    it('reports nothing for a well-formed workflow', () => {
      const templates: Record<string, CatalogTemplate> = {
        deposit: {
          id: 'deposit',
          variables: [
            { name: 'router', kind: 'pinned' },
            { name: 'amount', kind: 'runtime' },
          ],
          actions: [
            action({
              name: 'Deposit',
              selector: 'function deposit(uint256,address)',
              inputs: [
                { parameter: 'uint256', input: ['$amount'] },
                { parameter: 'address', input: ['$router'] },
              ],
            }),
          ],
        },
      }

      expect(
        validateCatalogWorkflow({ id: 'a', template: 'deposit', variables: { router: '0x00' } }, templates)
      ).to.deep.equal([])
    })
  })
})
