import type { MessageTypeWithSubType } from '../types/transaction.js'
import type { CentrifugeId } from './types.js'

export const PLUME_CENTRIFUGE_ID = 4

// Kill-switch for temporarily disabling cross-chain messaging to specific
// networks (e.g. while a network's adapter wiring is being fixed). Currently
// empty — all networks are enabled, including Plume. To disable a network
// again, add its centrifugeId here.
export const TEMPORARILY_DISABLED_CROSSCHAIN_CENTRIFUGE_IDS = [] as const

const disabledCentrifugeIds = new Set<number>(TEMPORARILY_DISABLED_CROSSCHAIN_CENTRIFUGE_IDS)

export function isCrosschainMessagingDisabled(centrifugeId: CentrifugeId) {
  return disabledCentrifugeIds.has(centrifugeId)
}

export function getCrosschainMessagingDisabledError(centrifugeId: CentrifugeId) {
  return new Error(`Cross-chain messaging for centrifugeId ${centrifugeId} is temporarily disabled`)
}

export function assertCrosschainMessagingEnabled(centrifugeId: CentrifugeId) {
  if (isCrosschainMessagingDisabled(centrifugeId)) {
    throw getCrosschainMessagingDisabledError(centrifugeId)
  }
}

export function addMessageForEnabledTarget(
  messages: Record<number, MessageTypeWithSubType[]>,
  centrifugeId: CentrifugeId,
  message: MessageTypeWithSubType
) {
  if (isCrosschainMessagingDisabled(centrifugeId)) return false

  if (!messages[centrifugeId]) messages[centrifugeId] = []
  messages[centrifugeId].push(message)
  return true
}

export function filterCrosschainEnabledTargets<T extends { centrifugeId: CentrifugeId }>(items: T[]) {
  return items.filter((item) => !isCrosschainMessagingDisabled(item.centrifugeId))
}

export function assertMessagesDoNotTargetDisabledChains(messages: Record<number, MessageTypeWithSubType[]>) {
  Object.keys(messages).forEach((centrifugeId) => {
    assertCrosschainMessagingEnabled(Number(centrifugeId))
  })
}
