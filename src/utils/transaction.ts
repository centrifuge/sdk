import { LocalAccount, parseAbi, type PublicClient, type TransactionReceipt } from 'viem'
import type { HexString } from '../types/index.js'
import type { MessageType, OperationStatus, Signer, TransactionContext } from '../types/transaction.js'

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
  messages?: Record<number, MessageType[]>
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
    messages?: Record<number /* Centrifuge ID */, MessageType[]>
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
