import {
  AbiEvent,
  decodeEventLog,
  LocalAccount,
  Log,
  parseAbi,
  RpcLog,
  toEventSelector,
  type Abi,
  type PublicClient,
  type TransactionReceipt,
} from 'viem'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import type { MessageTypeWithSubType, OperationStatus, Signer, TransactionContext } from '../types/transaction.js'

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
  }
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
    const result = yield* doTransaction(title, ctx.publicClient, async () => {
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
}

export async function* doTransaction(
  title: string,
  publicClient: PublicClient,
  transactionCallback: () => Promise<HexString>
): AsyncGenerator<OperationStatus> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningTransaction', title }
  const hash = await transactionCallback()
  yield { id, type: 'TransactionPending', title, hash }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') {
    console.error('Transaction reverted', receipt)
    throw new TransactionError(receipt)
  }
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
  eventName: string | string[]
  address: HexString | HexString[]
}): Log<bigint, number, false, undefined, true, Abi, string>[] {
  const { logs, eventName: eventName_, address: address_ } = parameters
  const eventName = new Set(Array.isArray(eventName_) ? eventName_ : [eventName_])
  const address = new Set((Array.isArray(address_) ? address_ : [address_]).map((a) => a.toLowerCase()))

  return logs
    .map((log) => {
      try {
        const abiItem = getAbiEvent(log.topics[0]!)
        if (!abiItem) return null as never

        // Check that the event is one we care about
        if (!eventName.has(abiItem.name)) return null
        if (!address.has(log.address)) return null

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
