import type { Abi, Log, PublicClient } from 'viem'
import type { HexString } from '../types/index.js'

export const MIN_SIMULATION_BLOCK_GAS = 30_000_000n

type SimulatedCall =
  | { to: HexString; data?: HexString; value?: bigint }
  | { to: HexString; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }

export type SimulatedCallResult = {
  status: 'success' | 'failure'
  data: HexString
  gasUsed: bigint
  logs?: Log[]
  result?: unknown
  error?: Error
}

export async function simulateCalls(
  client: PublicClient,
  { account, calls }: { account: HexString; calls: readonly SimulatedCall[] }
): Promise<{ results: SimulatedCallResult[] }> {
  const { gasLimit } = await client.getBlock()
  const [block] = await client.simulateBlocks({
    blocks: [
      {
        blockOverrides: { gasLimit: gasLimit > MIN_SIMULATION_BLOCK_GAS ? gasLimit : MIN_SIMULATION_BLOCK_GAS },
        calls: calls.map((call) => ({ ...call, account })) as any,
      },
    ],
  })
  return { results: [...block!.calls] as SimulatedCallResult[] }
}
