import { describe, it } from 'mocha'
import { expect } from 'chai'
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
