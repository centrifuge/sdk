import { ABIS_V3_3, builders, encodeBatchRequestManagerPayload } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { decodeFunctionData, encodeFunctionData } from 'viem'
import { HUB_ACTIONS } from '../tests/hubActions.js'
import { ctx, HUB, pool33Id, scId33, setupV33, signer, SPOKE, spokeAssetId, who } from '../tests/hubGroup.js'
import type { HexString } from '../types/index.js'
import type { BuiltTransaction } from '../types/transaction.js'
import { MessageType, MessageTypeV3_3, messageV3_3 } from '../types/transaction.js'
import { deriveHubCallMessages, parseHubCall } from './hubCallMessages.js'
import { addressToBytes32 } from './index.js'
import { mergeMessages } from './transaction.js'

// The oracle for a call's messages is the entity that builds it: the messages derived from every call of a `buildOnly`
// build, merged per destination in call order, must equal the `messages` of that build.

const scope = { poolId: pool33Id, batchRequestManager: ctx(pool33Id, '3.3').addresses.batchRequestManager! }
const functionsOf = (built: BuiltTransaction) =>
  built.calls.map((call) => decodeFunctionData({ abi: ABIS_V3_3.Hub, data: call.data }).functionName as string)
const messagesOf = (data: HexString) => deriveHubCallMessages(parseHubCall(data, pool33Id), scope)
const derived = (built: BuiltTransaction) => mergeMessages(built.calls.map((call) => messagesOf(call.data)))

const scenarios = HUB_ACTIONS.filter((action) => !action.skipMessages).map((action) => ({
  name: action.name,
  covers: action.covers,
  async build(): Promise<BuiltTransaction> {
    const { centrifuge, build } = setupV33(action.reads, action.contracts)
    return build(action.setup(centrifuge).write())
  },
}))

