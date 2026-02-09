export function assertBatchGasWithinLimit(batchGasLimit: bigint, maxBatchGasLimit: bigint, toCentrifugeId: number) {
  if (batchGasLimit > maxBatchGasLimit) {
    throw new Error(`Batch gas ${batchGasLimit} exceeds limit ${maxBatchGasLimit} for chain ${toCentrifugeId}`)
  }
}

type ReadContract = (params: {
  address: `0x${string}`
  abi: readonly unknown[]
  functionName: string
  args: readonly unknown[]
}) => Promise<unknown>

function asBigInt(value: unknown, functionName: string): bigint {
  if (typeof value !== 'bigint') {
    throw new Error(`Expected bigint return value from ${functionName}`)
  }
  return value
}

export async function estimateBatchBridgeFee(params: {
  readContract: ReadContract
  gasService: `0x${string}`
  multiAdapter: `0x${string}`
  gasMessagePayloads: `0x${string}`[]
  toCentrifugeId: number
  gasServiceAbi: readonly unknown[]
  multiAdapterAbi: readonly unknown[]
}) {
  const { readContract, gasService, multiAdapter, gasMessagePayloads, toCentrifugeId, gasServiceAbi, multiAdapterAbi } =
    params

  const gasLimits = await Promise.all(
    gasMessagePayloads.map((data) =>
      readContract({
        address: gasService,
        abi: gasServiceAbi,
        functionName: 'messageOverallGasLimit',
        args: [toCentrifugeId, data],
      }).then((value) => asBigInt(value, 'messageOverallGasLimit'))
    )
  )

  const batchGasLimit = gasLimits.reduce((acc, val) => acc + val, 0n)
  const maxBatchGasLimit = await readContract({
    address: gasService,
    abi: gasServiceAbi,
    functionName: 'maxBatchGasLimit',
    args: [toCentrifugeId],
  }).then((value) => asBigInt(value, 'maxBatchGasLimit'))

  assertBatchGasWithinLimit(batchGasLimit, maxBatchGasLimit, toCentrifugeId)

  return readContract({
    address: multiAdapter,
    abi: multiAdapterAbi,
    functionName: 'estimate',
    args: [toCentrifugeId, '0x0', batchGasLimit],
  }).then((value) => asBigInt(value, 'estimate'))
}
