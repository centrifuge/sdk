import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  zeroAddress,
  type PublicClient,
} from 'viem'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import { AssetId } from './types.js'

type ReadClient = Pick<PublicClient, 'readContract'>

/**
 * True for a contract revert or an empty return, false for a transport failure.
 * @internal
 */
export function isContractRevert(error: unknown) {
  return (
    error instanceof BaseError &&
    !!error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError)
  )
}

function isUnknownAssetRevert(error: unknown) {
  if (!(error instanceof Error)) return false
  const decoded =
    error instanceof BaseError &&
    !!error.walk((e) => e instanceof ContractFunctionRevertedError && e.data?.errorName === 'UnknownAsset')
  return decoded || error.message.includes('UnknownAsset')
}

/**
 * Asset lookups against a spoke of any protocol version: v3.3 keeps them in the `SpokeRegistry` the
 * spoke points to, v3.1 and v3.2 in the spoke itself. Both return `null` for an unregistered asset.
 * @internal
 */
export async function spokeAssets(client: ReadClient, spoke: HexString) {
  let registry: HexString | null
  try {
    registry = await client.readContract({ address: spoke, abi: ABI.Spoke, functionName: 'spokeRegistry' })
  } catch (error) {
    if (!isContractRevert(error)) throw error
    registry = null
  }

  return {
    async assetId(asset: HexString, tokenId: bigint): Promise<AssetId | null> {
      try {
        const id = registry
          ? await client.readContract({
              address: registry,
              abi: ABI.SpokeRegistry,
              functionName: 'assetToId',
              args: [asset, tokenId],
            })
          : await client.readContract({
              address: spoke,
              abi: ABI.Spoke,
              functionName: 'assetToId',
              args: [asset, tokenId],
            })
        return id === 0n ? null : new AssetId(id)
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },

    async asset(assetId: AssetId): Promise<{ address: HexString; tokenId: bigint } | null> {
      try {
        const [address, tokenId] = registry
          ? await client.readContract({
              address: registry,
              abi: ABI.SpokeRegistry,
              functionName: 'idToAsset',
              args: [assetId.raw],
            })
          : await client.readContract({
              address: spoke,
              abi: ABI.Spoke,
              functionName: 'idToAsset',
              args: [assetId.raw],
            })
        return address === zeroAddress ? null : { address, tokenId }
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },
  }
}
