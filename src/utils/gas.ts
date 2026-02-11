import { ABI } from '../abi/index.js'
import type { Client, HexString } from '../types/index.js'

function _assertBatchGasWithinLimit(batchGasLimit: bigint, maxBatchGasLimit: bigint, toCentrifugeId: number) {
  if (batchGasLimit > maxBatchGasLimit) {
    throw new Error(`Batch gas ${batchGasLimit} exceeds limit ${maxBatchGasLimit} for chain ${toCentrifugeId}`)
  }
}

export async function estimateBatchBridgeFee(params: {
  publicClient: Client
  gasService: HexString
  multiAdapter: HexString
  gasMessagePayloads: HexString[]
  toCentrifugeId: number
}) {
  const { publicClient, gasService, multiAdapter, gasMessagePayloads, toCentrifugeId } = params

  const gasLimits = await Promise.all(
    gasMessagePayloads.map((data) =>
      publicClient.readContract({
        address: gasService,
        abi: ABI.GasService,
        functionName: 'messageOverallGasLimit',
        args: [toCentrifugeId, data],
      })
    )
  )

  const batchGasLimit = gasLimits.reduce((acc, val) => acc + val, 0n)
  const [maxBatchGasLimit, estimate] = await Promise.all([
    publicClient.readContract({
      address: gasService,
      abi: ABI.GasService,
      functionName: 'maxBatchGasLimit',
      args: [toCentrifugeId],
    }),
    publicClient.readContract({
      address: multiAdapter,
      abi: ABI.MultiAdapter,
      functionName: 'estimate',
      args: [toCentrifugeId, '0x0', batchGasLimit],
    }),
  ])

  _assertBatchGasWithinLimit(batchGasLimit, maxBatchGasLimit, toCentrifugeId)

  // Add 50% buffer to the estimate
  return (estimate * 3n) / 2n
}
