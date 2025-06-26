import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { TenderlyFork } from './tenderly.js'

class TestContext {
  #centrifuge: Centrifuge | null = null
  public tenderlyFork!: TenderlyFork

  get centrifuge() {
    return this.#centrifuge ?? (this.#centrifuge = new Centrifuge({ environment: 'dev', pollingInterval: 500 }))
  }

  async initialize() {
    this.tenderlyFork = await TenderlyFork.create(sepolia)
    this.#centrifuge = new Centrifuge({
      environment: 'dev',
      rpcUrls: {
        11155111: this.tenderlyFork.rpcUrl,
      },
      pollingInterval: 500,
    })
    this.#centrifuge.setSigner(this.tenderlyFork.signer)
  }

  async cleanup() {
    if (process.env.DEBUG === 'true') {
      console.log('DEBUG is true, RPC endpoint will not be deleted', this.tenderlyFork.rpcUrl)
      return
    }
    if (this.tenderlyFork) {
      return this.tenderlyFork.deleteTenderlyRpcEndpoint()
    }
  }
}

export const context = new TestContext()

export const mochaHooks = {
  async beforeAll(this: Mocha.Context & TestContext) {
    this.timeout(30000) // Increase timeout for setup
    await context.initialize()
    this.context = context as TestContext
  },
  async afterAll(this: Mocha.Context & TestContext) {
    await context.cleanup()
  },
}
