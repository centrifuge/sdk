import { signERC2612Permit } from 'eth-permit'
import {
  parseAbi,
  type Account,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
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

export async function* doSignMessage(
  title: string,
  transactionCallback: () => Promise<any>
): AsyncGenerator<OperationStatus, any> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningMessage', title }
  const message = await transactionCallback()
  yield { id, type: 'SignedMessage', title, signed: message }
  return message
}

export type Permit = {
  deadline: number | string
  r: string
  s: string
  v: number
}

export async function signPermit(
  _: WalletClient<any, Chain, Account>,
  signer: Signer,
  chainId: number,
  signingAddress: string,
  currencyAddress: string,
  spender: string,
  amount: bigint
) {
  let domainOrCurrency: any = currencyAddress
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  if (currencyAddress.toLowerCase() === USDC) {
    // USDC has custom version
    domainOrCurrency = { name: 'USD Coin', version: '2', chainId, verifyingContract: currencyAddress }
  } else if (chainId === 5 || chainId === 84531 || chainId === 421613 || chainId === 11155111) {
    // Assume on testnets the LP currencies are used which have custom domains
    domainOrCurrency = { name: 'Centrifuge', version: '1', chainId, verifyingContract: currencyAddress }
  }

  const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour
  const permit = await signERC2612Permit(signer, domainOrCurrency, signingAddress, spender, amount.toString(), deadline)
  return permit as Permit
}

export function isLocalAccount(signer: Signer): signer is LocalAccount {
  return 'type' in signer && signer.type === 'local'
}
