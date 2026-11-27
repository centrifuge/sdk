import { ABIS_V3_2, ABIS_V3_3, GENERATED_ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import {
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  toEventSelector,
  type Abi,
} from 'viem'
import { formatAbiItem } from 'viem/utils'
import { CAST_NEW_CALLDATA, CAST_PREVIEW_CALLDATA } from '../tests/hubPolicyFixtures.js'
import { STD_HUB_POLICY_ABI } from './stdHubPolicy.js'

// The signatures the SDK's hub policy surface calls and decodes, as the protocol declares them (`IHub`, `IHubRegistry`,
// `IStdHubPolicy`, `IStdHubPolicyFactory`). The v3.3 Hub and HubRegistry ABIs come from the address book package; these
// tests fail if a pin bump drops or re-shapes one of them.

function itemOf(abi: Abi, name: string) {
  const item = getAbiItem({ abi, name })
  if (!item) throw new Error(`${name} is missing from the ABI`)
  return item
}

/** The canonical signature, the one a selector or topic hashes: `name(type,type)`. */
const signature = (abi: Abi, name: string) => formatAbiItem(itemOf(abi, name))

/** An event with the indexed flags and names a decoder depends on: `Name(type indexed name, type name)`. */
function eventShape(abi: Abi, name: string) {
  const item = itemOf(abi, name)
  if (item.type !== 'event') throw new Error(`${name} is not an event`)
  const inputs = item.inputs.map((input) => `${input.type}${input.indexed ? ' indexed' : ''} ${input.name}`)
  return `${name}(${inputs.join(', ')})`
}

const outputTypes = (abi: Abi, name: string) => {
  const item = itemOf(abi, name)
  if (item.type !== 'function') throw new Error(`${name} is not a function`)
  return item.outputs.map((output) => output.type)
}

const stateMutability = (abi: Abi, name: string) => {
  const item = itemOf(abi, name)
  return item.type === 'function' ? item.stateMutability : undefined
}

describe('hub policy ABI surface', () => {
  describe('v3.3 Hub', () => {
    for (const expected of [
      'initiateAuthorization(uint64,bytes)',
      'cancelAuthorization(uint64,bytes)',
      'policy(uint64)',
      'multicall(bytes[])',
    ]) {
      it(`declares ${expected}`, () => {
        expect(signature(ABIS_V3_3.Hub, expected.slice(0, expected.indexOf('(')))).to.equal(expected)
      })
    }

    it('reads policy as a view returning the policy address', () => {
      expect(stateMutability(ABIS_V3_3.Hub, 'policy')).to.equal('view')
      expect(outputTypes(ABIS_V3_3.Hub, 'policy')).to.deep.equal(['address'])
    })

    it('declares setPolicy(poolId, policy), the install the policy classifies by escalation', () => {
      expect(signature(ABIS_V3_3.Hub, 'setPolicy')).to.equal('setPolicy(uint64,address)')
      expect(stateMutability(ABIS_V3_3.Hub, 'setPolicy')).to.equal('nonpayable')
      expect(encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'setPolicy', args: [1n, `0x${'11'.repeat(20)}`] }))
        // `cast sig 'setPolicy(uint64,address)'`
        .to.match(/^0x79dda04a/)
    })

    it('is what a v3.2 pool lacks', () => {
      for (const name of ['initiateAuthorization', 'cancelAuthorization', 'policy']) {
        expect(getAbiItem({ abi: ABIS_V3_2.Hub as Abi, name }), name).to.equal(undefined)
      }
    })
  })

  describe('v3.3 HubRegistry', () => {
    it('declares the ledger reads', () => {
      expect(signature(ABIS_V3_3.HubRegistry, 'authorizedAfter')).to.equal('authorizedAfter(bytes32)')
      expect(signature(ABIS_V3_3.HubRegistry, 'authId')).to.equal('authId(uint64,bytes)')
    })

    it('returns the authorization time as uint48 and the id as bytes32', () => {
      expect(outputTypes(ABIS_V3_3.HubRegistry, 'authorizedAfter')).to.deep.equal(['uint48'])
      expect(outputTypes(ABIS_V3_3.HubRegistry, 'authId')).to.deep.equal(['bytes32'])
    })

    it('declares the four policy events the indexer reads', () => {
      expect(eventShape(ABIS_V3_3.HubRegistry, 'SetPolicy')).to.equal(
        'SetPolicy(uint64 indexed poolId, address policy)'
      )
      expect(eventShape(ABIS_V3_3.HubRegistry, 'AuthorizationScheduled')).to.equal(
        'AuthorizationScheduled(uint64 indexed poolId, address indexed caller, bytes32 indexed authId, uint48 validAfter, bytes data)'
      )
      expect(eventShape(ABIS_V3_3.HubRegistry, 'AuthorizationCanceled')).to.equal(
        'AuthorizationCanceled(uint64 indexed poolId, address indexed caller, bytes32 indexed authId)'
      )
      expect(eventShape(ABIS_V3_3.HubRegistry, 'AuthorizationConsumed')).to.equal(
        'AuthorizationConsumed(uint64 indexed poolId, address indexed caller, bytes32 indexed authId)'
      )
    })

    it('declares the four errors a schedule or cancel can revert with', () => {
      for (const name of ['Unauthorized', 'InPolicy', 'PolicyNotInstalled', 'AlreadyAuthorized']) {
        expect(signature(ABIS_V3_3.HubRegistry, name), name).to.equal(`${name}()`)
      }
    })

    it('gives each event its own topic, so a log decodes to one name', () => {
      const names = ['AuthorizationScheduled', 'AuthorizationCanceled', 'AuthorizationConsumed', 'SetPolicy']
      const topics = names.map((name) => {
        const item = itemOf(ABIS_V3_3.HubRegistry, name)
        if (item.type !== 'event') throw new Error(`${name} is not an event`)
        return toEventSelector(item)
      })
      expect(new Set(topics).size).to.equal(names.length)
    })
  })

  describe('StdHubPolicy', () => {
    it('declares authorizationDelay(poolId, caller, data) as a view returning uint48 seconds', () => {
      expect(signature(STD_HUB_POLICY_ABI, 'authorizationDelay')).to.equal('authorizationDelay(uint64,address,bytes)')
      expect(stateMutability(STD_HUB_POLICY_ABI, 'authorizationDelay')).to.equal('view')
      expect(outputTypes(STD_HUB_POLICY_ABI, 'authorizationDelay')).to.deep.equal(['uint48'])
    })

    it('declares delay, expiry and escalation as parameterless uint48 views', () => {
      for (const name of ['delay', 'expiry', 'escalation']) {
        expect(signature(STD_HUB_POLICY_ABI, name), name).to.equal(`${name}()`)
        expect(stateMutability(STD_HUB_POLICY_ABI, name), name).to.equal('view')
        expect(outputTypes(STD_HUB_POLICY_ABI, name), name).to.deep.equal(['uint48'])
      }
    })

    it('declares the four dependencies a policy was built for as parameterless address views', () => {
      for (const name of ['hub', 'hubRegistry', 'multiAdapter', 'shareClassManager']) {
        expect(signature(STD_HUB_POLICY_ABI, name), name).to.equal(`${name}()`)
        expect(stateMutability(STD_HUB_POLICY_ABI, name), name).to.equal('view')
        expect(outputTypes(STD_HUB_POLICY_ABI, name), name).to.deep.equal(['address'])
      }
    })

    it('encodes the dependency views with the selectors foundry computes', () => {
      // `cast sig 'hub()'`, `'hubRegistry()'`, `'multiAdapter()'`, `'shareClassManager()'`
      const selectors = {
        hub: '0x365a86fc',
        hubRegistry: '0xc88854a3',
        multiAdapter: '0xab1632f4',
        shareClassManager: '0x4fd9ff11',
      }
      for (const [functionName, selector] of Object.entries(selectors)) {
        expect(
          encodeFunctionData({ abi: STD_HUB_POLICY_ABI, functionName: functionName as 'hub' }),
          functionName
        ).to.equal(selector)
      }
    })

    it('declares onchainAccounting() as a bool view and simplePriceManager() as an address view', () => {
      expect(signature(STD_HUB_POLICY_ABI, 'onchainAccounting')).to.equal('onchainAccounting()')
      expect(outputTypes(STD_HUB_POLICY_ABI, 'onchainAccounting')).to.deep.equal(['bool'])
      expect(signature(STD_HUB_POLICY_ABI, 'simplePriceManager')).to.equal('simplePriceManager()')
      expect(outputTypes(STD_HUB_POLICY_ABI, 'simplePriceManager')).to.deep.equal(['address'])
      for (const name of ['onchainAccounting', 'simplePriceManager']) {
        expect(stateMutability(STD_HUB_POLICY_ABI, name), name).to.equal('view')
      }
    })

    it('declares the two errors a classification can revert with', () => {
      expect(signature(STD_HUB_POLICY_ABI, 'CallerNotAllowed')).to.equal('CallerNotAllowed()')
      expect(signature(STD_HUB_POLICY_ABI, 'OnchainAccountingOnly')).to.equal('OnchainAccountingOnly()')
    })

    it('encodes with the selectors foundry computes for the protocol signatures', () => {
      // `cast sig 'expiry()'` and `cast sig 'authorizationDelay(uint64,address,bytes)'`
      expect(encodeFunctionData({ abi: STD_HUB_POLICY_ABI, functionName: 'expiry' })).to.equal('0xe184c9be')
      expect(
        encodeFunctionData({
          abi: STD_HUB_POLICY_ABI,
          functionName: 'authorizationDelay',
          args: [1n, '0x0000000000000000000000000000000000000001', '0x'],
        }).slice(0, 10)
      ).to.equal('0xbf47f7ec')
    })

    it('decodes a uint48 answer', () => {
      const data = encodeFunctionResult({ abi: STD_HUB_POLICY_ABI, functionName: 'expiry', result: 604800 })

      expect(decodeFunctionResult({ abi: STD_HUB_POLICY_ABI, functionName: 'expiry', data })).to.equal(604800)
    })
  })

  describe('StdHubPolicyFactory', () => {
    const FACTORY_ABI = ABIS_V3_3.StdHubPolicyFactory

    it('is the address book’s ABI, which deploys the policy this file pins', () => {
      expect(FACTORY_ABI).to.equal(GENERATED_ABIS_V3_3.StdHubPolicyFactory)
    })

    it('has no StdHubPolicy beside it in the book’s set, which is why STD_HUB_POLICY_ABI is a fragment', () => {
      expect(Object.keys(GENERATED_ABIS_V3_3), 'drop STD_HUB_POLICY_ABI for the book’s ABI').to.not.include(
        'StdHubPolicy'
      )
    })

    // `IStdHubPolicy.Config`, in declaration order: the factory's CREATE2 salt is the hash of its encoding, so a
    // reordered or retyped field deploys a different policy than the one previewed.
    const CONFIG =
      '(uint48,uint48,uint48,(uint64,address,bytes4[])[],address,bool,bool,uint128,uint128,uint128,address,address,address,address)'

    const address = (last: string) => `0x${'0'.repeat(38)}${last}` as const
    const config = (
      allowlist: readonly { poolId: bigint; caller: `0x${string}`; selectors: readonly `0x${string}`[] }[]
    ) =>
      ({
        delay: 1,
        expiry: 2,
        escalation: 3,
        allowlist,
        navManager: address('a1'),
        onchainAccounting: true,
        isRestrictionUpdateInstant: false,
        thresholdPerSecond: 4n,
        maxBrmPriceDeviation: 5n,
        maxAbsolutePriceDelta: 6n,
        simplePriceManager: address('a2'),
        requestManager: address('a3'),
        bridgingHook: address('a4'),
        oracleValuation: address('a5'),
      }) as const
    const withEntry = config([{ poolId: 7n, caller: `0x${'11'.repeat(20)}`, selectors: ['0xdeadbeef', '0x12345678'] }])

    it('declares newHubPolicy and previewHubPolicy over the Config struct, field order and types exact', () => {
      expect(signature(FACTORY_ABI, 'newHubPolicy')).to.equal(`newHubPolicy(${CONFIG})`)
      expect(signature(FACTORY_ABI, 'previewHubPolicy')).to.equal(`previewHubPolicy(${CONFIG})`)
    })

    it('answers an address for both, and previews as a view', () => {
      expect(outputTypes(FACTORY_ABI, 'newHubPolicy')).to.deep.equal(['address'])
      expect(outputTypes(FACTORY_ABI, 'previewHubPolicy')).to.deep.equal(['address'])
      expect(stateMutability(FACTORY_ABI, 'previewHubPolicy')).to.equal('view')
      expect(stateMutability(FACTORY_ABI, 'newHubPolicy')).to.equal('nonpayable')
    })

    it('encodes a preview byte for byte as foundry does, allowlist entry included', () => {
      expect(encodeFunctionData({ abi: FACTORY_ABI, functionName: 'previewHubPolicy', args: [withEntry] })).to.equal(
        CAST_PREVIEW_CALLDATA
      )
    })

    it('encodes a deploy byte for byte as foundry does', () => {
      expect(encodeFunctionData({ abi: FACTORY_ABI, functionName: 'newHubPolicy', args: [config([])] })).to.equal(
        CAST_NEW_CALLDATA
      )
    })

    it('declares the DeployHubPolicy event a receipt is read for, with the policy indexed', () => {
      expect(eventShape(FACTORY_ABI, 'DeployHubPolicy')).to.equal('DeployHubPolicy(address indexed policy)')
      // `cast sig-event 'DeployHubPolicy(address)'`
      const item = itemOf(FACTORY_ABI, 'DeployHubPolicy')
      if (item.type !== 'event') throw new Error('not an event')
      expect(toEventSelector(item)).to.equal('0xe4e29fd7e8d8a4f34a1ccbe31b235ea457fbe7d0a8a0ac54061c07b04b5c9ebf')
    })
  })
})
