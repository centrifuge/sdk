import {
  AbiEvent,
  decodeEventLog,
  LocalAccount,
  Log,
  parseAbi,
  RpcLog,
  toEventSelector,
  withRetry,
  type Abi,
  type TransactionReceipt,
} from 'viem'
import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, mainnet, sepolia } from 'viem/chains'
import { ABI } from '../abi/index.js'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import type { HexString } from '../types/index.js'
import type {
  MessageTypeWithSubType,
  OperationStatus,
  SafeMultisigTransactionResponse,
  Signer,
  TransactionContext,
} from '../types/transaction.js'

class TransactionError extends Error {
  override name = 'TransactionError'
  constructor(public receipt: TransactionReceipt) {
    super('Transaction reverted')
  }
}

export type BatchTransactionData = {
  contract: HexString
  data: HexString[]
  value?: bigint
  messages?: Record<number, MessageTypeWithSubType[]>
}

export async function* wrapTransaction(
  title: string,
  ctx: TransactionContext,
  {
    contract,
    data: data_,
    value: value_,
    messages,
  }: {
    contract: HexString
    data: HexString | HexString[]
    value?: bigint
    // Messages to estimate gas for, that will be sent as a result of the transaction, separated by Centrifuge ID.
    // Used to estimate the payment for the transaction.
    // It is assumed that the messages belong to a single pool.
    messages?: Record<number /* Centrifuge ID */, MessageTypeWithSubType[]>
  },
  options: {
    simulate: boolean
  } = { simulate: false }
): AsyncGenerator<OperationStatus | BatchTransactionData> {
  const data = Array.isArray(data_) ? data_ : [data_]
  if (ctx.isBatching) {
    yield {
      contract,
      data,
      value: value_,
      messages,
    }
  } else {
    const messagesEstimates = messages
      ? await Promise.all(
          Object.entries(messages).map(async ([centId, messageTypes]) =>
            ctx.root._estimate(ctx.chainId, { centId: Number(centId) }, messageTypes)
          )
        )
      : []
    const estimate = messagesEstimates.reduce((acc, val) => acc + val, 0n)
    const value = (value_ ?? 0n) + estimate

    if (!options.simulate) {
      const result = yield* doTransaction(title, ctx, async () => {
        if (data.length === 1) {
          return ctx.walletClient.sendTransaction({
            to: contract,
            data: data[0],
            value,
          })
        }
        return ctx.walletClient.writeContract({
          address: contract,
          abi: parseAbi(['function multicall(bytes[] data) payable']),
          functionName: 'multicall',
          args: [data],
          value,
        })
      })

      return result
    }

    if (options.simulate) {
      let simulationResult

      if (data.length === 1) {
        const { results } = await ctx.publicClient.simulateCalls({
          account: ctx.signingAddress,
          calls: [
            {
              to: contract,
              data: data[0],
              value,
            },
          ],
        })

        simulationResult = results
      } else {
        const { results } = await ctx.publicClient.simulateCalls({
          account: ctx.signingAddress,
          calls: [
            {
              to: contract,
              abi: parseAbi(['function multicall(bytes[] data) payable']),
              functionName: 'multicall',
              args: [data],
              value,
            },
          ],
        })

        simulationResult = results
      }

      yield {
        type: 'TransactionSimulation',
        title,
        result: simulationResult,
      } satisfies OperationStatus

      return
    }
  }
}

export async function* doTransaction(
  title: string,
  ctx: TransactionContext,
  transactionCallback: () => Promise<HexString>
): AsyncGenerator<OperationStatus> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningTransaction', title }
  const hash = await transactionCallback()
  yield { id, type: 'TransactionPending', title, hash }

  const code = await ctx.publicClient.getCode({ address: ctx.signingAddress })
  if (code === SAFE_PROXY_BYTECODE) {
    return yield* waitForSafeTransaction(id, title, hash, ctx)
  }

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') {
    console.error('Transaction reverted', receipt)
    throw new TransactionError(receipt)
  }
  const result = { id, type: 'TransactionConfirmed', title, hash, receipt } as const
  yield result
  return result
}

