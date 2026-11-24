import { concatHex, parseAbi } from 'viem'
import { addEstimateBuffer, batchKeyOf, MessageArgumentError, type ContractAbis } from '@centrifuge/protocol'
import type { Client, HexString } from '../types/index.js'

const ADAPTER_ESTIMATE_ABI = parseAbi([
  'function estimate(uint16 centrifugeId, bytes payload, uint256 gasLimit) view returns (uint256)',
])

/** The batch key of the global pool, whose adapter set carries pool-independent messages. */
const GLOBAL_BATCH_KEY = '0'.repeat(16)

/**
 * The adapters a pool's batches are priced against when the transaction that sends them also installs the pool's
 * set, so `MultiAdapter.estimate` cannot see it yet (it returns 0 on v3.2 and reverts on v3.3). Each adapter is
 * asked the way the MultiAdapter asks it: on v3.3 behind the 2-byte session id `send` prefixes, `0x0101` for the
 * maximal calldata cost.
 */
export type PendingPoolAdapters = { adapters: readonly HexString[]; sessionPrefix: boolean }

/**
 * The +50% estimate buffer is defined in `@centrifuge/protocol`, beside
 * `emptyMessage`: it is part of "the amount attached", so the backend and this
 * package must apply the identical multiplier or two routes pay different
 * amounts for the same transaction. Re-exported here for callers in this
 * package.
 */
export { addEstimateBuffer }

function _assertBatchGasWithinLimit(batchGasLimit: bigint, maxBatchGasLimit: bigint, toCentrifugeId: number) {
  if (batchGasLimit > maxBatchGasLimit) {
    throw new Error(`Batch gas ${batchGasLimit} exceeds limit ${maxBatchGasLimit} for chain ${toCentrifugeId}`)
  }
}