describe('hubCallMessages', () => {
  afterEach(() => sinon.restore())

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      it(`builds ${scenario.covers.join(', ')}`, async () => {
        const built = await scenario.build()
        expect(functionsOf(built)).to.include.members(scenario.covers)
      })

      it('derives the messages the entity declares for the whole build', async () => {
        const built = await scenario.build()
        expect(derived(built)).to.deep.equal(built.messages ?? {})
      })
    })
  }

  describe('what the entities do not build one call at a time', () => {
    const hubCall = (functionName: string, args: unknown[]) =>
      encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: functionName as any, args: args as any })
    const orderPayload = (payload: Parameters<typeof encodeBatchRequestManagerPayload>[0]) =>
      builders.hubManagerCall(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        centrifugeId: String(HUB),
        target: scope.batchRequestManager,
        payload: encodeBatchRequestManagerPayload(payload),
        label: 'BatchRequestManager',
        refundAddress: signer,
      }).data

    it('reads the three-argument updateSharePrice as hub-only, like the overload the entity sends', () => {
      const data = hubCall('updateSharePrice', [pool33Id.raw, scId33.raw, 10n ** 18n])

      expect(messagesOf(data)).to.deep.equal({})
    })

    it('reads a managerCall to the pool BatchRequestManager that approves redeems as sending no message', () => {
      const data = orderPayload({
        kind: 'approveRedeems',
        scId: scId33.raw,
        assetId: spokeAssetId.toString(),
        epochId: '4',
        approvedShareAmount: '5',
        pricePoolPerAsset: '1',
      })

      expect(messagesOf(data)).to.deep.equal({})
    })

    it('sends a BatchRequestManager callback to the chain of the asset, not to the chain of the call', () => {
      const data = orderPayload({
        kind: 'issueShares',
        scId: scId33.raw,
        assetId: spokeAssetId.toString(),
        epochId: '4',
        pricePoolPerShare: '1',
        refundAddress: signer,
      })

      expect(messagesOf(data)).to.deep.equal({
        [SPOKE]: [{ type: MessageType.RequestCallback, poolId: pool33Id }],
      })
    })

    it('treats the BatchRequestManager address on another chain than the pool’s hub as an ordinary target', () => {
      const data = builders.hubManagerCall(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        centrifugeId: String(SPOKE),
        target: scope.batchRequestManager,
        payload: encodeBatchRequestManagerPayload({
          kind: 'approveRedeems',
          scId: scId33.raw,
          assetId: spokeAssetId.toString(),
          epochId: '4',
          approvedShareAmount: '5',
          pricePoolPerAsset: '1',
        }),
        label: 'BatchRequestManager',
        refundAddress: signer,
      }).data

      expect(messagesOf(data)).to.deep.equal({
        [SPOKE]: [messageV3_3(MessageTypeV3_3.ManagerCallFromHub, pool33Id)],
      })
    })

    it('adds the extra gas of a managerCall only when it is more than zero', () => {
      const call = (extraGasLimit: bigint) =>
        hubCall('managerCall', [pool33Id.raw, SPOKE, addressToBytes32(who), '0x', extraGasLimit, 0n, signer])

      expect(messagesOf(call(0n))[SPOKE]).to.deep.equal([messageV3_3(MessageTypeV3_3.ManagerCallFromHub, pool33Id)])
      expect(messagesOf(call(7n))[SPOKE]).to.deep.equal([
        { ...messageV3_3(MessageTypeV3_3.ManagerCallFromHub, pool33Id), extraGasLimit: 7n },
      ])
    })
  })

  describe('refuses', () => {
    const hubCall = (functionName: string, args: unknown[]) =>
      encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: functionName as any, args: args as any })
    const refusal = (data: HexString) => {
      try {
        messagesOf(data)
      } catch (error) {
        return (error as Error).message
      }
      throw new Error('expected a refusal')
    }

    it('a selector the v3.3 Hub does not carry', () => {
      expect(refusal('0xdeadbeef')).to.match(/not a function of the v3\.3 Hub/)
    })

    it('calldata that cannot be decoded with its function', () => {
      expect(refusal('0x88550d1f00')).to.match(/does not decode/)
    })

    it('a call for another pool', () => {
      const data = hubCall('updateHubManager', [pool33Id.raw + 1n, who, true])

      expect(refusal(data)).to.match(/not for pool/)
    })

    it('a Hub call that takes no pool first', () => {
      expect(refusal(hubCall('rely', [who]))).to.match(/pool/)
    })

    it('functions no entity builds, whatever their classification', () => {
      for (const [name, args] of [
        ['updateHoldingValue', [pool33Id.raw, scId33.raw, 1n]],
        ['updateJournal', [pool33Id.raw, [], []]],
        ['cancelAuthorization', [pool33Id.raw, '0x12345678']],
        ['initiateAuthorization', [pool33Id.raw, '0x12345678']],
        ['updateCurrency', [pool33Id.raw, 1n]],
      ] as const) {
        expect(refusal(hubCall(name, [...args])), name).to.contain(name)
      }
    })

    it('a parsed call of a function no entity builds, by name, when it is derived without being parsed', () => {
      expect(() => deriveHubCallMessages({ functionName: 'updateJournal', args: [] }, scope)).to.throw(
        Error,
        /Hub\.updateJournal is not a call an SDK entity builds/
      )
    })

    it('a managerCall that carries a local value, which the Hub reverts', () => {
      for (const centrifugeId of [HUB, SPOKE]) {
        const data = hubCall('managerCall', [pool33Id.raw, centrifugeId, addressToBytes32(who), '0x', 0n, 1n, signer])

        expect(refusal(data), String(centrifugeId)).to.match(/local value of 1/)
      }
    })

    it('extra gas on a function whose messages carry none, which the fee would not cover', () => {
      const calls: [string, unknown[]][] = [
        ['updateRestriction', [pool33Id.raw, scId33.raw, SPOKE, '0x', 5n, signer]],
        ['notifyShareClass', [pool33Id.raw, scId33.raw, SPOKE, addressToBytes32(who), '0x', 5n, signer]],
        ['notifyShareMetadata', [pool33Id.raw, scId33.raw, SPOKE, 5n, signer]],
        ['updateVault', [pool33Id.raw, scId33.raw, spokeAssetId.raw, addressToBytes32(who), 0, '0x', 5n, signer]],
      ]

      for (const [name, args] of calls) {
        expect(refusal(hubCall(name, args)), name).to.match(new RegExp(`Hub\\.${name} carries an extra gas limit of 5`))
      }
    })

    it('no extra gas, which is what the entities send, on those functions', () => {
      const data = hubCall('updateRestriction', [pool33Id.raw, scId33.raw, SPOKE, '0x', 0n, signer])

      expect(messagesOf(data)).to.deep.equal({ [SPOKE]: [{ type: MessageType.UpdateRestriction, poolId: pool33Id }] })
    })

    it('a managerCall to the BatchRequestManager that forces a request canceled, which no entity builds', () => {
      const data = builders.hubManagerCall(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        centrifugeId: String(HUB),
        target: scope.batchRequestManager,
        payload: encodeBatchRequestManagerPayload({
          kind: 'forceCancelDepositRequest',
          scId: scId33.raw,
          investor: who,
          assetId: spokeAssetId.toString(),
          refundAddress: signer,
        }),
        label: 'BatchRequestManager',
        refundAddress: signer,
      }).data

      expect(refusal(data)).to.match(/not an approve, issue or revoke/)
    })

    it('a managerCall to the BatchRequestManager whose payload is cut short', () => {
      const data = hubCall('managerCall', [
        pool33Id.raw,
        HUB,
        addressToBytes32(scope.batchRequestManager),
        '0x0000000000000000000000000000000000000000000000000000000000000003',
        0n,
        0n,
        signer,
      ])

      expect(refusal(data)).to.match(/not an approve, issue or revoke/)
    })

    it('an updateVault of a kind that is not deploy and link, link or unlink', () => {
      const data = hubCall('updateVault', [
        pool33Id.raw,
        scId33.raw,
        spokeAssetId.raw,
        addressToBytes32(who),
        9,
        '0x',
        0n,
        signer,
      ])

      expect(refusal(data)).to.match(/updateVault/)
    })
  })
})
