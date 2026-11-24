import { ABIS_V3_2, ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { decodeFunctionData, encodeFunctionData, getAddress } from 'viem'
import {
  entitiesOf,
  HUB,
  pool32Id,
  pool33Id,
  scId33,
  setupV33,
  signer,
  SPOKE,
  spokeAssetId,
  stubWiredAdapters,
  thenable,
  who,
} from '../tests/hubGroup.js'
import { MessageType } from '../types/transaction.js'
import { ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { notifyAssetPriceCall, notifyPoolCall, PoolNetwork, poolNeedsNotify } from './PoolNetwork.js'
import { sharePriceNotifications } from './ShareClass.js'

// The emitters a deployment and a share price update share with the execution of a matured group.

describe('the emitters an entity shares with the execution of a group', () => {
  afterEach(() => sinon.restore())

  describe('poolNeedsNotify', () => {
    it('is true for a network the pool is neither active on nor has a share class on', () => {
      expect(poolNeedsNotify({ isActive: false, activeShareClasses: [] })).to.equal(true)
    })

    it('is false once the pool is active, and once a share class is, even while isActive lags', () => {
      expect(poolNeedsNotify({ isActive: true, activeShareClasses: [] })).to.equal(false)
      expect(poolNeedsNotify({ isActive: false, activeShareClasses: [{}] })).to.equal(false)
    })
  })

  describe('notifyPoolCall and notifyAssetPriceCall', () => {
    it('encode the Hub calls the deployment sends, with the messages they send', async () => {
      const hub = await setupV33().centrifuge.protocolContext(pool33Id)
      const notifyPool = notifyPoolCall(hub, pool33Id, SPOKE, signer)
      const notifyAssetPrice = notifyAssetPriceCall(hub, pool33Id, scId33.raw, spokeAssetId, signer)

      expect(notifyPool.data).to.equal(
        encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'notifyPool', args: [pool33Id.raw, SPOKE, signer] })
      )
      expect(notifyPool.message).to.deep.equal({ type: MessageType.NotifyPool, poolId: pool33Id })
      expect(notifyAssetPrice.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifyAssetPrice',
          args: [pool33Id.raw, scId33.raw, spokeAssetId.raw, signer],
        })
      )
      expect(notifyAssetPrice.message).to.deep.equal({ type: MessageType.NotifyPricePoolPerAsset, poolId: pool33Id })
    })
  })

  describe('sharePriceNotifications', () => {
    it('is one notification per network in the order given, each with its own message', async () => {
      const hub = await setupV33().centrifuge.protocolContext(pool33Id)
      const notifications = sharePriceNotifications(hub, pool33Id, scId33.raw, [HUB, SPOKE], signer)

      expect(notifications.map(({ data }) => decodeFunctionData({ abi: ABIS_V3_3.Hub, data }).args)).to.deep.equal([
        [pool33Id.raw, scId33.raw, HUB, getAddress(signer)],
        [pool33Id.raw, scId33.raw, SPOKE, getAddress(signer)],
      ])
      expect(notifications.map(({ messages }) => messages)).to.deep.equal([
        { [HUB]: [{ type: MessageType.NotifyPricePoolPerShare, poolId: pool33Id }] },
        { [SPOKE]: [{ type: MessageType.NotifyPricePoolPerShare, poolId: pool33Id }] },
      ])
    })

    it('is nothing for a share class on no network', async () => {
      const hub = await setupV33().centrifuge.protocolContext(pool33Id)
      expect(sharePriceNotifications(hub, pool33Id, scId33.raw, [], signer)).to.deep.equal([])
    })
  })

  describe('ShareClass.notifySharePrice and notifyAssetPrice', () => {
    it('send the calldata and the messages of one notification, refunded to the signer', async () => {
      const { centrifuge, build } = setupV33()
      const { shareClass } = entitiesOf(centrifuge)

      const price = await build(shareClass.notifySharePrice(SPOKE))
      const asset = await build(shareClass.notifyAssetPrice(spokeAssetId))

      expect(price.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifySharePrice',
          args: [pool33Id.raw, scId33.raw, SPOKE, getAddress(signer)],
        })
      )
      expect(price.messages).to.deep.equal({
        [SPOKE]: [{ type: MessageType.NotifyPricePoolPerShare, poolId: pool33Id }],
      })
      expect(asset.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifyAssetPrice',
          args: [pool33Id.raw, scId33.raw, spokeAssetId.raw, getAddress(signer)],
        })
      )
      expect(asset.messages).to.deep.equal({
        [SPOKE]: [{ type: MessageType.NotifyPricePoolPerAsset, poolId: pool33Id }],
      })
    })
  })

  describe('PoolNetwork._needsNotifyPool', () => {
    it('applies the check the deployment applies to the network’s details', async () => {
      const { centrifuge } = setupV33()
      const { network } = entitiesOf(centrifuge)
      const details = sinon.stub(network, 'details')

      details.returns(thenable({ isActive: false, activeShareClasses: [] }) as any)
      expect(await network._needsNotifyPool()).to.equal(true)
      details.returns(thenable({ isActive: true, activeShareClasses: [] }) as any)
      expect(await network._needsNotifyPool()).to.equal(false)
    })
  })

  describe('a vault deployment on a v3.2 pool', () => {
    it('still sends notifyAssetPrice and then updateVault, refunded to the signer', async () => {
      const scId32 = ShareClassId.from(pool32Id, 1)
      const { centrifuge, build } = setupV33({ manager: true, requestManager: who })
      stubWiredAdapters(centrifuge)
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool32Id), SPOKE)
      sinon
        .stub(network, 'details')
        .returns(thenable({ isActive: true, activeShareClasses: [{ id: scId32, vaults: [] }] }) as any)

      const built = await build(network.deploy([], [{ shareClassId: scId32, assetId: spokeAssetId, kind: 'async' }]))

      const decoded = built.calls.map((call) => decodeFunctionData({ abi: ABIS_V3_2.Hub, data: call.data }))
      expect(decoded.map(({ functionName }) => functionName)).to.deep.equal(['notifyAssetPrice', 'updateVault'])
      expect(decoded[0]!.args).to.deep.equal([pool32Id.raw, scId32.raw, spokeAssetId.raw, getAddress(signer)])
      expect(built.messages).to.deep.equal({
        [SPOKE]: [
          { type: MessageType.NotifyPricePoolPerAsset, poolId: pool32Id },
          { type: MessageType.UpdateVault, subtype: 0, poolId: pool32Id },
        ],
      })
    })
  })
})
