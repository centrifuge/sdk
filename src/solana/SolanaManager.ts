import { Observable } from 'rxjs'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  TransactionSignature,
} from '@solana/web3.js'
import { SolanaClient, SolanaConfig } from './SolanaClient.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { CentrifugeQueryOptions } from '../types/query.js'

/**
 * Manages Solana operations within the Centrifuge SDK.
 * This class provides Solana-specific functionality while maintaining
 * the same patterns as the EVM side (observables, query caching, etc.).
 */
export class SolanaManager {
  #client: SolanaClient
  #root: Centrifuge
  #signer: Keypair | null = null

  constructor(root: Centrifuge, config: SolanaConfig) {
    this.#root = root
    this.#client = new SolanaClient(config)
  }

  /**
   * Get the Solana client
   */
  get client(): SolanaClient {
    return this.#client
  }

  /**
   * Get the underlying Solana connection
   */
  get connection(): Connection {
    return this.#client.connection
  }

  /**
   * Set the Solana signer (keypair)
   */
  setSigner(signer: Keypair | null) {
    this.#signer = signer
  }

  /**
   * Get the current signer
   */
  get signer(): Keypair | null {
    return this.#signer
  }

  /**
   * Get the balance of a Solana account in lamports
   * @param address - The public key or address string
   */
  balance(address: PublicKey | string) {
    const pubkey = typeof address === 'string' ? new PublicKey(address) : address
    const addressStr = pubkey.toBase58()

    return this._query(['solana', 'balance', addressStr], () => {
      return this.#client.getBalance(pubkey)
    })
  }

  /**
   * Get account info for a given address
   * @param address - The public key or address string
   */
  accountInfo(address: PublicKey | string) {
    const pubkey = typeof address === 'string' ? new PublicKey(address) : address
    const addressStr = pubkey.toBase58()

    return this._query(['solana', 'accountInfo', addressStr], () => {
      return this.#client.getAccountInfo(pubkey)
    })
  }

  /**
   * Transfer SOL from the signer to another account
   * Returns an observable that emits transaction status updates
   * @param to - Recipient public key
   * @param lamports - Amount to transfer in lamports (1 SOL = 1,000,000,000 lamports)
   */
  transferSol(
    to: PublicKey | string,
    lamports: number
  ): Observable<{
    status: 'signing' | 'sending' | 'confirmed'
    signature?: TransactionSignature
  }> {
    return new Observable((subscriber) => {
      ;(async () => {
        try {
          if (!this.#signer) {
            throw new Error('Signer not set. Call setSigner() first.')
          }

          const toPubkey = typeof to === 'string' ? new PublicKey(to) : to

          subscriber.next({ status: 'signing' })

          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: this.#signer.publicKey,
              toPubkey,
              lamports,
            })
          )

          subscriber.next({ status: 'sending' })

          const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.#signer])

          subscriber.next({ status: 'confirmed', signature })
          subscriber.complete()
        } catch (error) {
          subscriber.error(error)
        }
      })()
    })
  }

  /**
   * Get the current slot
   */
  getSlot() {
    return this._query(['solana', 'slot'], () => {
      return this.#client.getSlot()
    })
  }

  /**
   * Watch for account changes
   * @param address - The public key or address string to watch
   */
  watchAccount(address: PublicKey | string) {
    const pubkey = typeof address === 'string' ? new PublicKey(address) : address
    return this.#client.watchAccount(pubkey)
  }

  /**
   * Internal query method that uses the root Centrifuge query cache
   * This ensures Solana queries are cached alongside EVM queries
   * @internal
   */
  _query<T>(
    keys: (string | number | boolean | undefined)[] | null,
    observableCallback: () => Observable<T>,
    options?: CentrifugeQueryOptions
  ) {
    return this.#root._query<T>(keys, observableCallback, options)
  }
}
