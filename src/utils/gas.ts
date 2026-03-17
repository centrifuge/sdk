import { ABI } from '../abi/index.js'
import type { Client, HexString } from '../types/index.js'

function _assertBatchGasWithinLimit(batchGasLimit: bigint, maxBatchGasLimit: bigint, toCentrifugeId: number) {
  if (batchGasLimit > maxBatchGasLimit) {
    throw new Error(`Batch gas ${batchGasLimit} exceeds limit ${maxBatchGasLimit} for chain ${toCentrifugeId}`)
  }
}

export function addEstimateBuffer(estimate: bigint) {
  return (estimate * 3n) / 2n
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

  const batches = new Map<string, { gasLimit: bigint; payload: HexString }>()
  gasLimits.forEach((gasLimit, index) => {
    const data = gasMessagePayloads[index]!

    // Skip first byte, take next uint64 (8 bytes = 16 hex chars)
    // Separates pool messages from global messages
    const batchKey = data.slice(4, 4 + 16)

    if (!batches.has(batchKey)) {
      // Use a representative payload so MultiAdapter can pick the correct pool adapter set.
      batches.set(batchKey, { gasLimit: 0n, payload: data })
    }

    const batch = batches.get(batchKey)!
    batch.gasLimit += gasLimit
  })

  const [maxBatchGasLimit, ...estimates] = await Promise.all([
    publicClient.readContract({
      address: gasService,
      abi: ABI.GasService,
      functionName: 'maxBatchGasLimit',
      args: [toCentrifugeId],
    }),
    ...Array.from(batches.values()).map(({ gasLimit, payload }) =>
      publicClient.readContract({
        address: multiAdapter,
        abi: ABI.MultiAdapter,
        functionName: 'estimate',
        args: [toCentrifugeId, payload, gasLimit],
      })
    ),
  ])

  const estimate = estimates.reduce((acc, val) => acc + val, 0n)

  Array.from(batches.values()).forEach(({ gasLimit }) => {
    _assertBatchGasWithinLimit(gasLimit, maxBatchGasLimit, toCentrifugeId)
  })

  // Add 50% buffer to the estimate, as the actual gas used can be higher than the estimate due dynamic message content
  return addEstimateBuffer(estimate)
}
