import { expect } from 'chai'
import { MessageType, type MessageTypeWithSubType } from '../types/transaction.js'
import { PoolId } from './types.js'
import {
  addMessageForEnabledTarget,
  assertCrosschainMessagingEnabled,
  assertMessagesDoNotTargetDisabledChains,
  PLUME_CENTRIFUGE_ID,
} from './crosschainHotfix.js'

describe('crosschainHotfix', () => {
  const poolId = PoolId.from(1, 1)

  // The disabled list is currently empty, so all targets (including Plume) are
  // enabled. These tests document that and exercise the kill-switch helpers.
  it('allows messages to all networks when nothing is disabled', () => {
    const messages: Record<number, MessageTypeWithSubType[]> = {
      1: [{ type: MessageType.NotifyPricePoolPerShare, poolId }],
    }

    const added = addMessageForEnabledTarget(messages, PLUME_CENTRIFUGE_ID, {
      type: MessageType.NotifyPricePoolPerShare,
      poolId,
    })

    expect(added).to.equal(true)
    expect(messages[PLUME_CENTRIFUGE_ID]).to.have.length(1)
  })

  it('does not throw for any target when nothing is disabled', () => {
    expect(() => assertCrosschainMessagingEnabled(PLUME_CENTRIFUGE_ID)).to.not.throw()

    expect(() =>
      assertMessagesDoNotTargetDisabledChains({
        [PLUME_CENTRIFUGE_ID]: [{ type: MessageType.NotifyPricePoolPerShare, poolId }],
      })
    ).to.not.throw()
  })
})