export async function estimateBatchBridgeFee(params: {
  publicClient: Client
  gasService: HexString
  multiAdapter: HexString
  abis: ContractAbis
  gasMessagePayloads: HexString[]
  toCentrifugeId: number
  pendingPoolAdapters?: PendingPoolAdapters
}) {
  const { publicClient, gasService, multiAdapter, abis: ABI, gasMessagePayloads, toCentrifugeId, pendingPoolAdapters } =
    params

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

    // The batch key is the uint64 pool id in bytes 1..9, which is what
    // separates one pool's messages from another's and from the global pool.
    //
    // `batchKeyOf` (`@centrifuge/protocol`) rather than a local slice, and it
    // THROWS on a payload too short to carry a pool id.
    //
    // What a lenient key would cost: a payload shorter than the 9 bytes a type
    // byte plus a uint64 pool id need yields a TRUNCATED key (empty, for a
    // 1-byte payload), so every such payload lands in ONE batch regardless of
    // pool, and `MultiAdapter.estimate` prices the lot against whichever
    // adapter set the FIRST of them resolves. No error anywhere: just a fee
    // computed against the wrong pool's adapters.
    //
    // Two reasons it is worth a throw rather than a shrug. First, the fee is a
    // convention of the exact `emptyMessage` bytes — `estimate` is
    // payload-content sensitive, the same message padded with `0xff` cost
    // 50,815,112,882 wei more — so the backend and this package must group
    // identically or the two routes pay different amounts for the same
    // transaction, and the backend groups with this helper. Second, it silently
    // DISARMS the zero-estimate refusal below: merge an unconfigured pool's
    // payload into a configured pool's batch and the batch estimates non-zero,
    // so the very check that exists to catch `quorum(2, poolId) == 0` (5 of 12
    // live mainnet pools) never fires and the message stalls after the hub
    // transaction confirms.
    //
    // Nothing real gets refused by tightening it: every payload on this path
    // comes from `emptyMessage`, which emits 250 bytes for every type and 90
    // for `UpdateVault`. A sub-9-byte payload is not a protocol message.
    let batchKey: string
    try {
      batchKey = batchKeyOf(data)
    } catch (cause) {
      if (cause instanceof MessageArgumentError) {
        throw new Error(
          `Cannot price crosschain message ${index + 1} of ${gasMessagePayloads.length} for chain ` +
            `${toCentrifugeId}: it is not a protocol payload. ${cause.message}. Payloads must come from ` +
            `\`emptyMessage\`, which always carries a type byte and a uint64 pool id; grouping a shorter ` +
            `one would merge unrelated pools into a single batch and price them against one pool's ` +
            `adapter set.`,
          { cause }
        )
      }
      throw cause
    }

    if (!batches.has(batchKey)) {
      // Use a representative payload so MultiAdapter can pick the correct pool adapter set.
      batches.set(batchKey, { gasLimit: 0n, payload: data })
    }

    const batch = batches.get(batchKey)!
    batch.gasLimit += gasLimit
  })

  const maxBatchGasLimit = await publicClient.readContract({
    address: gasService,
    abi: ABI.GasService,
    functionName: 'maxBatchGasLimit',
    args: [toCentrifugeId],
  })

  // Checked BEFORE estimating, not after. `MultiAdapter.estimate` reverts on an
  // over-limit batch with an adapter-side custom error that is not in any
  // bundled ABI, so it surfaces as an undecodable selector; running the limit
  // check first means the caller gets a message naming the numbers instead.
  const batchList = Array.from(batches.values())
  batchList.forEach(({ gasLimit }) => {
    _assertBatchGasWithinLimit(gasLimit, maxBatchGasLimit, toCentrifugeId)
  })

  const estimates = await Promise.all(
    Array.from(batches.entries()).map(async ([batchKey, { gasLimit, payload }]) => {
      if (pendingPoolAdapters && batchKey !== GLOBAL_BATCH_KEY) {
        const adapterPayload = pendingPoolAdapters.sessionPrefix ? concatHex(['0x0101', payload]) : payload
        const fees = await Promise.all(
          pendingPoolAdapters.adapters.map((adapter) =>
            publicClient.readContract({
              address: adapter,
              abi: ADAPTER_ESTIMATE_ABI,
              functionName: 'estimate',
              args: [toCentrifugeId, adapterPayload, gasLimit],
            })
          )
        )
        return fees.reduce((acc, fee) => acc + fee, 0n)
      }
      return publicClient.readContract({
        address: multiAdapter,
        abi: ABI.MultiAdapter,
        functionName: 'estimate',
        args: [toCentrifugeId, payload, gasLimit],
      })
    })
  )

  // A zero fee for a crosschain batch is never legitimate, and it is not an
  // error the chain reports: `MultiAdapter.estimate` resolves the adapter set
  // for the payload's pool and sums over it, so an unconfigured set (quorum 0)
  // sums over nothing and returns 0 at any gas limit. Paying 0 does not revert
  // — the hub transaction succeeds and the message is underpaid and stalls,
  // recoverable only via `repayBatch`. Verified against live mainnet pools:
  // an unconfigured pool estimated 0 wei on a route where its neighbour cost
  // ~1.04e14. Checked per batch rather than on the sum, so one pool's zero
  // cannot be masked by another pool's fee in the same call.
  estimates.forEach((batchEstimate, index) => {
    if (batchEstimate === 0n) {
      const { payload, gasLimit } = batchList[index]!
      throw new Error(
        `Crosschain fee estimated to 0 for chain ${toCentrifugeId} (batch gas ${gasLimit}). ` +
          `MultiAdapter has no adapters configured for this pool or route, so the message would ` +
          `be underpaid and stall after the transaction succeeds. Payload: ${payload.slice(0, 18)}…`
      )
    }
  })

  const estimate = estimates.reduce((acc, val) => acc + val, 0n)

  // Add 50% buffer to the estimate, as the actual gas used can be higher than the estimate due dynamic message content
  return addEstimateBuffer(estimate)
}
