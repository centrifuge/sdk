import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  zeroAddress,
  type PublicClient,
} from 'viem'
import type { SdkProtocolContext } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { spokeReadTarget } from './protocolVersion.js'
import { AssetId } from './types.js'

/**
 * True for a contract revert, false for an empty return or a transport failure.
 * @internal
 */
export function isContractRevert(error: unknown) {
  return (
    error instanceof BaseError &&
    !!error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ExecutionRevertedError)
  )
}

function isUnknownAssetRevert(error: unknown) {
  return (
    error instanceof BaseError &&
    !!error.walk((e) => e instanceof ContractFunctionRevertedError && e.data?.errorName === 'UnknownAsset')
  )
}

/** @internal */
export type SpokeAssets = ReturnType<typeof spokeAssets>

/**
 * Asset lookups on the spoke of a pool's protocol context: v3.3 keeps them in the `SpokeRegistry`,
 * v3.2 in the spoke itself. Both return `null` for an unregistered asset.
 * @internal
 */
export function spokeAssets(client: PublicClient, ctx: SdkProtocolContext) {
  const { address, abi } = spokeReadTarget(ctx)

  return {
    async assetId(asset: HexString, tokenId: bigint): Promise<AssetId | null> {
      try {
        const id = await client.readContract({ address, abi, functionName: 'assetToId', args: [asset, tokenId] })
        return id === 0n ? null : new AssetId(id)
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },

    async asset(assetId: AssetId): Promise<{ address: HexString; tokenId: bigint } | null> {
      try {
        const [asset, tokenId] = await client.readContract({
          address,
          abi,
          functionName: 'idToAsset',
          args: [assetId.raw],
        })
        return asset === zeroAddress ? null : { address: asset, tokenId }
      } catch (error) {
        if (isUnknownAssetRevert(error)) return null
        throw error
      }
    },

    /**
     * {@link asset}, refusing an asset this context does not register. The one place an asset id
     * becomes an address for a read or a write, so every site resolves it in the context it was
     * handed: the pool's version for pool-scoped flows, the chain's newest for pool-less ones.
     */
    async requireAsset(assetId: AssetId): Promise<{ address: HexString; tokenId: bigint }> {
      const asset = await this.asset(assetId)
      if (!asset) {
        throw new Error(
          `Asset ${assetId.toString()} is not registered on centrifugeId ${ctx.centrifugeId} at protocol ` +
            `${ctx.protocolVersion}`
        )
      }
      return asset
    },
  }
}
