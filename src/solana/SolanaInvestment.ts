import type { Observable } from 'rxjs'
import type { Centrifuge } from '../Centrifuge.js'
import { getSolanaPoolAddress } from './config/poolAddresses.js'
import type { SolanaWalletAdapter, SolanaTransactionStatus } from './types/wallet.js'
import type { Balance } from '../utils/BigInt.js'
import type { ShareClassId } from '../utils/types.js'

/**
 * Handles Solana investment operations for a specific pool/shareClass
 * This is a lightweight wrapper around SolanaManager for user-facing API
 */
export class SolanaInvestment {
  constructor(
    private readonly _root: Centrifuge,
    public readonly shareClassId: ShareClassId
  ) {}

  /**
   * Invest USDC into a Solana enabled pool
   *
   * @param amount - The USDC amount to invest
   * @param wallet - The connected Solana wallet adapter
   * @returns Observable that emits transaction status updates
   */
  invest(amount: Balance, wallet: SolanaWalletAdapter): Observable<SolanaTransactionStatus> {
    if (!this._root.solana) {
      throw new Error('Solana is not configured. Please initialize the Centrifuge SDK with Solana configuration.')
    }

    return this._root.solana.invest(amount, this.shareClassId, wallet)
  }

  /**
   * Check if this pool supports Solana investments
   * @returns True if the pool has a Solana address configured
   */
  isAvailable(): boolean {
    if (!this._root.solana) {
      return false
    }

    const solanaConfig = this._root.config.solana
    const solanaEnvironment =
      solanaConfig?.environment ?? (this._root.config.environment === 'testnet' ? 'devnet' : 'mainnet')

    const config = getSolanaPoolAddress(this.shareClassId.toString(), solanaEnvironment)
    return config !== undefined
  }
}
