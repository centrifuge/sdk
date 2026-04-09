import { ABI } from '../abi/index.js'
import type { Client, HexString } from '../types/index.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_ADAPTERS = 8

function _assertBatchGasWithinLimit(batchGasLimit: bigint, maxBatchGasLimit: bigint, toCentrifugeId: number) {
  if (batchGasLimit > maxBatchGasLimit) {
    throw new Error(`Batch gas ${batchGasLimit} exceeds limit ${maxBatchGasLimit} for chain ${toCentrifugeId}`)
  }
}

export function addEstimateBuffer(estimate: bigint) {
  return (estimate * 3n) / 2n
}

/**
 * Queries each adapter registered for a (centrifugeId, poolId) pair individually
 * and returns their estimates. Returns null for any adapter whose estimate() call
 * reverts — indicating a broken adapter (e.g. AxelarGasService function removed).
 *
 * The batchKey is the pool ID encoded as a 16-char hex string (without 0x),
 * extracted directly from the message payload.
 */
async function readPerAdapterEstimates(
  publicClient: Client,
  multiAdapter: HexString,
  centrifugeId: number,
  poolId: bigint,
  payload: HexString,
  gasLimit: bigint
): Promise<(bigint | null)[]> {
  // Read all adapter slots in parallel; out-of-bounds slots revert → null
  const slots = await Promise.all(
    Array.from({ length: MAX_ADAPTERS }, (_, i) =>
      publicClient
        .readContract({
          address: multiAdapter,
          abi: ABI.MultiAdapter,
          functionName: 'adapters',
          args: [centrifugeId, poolId, BigInt(i)],
        })
        .catch(() => null)
    )
  )
  const adapters = slots.filter((addr) => addr && addr !== ZERO_ADDRESS) as HexString[]
  if (adapters.length === 0) return []

  const adapterEstimateAbi = [
    {
      name: 'estimate',
      type: 'function',
      inputs: [
        { name: 'centrifugeId', type: 'uint16' },
        { name: 'payload', type: 'bytes' },
        { name: 'gasLimit', type: 'uint256' },
      ],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    },
  ] as const

  return Promise.all(
    adapters.map((addr) =>
      publicClient
        .readContract({
          address: addr,
          abi: adapterEstimateAbi,
          functionName: 'estimate',
          args: [centrifugeId, payload, gasLimit],
        })
        .catch(() => null) // null = adapter estimate is broken
    )
  )
}

/**
 * Compute a safe bridge fee estimate for a single batch.
 *
 * Root cause of the SPXA bug: AxelarGasService was upgraded at the protocol level,
 * breaking the Axelar adapter's estimate() function. When broken, the adapter either:
 *   a) returns 0  → multiAdapter.estimate() understates the total → NotEnoughGas at execution
 *   b) reverts    → multiAdapter.estimate() reverts → transaction never gets prepared
 *
 * Fix: query each adapter individually. If any adapter is broken (returns 0 or reverts),
 * extrapolate the total from the working adapters so we always send enough.
 */
async function safeBatchEstimate(
  publicClient: Client,
  multiAdapter: HexString,
  centrifugeId: number,
  batchKey: string,
  payload: HexString,
  gasLimit: bigint
): Promise<bigint> {
  const multiAdapterTotal = await publicClient.readContract({
    address: multiAdapter,
    abi: ABI.MultiAdapter,
    functionName: 'estimate',
    args: [centrifugeId, payload, gasLimit],
  })

  // batchKey is the pool ID as a 16-char hex string (without 0x prefix),
  // extracted from the message payload (1 byte message type + 8 bytes pool ID).
  const poolId = BigInt('0x' + batchKey)

  const perAdapterEstimates = await readPerAdapterEstimates(
    publicClient,
    multiAdapter,
    centrifugeId,
    poolId,
    payload,
    gasLimit
  )

  // No per-adapter data (e.g. global messages with poolId=0) — trust multiAdapter
  if (perAdapterEstimates.length === 0) return multiAdapterTotal

  const brokenAdapters = perAdapterEstimates.filter((e) => e === null || e === 0n)

  // All adapters healthy — trust multiAdapter total
  if (brokenAdapters.length === 0) return multiAdapterTotal

  // One or more adapters have broken estimates.
  // Build a safe total from the working adapters by extrapolating across all adapters.
  const workingEstimates = perAdapterEstimates.filter((e): e is bigint => e !== null && e > 0n)

  if (workingEstimates.length === 0) {
    // All adapters broken — we can't extrapolate. Return multiAdapter total as-is;
    // the transaction will likely fail until the protocol fixes the broken adapter.
    return multiAdapterTotal
  }

  const maxWorkingEstimate = workingEstimates.reduce((max, e) => (e > max ? e : max), 0n)
  const safeTotal = maxWorkingEstimate * BigInt(perAdapterEstimates.length) * 2n

  // Return whichever is higher: multiAdapter's stated value or our extrapolated safe total
  return safeTotal > multiAdapterTotal ? safeTotal : multiAdapterTotal
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

    // Skip first byte (message type), take next uint64 (8 bytes = 16 hex chars) = pool ID.
    // Used both to group messages by pool and to look up per-adapter estimates.
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
    ...Array.from(batches.entries()).map(([batchKey, { gasLimit, payload }]) =>
      safeBatchEstimate(publicClient, multiAdapter, toCentrifugeId, batchKey, payload, gasLimit)
    ),
  ])

  const estimate = estimates.reduce((acc, val) => acc + val, 0n)

  Array.from(batches.values()).forEach(({ gasLimit }) => {
    _assertBatchGasWithinLimit(gasLimit, maxBatchGasLimit, toCentrifugeId)
  })

  // Add 50% buffer on top of the safe estimate
  return addEstimateBuffer(estimate)
}