// TODO: maybe yield Safe Transaction updates as well
async function* waitForSafeTransaction(
  id: string,
  title: string,
  hash: HexString,
  ctx: TransactionContext
): AsyncGenerator<OperationStatus> {
  // First check if tx is actually a safe tx
  let safeTx = await withRetry(() => getSafeTransaction(hash, ctx.chainId), {
    retryCount: 5,
    delay: 5000,
  })

  if (safeTx.isExecuted) return safeTx

  safeTx = await withRetry(
    async () => {
      const status = await getSafeTransaction(hash, ctx.chainId)
      if (status.isExecuted) return status
      throw new Error(`Timeout waiting for safe transaction to be executed. Transaction hash: ${hash}`)
    },
    {
      retryCount: 360,
      delay: 10000,
    }
  )

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: safeTx.transactionHash as HexString })
  const result = { id, type: 'TransactionConfirmed', title, hash, receipt } as const
  yield result
  return result
}

export async function* doSignMessage<T = any>(
  title: string,
  transactionCallback: () => Promise<T>
): AsyncGenerator<OperationStatus, T> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningMessage', title }
  const message = await transactionCallback()
  yield { id, type: 'SignedMessage', title, signed: message }
  return message
}

export function isLocalAccount(signer: Signer): signer is LocalAccount {
  return 'type' in signer && signer.type === 'local'
}

// Cached ABI events by their selector
let abiCache: Map<string, AbiEvent> | undefined
function getAbiCache() {
  if (abiCache) return abiCache
  abiCache = new Map()
  Object.values(ABI)
    .flat()
    .forEach((abiItem) => {
      if (abiItem.type === 'event') {
        abiCache!.set(toEventSelector(abiItem), abiItem)
      }
    })
  return abiCache
}

function getAbiEvent(selector: HexString): AbiEvent | undefined {
  const cache = getAbiCache()
  return cache.get(selector)
}

// Match a block's event logs to all available ABIs' events.
export function parseEventLogs(parameters: {
  logs: (Log | RpcLog)[]
  eventName?: string | string[]
  address?: HexString | HexString[]
}): Log<bigint, number, false, undefined, true, Abi, string>[] {
  const { logs, eventName: eventName_, address: address_ } = parameters
  const eventName = eventName_ !== undefined ? new Set(Array.isArray(eventName_) ? eventName_ : [eventName_]) : null
  const address =
    address_ !== undefined
      ? new Set((Array.isArray(address_) ? address_ : [address_]).map((a) => a.toLowerCase()))
      : null

  return logs
    .map((log) => {
      try {
        const abiItem = getAbiEvent(log.topics[0]!)
        if (!abiItem) return null as never

        // Check that the event is one we care about
        if (eventName && eventName.size && !eventName.has(abiItem.name)) return null
        if (address && address.size && !address.has(log.address)) return null

        const event = decodeEventLog({
          ...log,
          abi: [abiItem],
          strict: true,
        })

        return { ...event, ...log }
      } catch {
        return null as never
      }
    })
    .filter(Boolean) as any
}

function safeApiNetworkName(chainId: number) {
  const name = {
    [mainnet.id]: 'mainnet',
    [base.id]: 'base',
    [arbitrum.id]: 'arbitrum',
    [sepolia.id]: 'sepolia',
    [baseSepolia.id]: 'base-sepolia',
    [arbitrumSepolia.id]: 'arbitrum-sepolia',
    [avalanche.id]: 'avalanche',
  }[chainId]

  if (name) return name
  throw new Error(`Safe API does not support chainId "${chainId}"`)
}

async function getSafeTransaction(hash: HexString, chainId: number) {
  const networkName = safeApiNetworkName(chainId)
  const endpoint = `https://safe-transaction-${networkName}.safe.global`
  const url = `${endpoint}/api/v1/multisig-transactions/${hash}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Error fetching Safe transaction: ${response.statusText}`)
  }
  const data = await response.json()
  return data as SafeMultisigTransactionResponse
}
