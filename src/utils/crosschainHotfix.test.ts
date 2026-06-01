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

  it('skips messages targeting Plume', () => {
    const messages: Record<number, MessageTypeWithSubType[]> = {
      1: [{ type: MessageType.NotifyPricePoolPerShare, poolId }],
    }

    const added = addMessageForEnabledTarget(messages, PLUME_CENTRIFUGE_ID, {
      type: MessageType.NotifyPricePoolPerShare,
      poolId,
    })

    expect(added).to.equal(false)
    expect(messages).to.have.keys(['1'])
  })

  it('throws before estimating or submitting Plume messages', () => {
    expect(() => assertCrosschainMessagingEnabled(PLUME_CENTRIFUGE_ID)).to.throw(
      `Cross-chain messaging for centrifugeId ${PLUME_CENTRIFUGE_ID} is temporarily disabled`
    )

    expect(() =>
      assertMessagesDoNotTargetDisabledChains({
        [PLUME_CENTRIFUGE_ID]: [{ type: MessageType.NotifyPricePoolPerShare, poolId }],
      })
    ).to.throw(`Cross-chain messaging for centrifugeId ${PLUME_CENTRIFUGE_ID} is temporarily disabled`)
  })
})
