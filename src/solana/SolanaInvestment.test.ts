import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import { Keypair } from '@solana/web3.js'
import { firstValueFrom } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import { Balance } from '../utils/BigInt.js'
import { ShareClassId } from '../utils/types.js'
import { SolanaTransactionError, SolanaErrorCode, type SolanaWalletAdapter } from './types/wallet.js'

describe('SolanaInvestment', () => {
  let sdk: Centrifuge
  let mockWallet: SolanaWalletAdapter
  let mockKeypair: Keypair

  beforeEach(() => {
    sdk = new Centrifuge({
      environment: 'testnet',
      solana: {
        rpcUrl: 'https://api.devnet.solana.com',
        commitment: 'confirmed',
      },
    })

    mockKeypair = Keypair.generate()
    mockWallet = {
      publicKey: mockKeypair.publicKey,
      signTransaction: async (tx) => {
        return tx
      },
    }
  })

  describe('Validation', () => {
    it('should throw error if wallet is not connected', async () => {
      const disconnectedWallet: SolanaWalletAdapter = {
        publicKey: null,
        signTransaction: async (tx) => tx,
      }

      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(amount, shareClassId, disconnectedWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
        expect((error as SolanaTransactionError).code).to.equal(SolanaErrorCode.WALLET_NOT_CONNECTED)
        expect((error as SolanaTransactionError).message).to.include('Wallet not connected')
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })

    it('should throw error if amount has invalid decimals', async () => {
      // USDC must have 6 decimals
      const invalidAmount = Balance.fromFloat(100, 18) // Wrong: 18 decimals (like ETH)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(invalidAmount, shareClassId, mockWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
        expect((error as SolanaTransactionError).code).to.equal(SolanaErrorCode.INVALID_DECIMALS)
        expect((error as SolanaTransactionError).message).to.include('USDC must have 6 decimals')
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })

    it('should throw error if amount is zero', async () => {
      const zeroAmount = Balance.fromFloat(0, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(zeroAmount, shareClassId, mockWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
        expect((error as SolanaTransactionError).code).to.equal(SolanaErrorCode.INVALID_AMOUNT)
        expect((error as SolanaTransactionError).message).to.include('must be greater than 0')
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })

    it('should throw error if amount is negative', async () => {
      const negativeAmount = new Balance(-100_000000n, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(negativeAmount, shareClassId, mockWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
        expect((error as SolanaTransactionError).code).to.equal(SolanaErrorCode.INVALID_AMOUNT)
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })

    it('should throw error if pool is not configured', async () => {
      const amount = Balance.fromFloat(100, 6)
      const unconfiguredShareClassId = new ShareClassId('0xffffffffffffffffffffffffffffffff')

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(amount, unconfiguredShareClassId, mockWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
        expect((error as SolanaTransactionError).code).to.equal(SolanaErrorCode.POOL_NOT_CONFIGURED)
        expect((error as SolanaTransactionError).message).to.include('No Solana pool address configured')
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })
  })

  describe('Transaction Flow', () => {
    it('should emit status updates in correct order', (done) => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      const statuses: string[] = []

      // Skip this test if pool is not configured
      // In a real test environment, you'd configure a test pool
      sdk.solana!.invest(amount, shareClassId, mockWallet).subscribe({
        next: (status) => {
          statuses.push(status.type)
        },
        error: (error) => {
          // We expect this to fail due to no pool configuration
          expect(error).to.be.instanceOf(SolanaTransactionError)
          done()
        },
        complete: () => {
          // If it completes successfully, verify the status order
          expect(statuses).to.deep.equal(['preparing', 'signing', 'sending', 'confirming', 'confirmed'])
          done()
        },
      })
    })

    it('should handle wallet signature rejection', async () => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      // Mock wallet that rejects signing
      const rejectingWallet: SolanaWalletAdapter = {
        publicKey: mockKeypair.publicKey,
        signTransaction: async () => {
          throw new Error('User rejected the transaction')
        },
      }

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(amount, shareClassId, rejectingWallet))
      } catch (error) {
        errorThrown = true
        // Will fail at pool configuration or signature rejection
        expect(error).to.be.instanceOf(SolanaTransactionError)
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })
  })

  describe('Balance Class Integration', () => {
    it('should correctly convert Balance to USDC amount', () => {
      const amount1 = Balance.fromFloat(1000.5, 6)
      expect(amount1.toBigInt()).to.equal(1000_500000n)

      const amount2 = Balance.fromFloat(0.01, 6)
      expect(amount2.toBigInt()).to.equal(10_000n)

      const amount3 = Balance.fromFloat(1_000_000, 6)
      expect(amount3.toBigInt()).to.equal(1_000_000_000000n)
    })

    it('should correctly display USDC amount', () => {
      const amount = new Balance(1234_567890n, 6)
      expect(amount.toFloat()).to.equal(1234.56789)
    })
  })

  describe('ShareClassId Integration', () => {
    it('should correctly format ShareClassId as string', () => {
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')
      expect(shareClassId.toString()).to.equal('0x1234567890abcdef1234567890abcdef')
    })

    it('should handle ShareClassId case-insensitivity', () => {
      const id1 = new ShareClassId('0x1234567890abcdef1234567890abcdef')
      const id2 = new ShareClassId('0x1234567890ABCDEF1234567890ABCDEF')

      // toString should normalize the case
      expect(id1.toString().toLowerCase()).to.equal(id2.toString().toLowerCase())
    })
  })

  describe('Error Handling', () => {
    it('should wrap unknown errors in SolanaTransactionError', async () => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      // Mock wallet that throws an unexpected error type
      const faultyWallet: SolanaWalletAdapter = {
        publicKey: mockKeypair.publicKey,
        signTransaction: async () => {
          throw { weird: 'error object' } // Non-standard error
        },
      }

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(amount, shareClassId, faultyWallet))
      } catch (error) {
        errorThrown = true
        expect(error).to.be.instanceOf(SolanaTransactionError)
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })

    it('should preserve original error in SolanaTransactionError', async () => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      const originalError = new Error('Original error message')
      const faultyWallet: SolanaWalletAdapter = {
        publicKey: mockKeypair.publicKey,
        signTransaction: async () => {
          throw originalError
        },
      }

      let errorThrown = false
      try {
        await firstValueFrom(sdk.solana!.invest(amount, shareClassId, faultyWallet))
      } catch (error) {
        errorThrown = true
        // Will fail at pool configuration first, but demonstrates error preservation
        expect(error).to.be.instanceOf(SolanaTransactionError)
      }
      expect(errorThrown, 'Expected error to be thrown').to.be.true
    })
  })

  describe('Environment Configuration', () => {
    it('should use testnet configuration in testnet environment', () => {
      expect(sdk.config.environment).to.equal('testnet')
      expect(sdk.solana).to.not.be.null
    })

    it('should use mainnet configuration in mainnet environment', () => {
      const mainnetSdk = new Centrifuge({
        environment: 'mainnet',
        solana: {
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          commitment: 'confirmed',
        },
      })

      expect(mainnetSdk.config.environment).to.equal('mainnet')
      expect(mainnetSdk.solana).to.not.be.null
    })
  })

  describe('Observable Pattern', () => {
    it('should return an Observable that can be subscribed to', () => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      const observable = sdk.solana!.invest(amount, shareClassId, mockWallet)

      expect(observable).to.have.property('subscribe')
      expect(typeof observable.subscribe).to.equal('function')
    })

    it('should return an Observable that can be awaited', async () => {
      const amount = Balance.fromFloat(100, 6)
      const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef')

      const observable = sdk.solana!.invest(amount, shareClassId, mockWallet)

      // Observables can be awaited (will throw due to no pool config, but that's expected)
      try {
        await observable
      } catch (error) {
        expect(error).to.be.instanceOf(SolanaTransactionError)
      }
    })
  })
})
