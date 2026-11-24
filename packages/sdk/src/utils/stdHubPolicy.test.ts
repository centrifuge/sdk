import { ABIS_V3_2, ABIS_V3_3 } from '@centrifuge/protocol'
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
import { STD_HUB_POLICY_ABI } from './stdHubPolicy.js'

// The signatures the SDK's hub policy surface calls and decodes, as the protocol declares them (`IHub`, `IHubRegistry`,
// `IStdHubPolicy`). The v3.3 Hub and HubRegistry ABIs come from the address book package; these tests fail if a pin
// bump drops or re-shapes one of them.

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
})
