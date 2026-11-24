import { expect } from 'chai'
import { HUB, pool33Id, scId33, signer, SPOKE, spokeAssetId, who } from '../tests/hubGroup.js'
import {
  approveDeposits,
  approveRedeems,
  batchRequestManager,
  forceCancel,
  hubCall,
  issueShares,
  orderCall,
  revokeShares,
} from '../tests/orderCalls.js'
import type { HexString } from '../types/index.js'
import { peekHubCall } from './hubCallMessages.js'
import { addressToBytes32 } from './index.js'
import { orderStepsOf, settlesOrders } from './orderSettlements.js'
import { PoolId } from './types.js'

const scope = { poolId: pool33Id, batchRequestManager }
const asset = spokeAssetId.toString()

const peek = (data: HexString) => peekHubCall(data)

describe('orderSettlements', () => {
  describe('settlesOrders', () => {
    it('is true for an issue and for a revoke to this pool’s hub chain', () => {
      expect(settlesOrders(peek(orderCall(issueShares())), pool33Id)).to.equal(true)
      expect(settlesOrders(peek(orderCall(revokeShares())), pool33Id)).to.equal(true)
    })

    it('is false for an approve of deposits or of redeems and for a force cancel, which settle no epoch', () => {
      for (const payload of [approveDeposits(), approveRedeems(), forceCancel]) {
        expect(settlesOrders(peek(orderCall(payload)), pool33Id), payload.kind).to.equal(false)
      }
    })

    it('is false for a managerCall bound for another chain than the pool’s hub', () => {
      expect(settlesOrders(peek(orderCall(issueShares(), { centrifugeId: SPOKE })), pool33Id)).to.equal(false)
    })

    it('is false for a call of another pool', () => {
      const other = PoolId.from(HUB, 34)

      expect(settlesOrders(peek(orderCall(issueShares(), { poolId: other })), pool33Id)).to.equal(false)
    })

    it('is false for a managerCall whose payload is no order call, and for a call that is no managerCall', () => {
      const unrelated = hubCall('managerCall', [pool33Id.raw, HUB, addressToBytes32(who), '0x', 0n, 0n, signer])
      const price = hubCall('updateSharePrice', [pool33Id.raw, scId33.raw, 10n ** 18n])
      const deploy = hubCall('notifyPool', [pool33Id.raw, SPOKE, signer])

      for (const data of [unrelated, price, deploy]) {
        expect(settlesOrders(peek(data), pool33Id), data.slice(0, 10)).to.equal(false)
      }
    })

    it('is false for calldata that is no Hub call, which it does not throw for', () => {
      expect(settlesOrders(peek('0xdeadbeef'), pool33Id)).to.equal(false)
      expect(settlesOrders(peek('0x'), pool33Id)).to.equal(false)
      expect(settlesOrders(null, pool33Id)).to.equal(false)
    })
  })

  describe('orderStepsOf', () => {
    it('reads the action, share class, asset and epoch of each call to the pool’s BatchRequestManager, in order', () => {
      const calls = [approveDeposits('3'), issueShares('3'), approveRedeems('5'), revokeShares('4')].map((payload) =>
        peekHubCall(orderCall(payload))!
      )

      expect(
        orderStepsOf(calls, scope).map(({ kind, step, scId, assetId, epoch }) => [
          kind,
          step,
          scId,
          assetId.toString(),
          epoch,
        ])
      ).to.deep.equal([
        ['deposit', 'approve', scId33.raw, asset, 3],
        ['deposit', 'settle', scId33.raw, asset, 3],
        ['redeem', 'approve', scId33.raw, asset, 5],
        ['redeem', 'settle', scId33.raw, asset, 4],
      ])
    })

    it('leaves out a call to another contract with a payload of the same layout, and a force cancel', () => {
      const elsewhere = peekHubCall(orderCall(issueShares(), { target: who }))!
      const cancel = peekHubCall(orderCall(forceCancel))!

      expect(orderStepsOf([elsewhere, cancel], scope)).to.deep.equal([])
    })
  })
})
