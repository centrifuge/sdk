import type { Chain } from 'viem'
import { PoolId } from '../utils/types.js'
import type { HexString } from './index.js'

export type SafeAdminAction = 'shareClass.updateSharePrice'

export type SafeAdminResolution = {
  safeAddress: HexString
  label?: string
}

export type SafeAdminOwner = {
  address: HexString
  name?: string | null
}

export type SafeAdminInfo = {
  address: HexString
  nonce: number
  threshold: number
  owners: SafeAdminOwner[]
}

export type SafeAdminProposalPayload = {
  title: string
  safeAddress: HexString
  chain: Chain
  centrifugeId: number
  to: HexString
  value: bigint
  data: HexString
  operation: 0 | 1
  nonce: bigint
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: HexString
  refundReceiver: HexString
  safeTxHash: HexString
  sender: HexString
}

export type SafeAdminPendingTransaction = {
  id: string
  safeTxHash?: HexString | null
  nonce: number
  methodName?: string | null
  humanDescription?: string | null
  submittedAt?: number | null
  txStatus?: string
  proposer?: HexString | null
  confirmationsRequired: number
  confirmationsSubmitted: number
  confirmedBy: HexString[]
  target?: HexString | null
  data?: HexString | null
  group?: 'hub' | 'spoke'
  txHash?: HexString | null
  isExecuted: boolean
}

export type SafeAdminTransaction = SafeAdminPendingTransaction

export type SafeAdminResolutionInput = {
  action: SafeAdminAction
  poolId: PoolId
}

export type SafeAdminSignerState = 'owner' | 'non_owner' | 'unknown'

export type SafeAdminPendingTransactionSignerState =
  | 'unknown'
  | 'non_signer'
  | 'needs_confirmation'
  | 'confirmed'
  | 'executable'
  | 'executed'

export type SafeAdminPendingTransactionPermissions = {
  signerState: SafeAdminPendingTransactionSignerState
  isOwner: boolean
  hasConfirmed: boolean
  canSign: boolean
  canExecute: boolean
}

export function getSafeAdminSignerState(
  address: HexString | undefined,
  owners: Pick<SafeAdminOwner, 'address'>[]
): SafeAdminSignerState {
  if (!address) return 'unknown'
  return owners.some((owner) => owner.address.toLowerCase() === address.toLowerCase()) ? 'owner' : 'non_owner'
}

export function getSafeAdminPendingTransactionPermissions(
  address: HexString | undefined,
  transaction: Pick<SafeAdminPendingTransaction, 'isExecuted' | 'confirmationsRequired' | 'confirmationsSubmitted' | 'confirmedBy'>,
  owners: Pick<SafeAdminOwner, 'address'>[]
): SafeAdminPendingTransactionPermissions {
  if (!address) {
    return {
      signerState: 'unknown',
      isOwner: false,
      hasConfirmed: false,
      canSign: false,
      canExecute: false,
    }
  }

  const normalizedAddress = address.toLowerCase()
  const isOwner = owners.some((owner) => owner.address.toLowerCase() === normalizedAddress)
  if (!isOwner) {
    return {
      signerState: 'non_signer',
      isOwner: false,
      hasConfirmed: false,
      canSign: false,
      canExecute: false,
    }
  }

  const hasConfirmed = transaction.confirmedBy.some((owner) => owner.toLowerCase() === normalizedAddress)
  const canExecute =
    !transaction.isExecuted &&
    transaction.confirmationsRequired > 0 &&
    transaction.confirmationsSubmitted >= transaction.confirmationsRequired
  const canSign = !transaction.isExecuted && !hasConfirmed

  if (transaction.isExecuted) {
    return {
      signerState: 'executed',
      isOwner: true,
      hasConfirmed,
      canSign: false,
      canExecute: false,
    }
  }

  if (canExecute) {
    return {
      signerState: 'executable',
      isOwner: true,
      hasConfirmed,
      canSign,
      canExecute: true,
    }
  }

  if (hasConfirmed) {
    return {
      signerState: 'confirmed',
      isOwner: true,
      hasConfirmed: true,
      canSign: false,
      canExecute: false,
    }
  }

  return {
    signerState: 'needs_confirmation',
    isOwner: true,
    hasConfirmed: false,
    canSign: true,
    canExecute: false,
  }
}
