import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  getContract,
  zeroAddress,
  type PublicClient,
} from 'viem'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import { AssetId } from './types.js'

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
export async function spokeAssets(client: PublicClient, spoke: HexString) {
  const spokeContract = getContract({ address: spoke, abi: ABI.Spoke, client })
  let registry: HexString | null
  try {
    registry = await spokeContract.read.spokeRegistry()
  } catch (error) {
    if (!isContractRevert(error)) throw error
    registry = null
  }

  const registryContract = registry ? getContract({ address: registry, abi: ABI.SpokeRegistry, client }) : null

  return {
    async assetId(asset: HexString, tokenId: bigint): Promise<AssetId | null> {
      try {
        const id = registryContract
          ? await registryContract.read.assetToId([asset, tokenId])
          : await spokeContract.read.assetToId([asset, tokenId])
        return id === 0n ? null : new AssetId(id)
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },

    async asset(assetId: AssetId): Promise<{ address: HexString; tokenId: bigint } | null> {
      try {
        const [address, tokenId] = registryContract
          ? await registryContract.read.idToAsset([assetId.raw])
          : await spokeContract.read.idToAsset([assetId.raw])
        return address === zeroAddress ? null : { address, tokenId }
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },
  }
}
