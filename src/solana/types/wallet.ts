import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'

/**
 * Minimal wallet adapter interface compatible with @solana/wallet-adapter
 * This allows the SDK to work with any Solana wallet without requiring the full wallet-adapter dependency
 */
export interface SolanaWalletAdapter {
  publicKey: PublicKey | null

  /**
   * Sign a transaction with the wallet
   * @param transaction - The transaction to sign
   * @returns The signed transaction
   */
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>

  /**
   * Optional: Sign multiple transactions
   * @param transactions - Array of transactions to sign
   * @returns Array of signed transactions
   */
  signAllTransactions?<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>
}

export type SolanaTransactionStatus =
  | {
      type: 'preparing'
      message: string
    }
  | {
      type: 'signing'
      message: string
    }
  | {
      type: 'sending'
      message: string
    }
  | {
      type: 'confirming'
      message: string
      signature: string
    }
  | {
      type: 'confirmed'
      message: string
      signature: string
    }

export class SolanaTransactionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'SolanaTransactionError'
  }
}

export enum SolanaErrorCode {
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  POOL_NOT_CONFIGURED = 'POOL_NOT_CONFIGURED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  SIGNATURE_REJECTED = 'SIGNATURE_REJECTED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_DECIMALS = 'INVALID_DECIMALS',
}
