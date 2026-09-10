import { expect } from 'chai'
import type { CatalogAction, CatalogTemplate } from '../types/workflow.js'
import {
  checkActionSelectorSchema,
  checkAddressLiterals,
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

      // A real address, not the `0x00` placeholder the kind-only fixtures use: this workflow is
      // now checked for address-shaped pinned values too.
      expect(
        validateCatalogWorkflow(
          { id: 'a', template: 'deposit', variables: { router: '0x1111111111111111111111111111111111111111' } },
          templates
        )
      ).to.deep.equal([])
    })

    it('reports a pinned value that is not an address wired into an address slot', () => {
      // The workflows repo caught this offline over its own files; now every ingested catalog is
      // checked. A token id or amount in an address slot encodes as a different account.
      const templates: Record<string, CatalogTemplate> = {
        deposit: {
          id: 'deposit',
          variables: [{ name: 'router', kind: 'pinned' }],
          actions: [
            action({
              name: 'Deposit',
              selector: 'function deposit(address)',
              inputs: [{ parameter: 'address', input: ['$router'] }],
            }),
          ],
        },
      }

      const violations = validateCatalogWorkflow(
        { id: 'a', template: 'deposit', variables: { router: '1' } },
        templates
      )
      expect(violations.map((violation) => violation.rule)).to.include('address-literal')
    })

    it('validates a callback template reached only through useTemplate', () => {
      // 59 of 77 published mainnet templates are reachable only this way, and a callback compiles
      // into the workflow's hashed script — so leaving them unchecked exempted the material the
      // review surface already hides.
      const templates: Record<string, CatalogTemplate> = {
        outer: {
          id: 'outer',
          variables: [{ name: 'target', kind: 'pinned' }],
          actions: [
            action({
              name: 'Flash',
              selector: 'function flash(bytes)',
              inputs: [{ parameter: 'bytes', input: [], useTemplate: { template: 'callback', map: {} } }],
            }),
          ],
        },
        callback: {
          id: 'callback',
          variables: [{ name: 'venue', kind: 'param' }],
          actions: [
            // Arity mismatch: two declared parameters, one input.
            action({
              name: 'Swap',
              selector: 'function swap(uint256,address)',
              inputs: [{ parameter: 'uint256', input: ['$amount'] }],
            }),
          ],
        },
      }

      const violations = validateCatalogWorkflow(
        { id: 'a', template: 'outer', variables: { target: '0x1111111111111111111111111111111111111111' } },
        templates
      )
      expect(violations.map((violation) => violation.rule)).to.include('selector-arity')
    })
  })

  describe('checkAddressLiterals', () => {
    const action = (parameter: string, value: unknown) => ({
      name: 'Act',
      selector: `function f(${parameter})`,
      inputs: [{ parameter, label: 'Receiver', input: value === undefined ? [] : [value] }],
    })

    it('accepts a 20-byte address literal', () => {
      expect(checkAddressLiterals(action('address', '0x1111111111111111111111111111111111111111'), 'a')).to.deep.equal(
        []
      )
    })

    it('accepts a left-padded 32-byte word carrying an address', () => {
      expect(checkAddressLiterals(action('address', `0x${'0'.repeat(24)}${'1'.repeat(40)}`), 'a')).to.deep.equal([])
    })

    it('rejects a malformed address literal', () => {
      // Pinned at publish time and never checked against the ABI, so a short or mis-shaped literal
      // encodes as a different account than the catalog appears to name.
      const short = checkAddressLiterals(action('address', '0xdead'), 'a')
      expect(short).to.have.length(1)
      expect(short[0]!.rule).to.equal('address-literal')
      expect(checkAddressLiterals(action('address', '12345'), 'a')).to.have.length(1)
      // A 32-byte word whose high bytes are not zero is not a padded address.
      expect(checkAddressLiterals(action('address', `0x${'1'.repeat(64)}`), 'a')).to.have.length(1)
    })

    it('leaves $references alone', () => {
      // Their values arrive per workflow, per policy or per execution, and the encoder rejects a
      // non-address there. Only literals are decidable from the template.
      expect(checkAddressLiterals(action('address', '$receiver'), 'a')).to.deep.equal([])
      expect(checkAddressLiterals(action('address', undefined), 'a')).to.deep.equal([])
    })

    it('covers the sized and unsized array forms of the parameter', () => {
      // Matches the ported semantics: `address`, `address[]`, `address[N]`.
      expect(checkAddressLiterals(action('address[]', '0xdead'), 'a')).to.have.length(1)
      expect(checkAddressLiterals(action('address[3]', '0xdead'), 'a')).to.have.length(1)
      expect(checkAddressLiterals(action(' address ', '0xdead'), 'a')).to.have.length(1)
    })

    it('ignores non-address parameters', () => {
      expect(checkAddressLiterals(action('uint256', '12345'), 'a')).to.deep.equal([])
      expect(checkAddressLiterals(action('bytes32', '0xdead'), 'a')).to.deep.equal([])
    })
  })

  describe('dynamic tuple arity', () => {
    // The rule and the encoder used to accept disjoint declarations for a dynamic tuple:
    // this demanded one input per leaf, `encodeInputSpecifier` emitted one 0x80 slot. A
    // template could pass validation or produce the right calldata, never both
    // (centrifuge/workflows#105). These pin the agreement in both directions.
    const MIDNIGHT_MARKET =
      '(uint256,address,address,(address,uint256,uint256,address)[],uint256,uint256,address,address)'
    const MIDNIGHT_OFFER = `(${MIDNIGHT_MARKET},bool,address,uint256,uint256,uint256,bytes32,address,bytes,address,address,bool,uint128,uint128,uint256)`

    it('counts a dynamic tuple as one input', () => {
      expect(parseSelectorParameters('function f((address,bytes))')).to.deep.equal(['(address,bytes)'])
      expect(parseSelectorParameters('function f((uint256,string))')).to.deep.equal(['(uint256,string)'])
    })

    it('still flattens a static tuple, one input per leaf', () => {
      expect(parseSelectorParameters('function g((address,uint256))')).to.deep.equal(['address', 'uint256'])
      // Nested static tuples flatten all the way down.
      expect(parseSelectorParameters('function g(((address,uint256),bool))')).to.deep.equal([
        'address',
        'uint256',
        'bool',
      ])
    })

    it('keeps a static tuple atomic once it contains a dynamic member', () => {
      // The outer tuple is dynamic because the inner one is, so neither flattens.
      expect(parseSelectorParameters('function g(((address,bytes),uint256))')).to.deep.equal([
        '((address,bytes),uint256)',
      ])
    })

    it('leaves arrays atomic, as before', () => {
      expect(parseSelectorParameters('function h((address,uint256)[])')).to.deep.equal(['(address,uint256)[]'])
      expect(parseSelectorParameters('function h(uint256[])')).to.deep.equal(['uint256[]'])
    })

    it('accepts the Midnight.take declaration the encoder actually emits', () => {
      const selector = `function take(${MIDNIGHT_OFFER},bytes,uint256,address,address,address,bytes)`
      const parameters = parseSelectorParameters(selector)
      expect(parameters, 'take should be 7 inputs, not 28').to.have.length(7)
      expect(parameters![0]).to.equal(MIDNIGHT_OFFER)

      const violations = checkActionSelectorSchema(
        { name: 'take', selector, inputs: parameters!.map((parameter) => ({ parameter })) },
        'action "take"'
      )
      expect(violations).to.deep.equal([])
    })

    it('rejects the flattened declaration that used to be the only one accepted', () => {
      const violations = checkActionSelectorSchema(
        {
          name: 'f',
          selector: 'function f((address,bytes))',
          inputs: [{ parameter: 'address' }, { parameter: 'bytes' }],
        },
        'action "f"'
      )
      expect(violations).to.have.length(1)
      expect(violations[0]!.rule).to.equal('selector-arity')
    })
  })

  describe('raw-calldata taint reaches nested bytes', () => {
    // The rule tested `parameter === 'bytes'`, so it read the type only at the top level.
    // A dynamic tuple embedding `bytes` was never inspected: a fully strategist-controlled
    // Midnight `Offer` — carrying `maker`, `tick`, `callback` and the `callbackData` handed
    // to `ISellCallback(offer.callback).onSell(...)` — validated with no error at all
    // (centrifuge/workflows#107). Latent while a dynamic tuple could not be declared;
    // reachable once #537 fixed the arity rule.
    const MARKET = '(uint256,address,address,(address,uint256,uint256,address)[],uint256,uint256,address,address)'
    const OFFER = `(${MARKET},bool,address,uint256,uint256,uint256,bytes32,address,bytes,address,address,bool,uint128,uint128,uint256)`

    const taintOn = (parameter: string, kind: 'runtime' | 'configurable' = 'runtime') =>
      checkRawCalldataTaint(
        {
          id: 'p',
          variables: [
            { name: 'target', kind: 'pinned' },
            { name: 'payload', kind },
          ] as CatalogTemplate['variables'],
          actions: [
            {
              target: '$target',
              name: 'act',
              selector: `function act(${parameter})`,
              inputs: [{ parameter, label: 'Payload', input: ['$payload'] }],
            },
          ] as CatalogAction[],
        },
        { describe: (action) => `action "${action.name}"` }
      )

    it('flags a runtime dynamic tuple that embeds bytes', () => {
      expect(taintOn('(address,bytes)')).to.have.length(1)
      expect(taintOn('(address,bytes)')[0]!.rule).to.equal('raw-calldata-taint')
    })

    it("flags Midnight's Offer, where the bytes is four levels in", () => {
      const violations = taintOn(OFFER)
      expect(violations).to.have.length(1)
      // The message names the carrier, so a reviewer can see why a non-bytes input was hit.
      expect(violations[0]!.message).to.contain('carried by')
    })

    it('flags an array of tuples embedding bytes', () => {
      expect(taintOn('(address,bytes)[]')).to.have.length(1)
    })

    it('still flags a plain runtime bytes, without the carrier clause', () => {
      const violations = taintOn('bytes')
      expect(violations).to.have.length(1)
      expect(violations[0]!.message).to.not.contain('carried by')
    })

    it('does not flag aggregates with no bytes inside', () => {
      // The guard shapes in the published catalog, which must stay clean.
      expect(taintOn('(address,uint256)[]')).to.deep.equal([])
      expect(taintOn('(address,address)[]')).to.deep.equal([])
      expect(taintOn('(address,uint256)')).to.deep.equal([])
      expect(taintOn('uint256[]')).to.deep.equal([])
    })

    it('does not flag string, which is not re-entered as a call', () => {
      expect(taintOn('string')).to.deep.equal([])
    })

    it('does not flag a hub-manager-set value, whatever its shape', () => {
      expect(taintOn(OFFER, 'configurable')).to.deep.equal([])
    })

    it('assumes the hazard for an unparseable type rather than waving it through', () => {
      expect(taintOn('(not a type)')).to.have.length(1)
    })
  })
})
