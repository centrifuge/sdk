import { ABIS_V3_3, encodeBatchRequestManagerPayload } from '@centrifuge/protocol'
import { encodeFunctionData } from 'viem'
import type { HexString } from '../types/index.js'
import { addressToBytes32 } from '../utils/index.js'
import { ctx, HUB, pool33Id, scId33, signer, spokeAssetId, who } from './hubGroup.js'

// Calls of the v3.3 Hub to a pool's `BatchRequestManager`, as the order flows send them, for tests that hold the calldata
// of a group and not the entity that built it.

export const batchRequestManager = ctx(pool33Id, '3.3').addresses.batchRequestManager!

export type OrderPayload = Parameters<typeof encodeBatchRequestManagerPayload>[0]
type Target = { scId?: HexString; assetId?: string }

export const hubCall = (functionName: string, args: unknown[]) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: functionName as any, args: args as any })

/** A `Hub.managerCall` carrying `payload`; by default to the BatchRequestManager of pool 33 on its hub chain. */
export const orderCall = (
  payload: OrderPayload,
  { centrifugeId = HUB, target = batchRequestManager, poolId = pool33Id } = {}
) =>
  hubCall('managerCall', [
    poolId.raw,
    centrifugeId,
    addressToBytes32(target),
    encodeBatchRequestManagerPayload(payload),
    0n,
    0n,
    signer,
  ])

const of = ({ scId = scId33.raw, assetId = spokeAssetId.toString() }: Target) => ({ scId, assetId })

export const approveDeposits = (epochId = '3', target: Target = {}): OrderPayload => ({
  kind: 'approveDeposits',
  ...of(target),
  epochId,
  approvedAssetAmount: '5',
  pricePoolPerAsset: '1',
  refundAddress: signer,
})
export const approveRedeems = (epochId = '3', target: Target = {}): OrderPayload => ({
  kind: 'approveRedeems',
  ...of(target),
  epochId,
  approvedShareAmount: '5',
  pricePoolPerAsset: '1',
})
export const issueShares = (epochId = '3', target: Target = {}): OrderPayload => ({
  kind: 'issueShares',
  ...of(target),
  epochId,
  pricePoolPerShare: '1',
  refundAddress: signer,
})
export const revokeShares = (epochId = '4', target: Target = {}): OrderPayload => ({
  kind: 'revokeShares',
  ...of(target),
  epochId,
  pricePoolPerShare: '1',
  refundAddress: signer,
})
export const forceCancel: OrderPayload = {
  kind: 'forceCancelDepositRequest',
  scId: scId33.raw,
  investor: who,
  assetId: spokeAssetId.toString(),
  refundAddress: signer,
}
