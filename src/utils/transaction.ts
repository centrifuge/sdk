import { signERC2612Permit } from 'eth-permit'
import type { Account, Chain, LocalAccount, PublicClient, WalletClient } from 'viem'
import type { HexString } from '../types/index.js'
import type { OperationStatus, Signer } from '../types/transaction.js'

export async function* doTransaction(
  title: string,
  publicClient: PublicClient,
  transactionCallback: () => Promise<HexString>
): AsyncGenerator<OperationStatus> {
  yield { type: 'SigningTransaction', title }
  const hash = await transactionCallback()
  yield { type: 'TransactionPending', title, hash }
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  yield { type: 'TransactionConfirmed', title, hash, receipt }
}

export async function* doSignMessage(
  title: string,
  transactionCallback: () => Promise<any>
): AsyncGenerator<OperationStatus, any> {
  yield { type: 'SigningMessage', title }
  const message = await transactionCallback()
  yield { type: 'SignedMessage', title, signed: message }
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
