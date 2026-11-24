import sinon from 'sinon'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import type { AssetId } from '../utils/types.js'
import { scId33, spokeAssetId } from './hubGroup.js'

// The indexer's epoch rows and per-investor order rows of a share class, as `ShareClass._settledOrdersNow` reads them,
// for tests of what an executed group leaves to claim.

export const ISO = '2026-01-02T00:00:00.000Z'
const approvalOf = (epoch: number) => `0x${epoch.toString(16).padStart(64, '0')}`
type Options = { assetId?: AssetId; claimed?: boolean; closed?: boolean }

export const depositEpoch = (index: number, { assetId = spokeAssetId, closed = true }: Options = {}) => ({
  index,
  assetId: assetId.toString(),
  approvedAtTxHash: approvalOf(index),
  issuedAt: closed ? ISO : null,
})
export const depositOrder = (
  account: HexString,
  epoch: number,
  { assetId = spokeAssetId, claimed = false }: Options = {}
) => ({
  account,
  index: epoch,
  assetId: assetId.toString(),
  approvedAtTxHash: approvalOf(epoch),
  issuedAt: ISO,
  claimedAt: claimed ? ISO : null,
})
export const redeemEpoch = (index: number, { assetId = spokeAssetId, closed = true }: Options = {}) => ({
  index,
  assetId: assetId.toString(),
  revokedAt: closed ? ISO : null,
})
export const redeemOrder = (
  account: HexString,
  epoch: number,
  { assetId = spokeAssetId, claimed = false }: Options = {}
) => ({
  account,
  index: epoch,
  assetId: assetId.toString(),
  revokedAt: ISO,
  claimedAt: claimed ? ISO : null,
})

type Rows = { epochs: object[]; orders: object[] }
/** The rows of each share class by its id; a test changes them between two polls. */
export type Indexed = Record<string, { deposits?: Rows; redemptions?: Rows }>

export const deposits = (epochs: object[], orders: object[] = []) => ({
  [scId33.raw]: { deposits: { epochs, orders } },
})
export const redemptions = (epochs: object[], orders: object[] = []) => ({
  [scId33.raw]: { redemptions: { epochs, orders } },
})

/** Answers the closed-order reads of every share class from `indexed`, as it is at the time of each read. */
export function stubIndexer(centrifuge: Centrifuge, indexed: Indexed) {
  const names = {
    epochInvestOrders: ['deposits', 'epochs'],
    closedInvestOrders: ['deposits', 'orders'],
    epochRedeemOrders: ['redemptions', 'epochs'],
    closedRedeemOrders: ['redemptions', 'orders'],
  } as const
  return sinon.stub(centrifuge as any, '_queryDataOnce').callsFake(async (...args: unknown[]) => {
    const name = args[0] as keyof typeof names
    const { tokenId } = args[1] as { tokenId: string }
    const [side, kind] = names[name] ?? [undefined, undefined]
    if (!side) throw new Error(`unexpected indexer read ${name}`)
    return indexed[tokenId]?.[side]?.[kind] ?? []
  })
}
