import { isAddress, isHex, parseAbi, zeroAddress, type PublicClient } from 'viem'
import type { HexString } from '../types/index.js'
import type { SafeAdminProposalPayload } from '../types/safe.js'
import type { RawTransactionPayload } from '../types/transaction.js'

const SAFE_ABI = parseAbi([
  'function nonce() view returns (uint256)',
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)',
])

export type BuildSafeProposalPayloadInput = {
  rawPayload: RawTransactionPayload
  safeAddress: HexString
  sender: HexString
  publicClient: PublicClient
  nonce?: bigint
  operation?: 0 | 1
  safeTxGas?: bigint
  baseGas?: bigint
  gasPrice?: bigint
  gasToken?: HexString
  refundReceiver?: HexString
}

function assertAddress(value: string, label: string): asserts value is HexString {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${label}: "${value}"`)
  }
}

export async function buildSafeProposalPayload({
  rawPayload,
  safeAddress,
  sender,
  publicClient,
  nonce: providedNonce,
  operation = 0,
  safeTxGas = 0n,
  baseGas = 0n,
  gasPrice = 0n,
  gasToken = zeroAddress,
  refundReceiver = zeroAddress,
}: BuildSafeProposalPayloadInput): Promise<SafeAdminProposalPayload> {
  assertAddress(rawPayload.to, 'target contract')
  assertAddress(safeAddress, 'Safe address')
  assertAddress(sender, 'sender')

  if (!rawPayload.chain?.id) {
    throw new Error('Raw transaction payload is missing chain information')
  }
  if (!isHex(rawPayload.data) || rawPayload.data === '0x') {
    throw new Error('Raw transaction payload is missing calldata')
  }
  if (rawPayload.executionAddress.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(
      `Raw transaction execution address "${rawPayload.executionAddress}" does not match Safe address "${safeAddress}"`
    )
  }

  const nonce =
    providedNonce ??
    (await publicClient.readContract({
      address: safeAddress,
      abi: SAFE_ABI,
      functionName: 'nonce',
    }))
  const safeTxHash = await publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'getTransactionHash',
    args: [rawPayload.to, rawPayload.value, rawPayload.data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce],
  })

  return {
    title: rawPayload.title,
    safeAddress,
    chain: rawPayload.chain,
    centrifugeId: rawPayload.centrifugeId,
    to: rawPayload.to,
    value: rawPayload.value,
    data: rawPayload.data,
    operation,
    nonce,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    safeTxHash,
    sender,
  }
}
