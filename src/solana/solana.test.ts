import { describe, it } from 'mocha'
import { expect } from 'chai'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Centrifuge } from '../Centrifuge.js'

describe('Solana Integration', () => {
  // Use Solana devnet for testing
  const DEVNET_RPC = 'https://api.devnet.solana.com'

  describe('Configuration', () => {
    it('should initialize Centrifuge with Solana config', () => {
      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      expect(sdk.solana).to.not.be.null
      expect(sdk.solana?.client.rpcUrl).to.equal(DEVNET_RPC)
    })

    it('should not initialize Solana when config is not provided', () => {
      const sdk = new Centrifuge({
        environment: 'testnet',
      })

      expect(sdk.solana).to.be.null
    })
  })

  describe('Balance Queries', () => {
    it('should get balance for a Solana address', async function () {
      this.timeout(10000) // Increase timeout for network request

      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      // Test with a known address (Solana System Program)
      const systemProgram = '11111111111111111111111111111111'
      const balance$ = sdk.solana!.balance(systemProgram)

      const balance = await balance$
      expect(balance).to.be.a('number')
      expect(balance).to.be.at.least(0)
    })

    it('should get account info', async function () {
      this.timeout(10000)

      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      // Test with System Program address
      const systemProgram = '11111111111111111111111111111111'
      const accountInfo$ = sdk.solana!.accountInfo(systemProgram)

      const info = await accountInfo$
      expect(info).to.not.be.null
      expect(info?.owner.toBase58()).to.equal('NativeLoader1111111111111111111111111111111')
    })
  })

  describe('Signer Management', () => {
    it('should set and get signer', () => {
      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      const keypair = Keypair.generate()
      sdk.solana!.setSigner(keypair)

      expect(sdk.solana!.signer).to.equal(keypair)
      expect(sdk.solana!.signer?.publicKey.toBase58()).to.equal(keypair.publicKey.toBase58())
    })
  })

  describe('SOL Transfer', () => {
    it('should create a transfer observable', function (done) {
      this.timeout(30000) // Increase timeout for transaction

      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      // Create a new keypair for testing
      const fromKeypair = Keypair.generate()
      const toKeypair = Keypair.generate()

      sdk.solana!.setSigner(fromKeypair)

      // This will fail because the account has no balance, but we can test the observable pattern
      const transfer$ = sdk.solana!.transferSol(toKeypair.publicKey, 0.001 * LAMPORTS_PER_SOL)

      const statuses: string[] = []

      transfer$.subscribe({
        next: (status) => {
          statuses.push(status.status)
          console.log('Status:', status)
        },
        error: (error) => {
          // Expected to fail due to insufficient funds
          console.log('Expected error (insufficient funds):', error.message)
          expect(statuses).to.include('signing')
          expect(error).to.exist
          done()
        },
        complete: () => {
          // If it completes, the transaction was successful
          expect(statuses).to.include('signing')
          expect(statuses).to.include('sending')
          expect(statuses).to.include('confirmed')
          done()
        },
      })
    })
  })

  describe('Current Slot', () => {
    it('should get current slot number', async function () {
      this.timeout(10000)

      const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
          rpcUrl: DEVNET_RPC,
          commitment: 'confirmed',
        },
      })

      const slot$ = sdk.solana!.getSlot()
      const slot = await slot$

      expect(slot).to.be.a('number')
      expect(slot).to.be.greaterThan(0)
      console.log('Current Solana devnet slot:', slot)
    })
  })
})
