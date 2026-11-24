import type { Balance } from './BigInt.js'
import type { AssetId } from './types.js'

export function assetDecimalsByAssetId(
  epochInvestOrders: { assetId: AssetId; assetDecimals: number }[],
  epochOutstandingInvests: { assetId: AssetId; pendingAmount: Balance }[]
): (assetId: string, fallback: number) => number {
  const decimals = new Map<string, number>()
  for (const order of epochOutstandingInvests) {
    decimals.set(order.assetId.toString(), order.pendingAmount.decimals)
  }
  for (const order of epochInvestOrders) {
    decimals.set(order.assetId.toString(), order.assetDecimals)
  }
  return (assetId, fallback) => decimals.get(assetId) ?? fallback
}
