import { ABIS_V3_3, V33_MIGRATION_ABI_V3_3 } from '@centrifuge/protocol'
import { decodeErrorResult, type Abi } from 'viem'
import type { HexString } from '../types/index.js'

type AbiError = Extract<Abi[number], { type: 'error' }>

/** Every error a migration call can revert with: the facade's and those of the v3.3 contracts it calls. */
const PROTOCOL_ERRORS: AbiError[] = [V33_MIGRATION_ABI_V3_3, ...Object.values(ABIS_V3_3)].flatMap((abi) =>
  (abi as Abi).filter((item): item is AbiError => item.type === 'error')
)

/**
 * The revert named from the protocol's errors with its arguments, such as `NotEnoughGas()`, or undefined when no
 * protocol error has its selector.
 * @internal
 */
export function protocolErrorName(data: HexString): string | undefined {
  try {
    const { errorName, args } = decodeErrorResult({ abi: PROTOCOL_ERRORS, data })
    return `${errorName}(${(args ?? []).map(String).join(', ')})`
  } catch {
    return undefined
  }
}
