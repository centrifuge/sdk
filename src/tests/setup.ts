import { Centrifuge } from '../Centrifuge.js'
import { TenderlyFork } from './tenderly.js'
import { sepolia } from 'viem/chains'

class TestContext {
  public centrifuge!: Centrifuge
  public tenderlyFork!: TenderlyFork

  async initialize() {
    this.tenderlyFork = await TenderlyFork.create(sepolia)
    this.centrifuge = new Centrifuge({
      environment: 'demo',
      rpcUrls: {
        11155111: this.tenderlyFork.rpcUrl,
      },
    })
    this.centrifuge.setSigner(this.tenderlyFork.signer)
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
  beforeAll: async function (this: Mocha.Context & TestContext) {
    this.timeout(30000) // Increase timeout for setup
    await context.initialize()
    this.context = context as TestContext
  },
  afterAll: async function (this: Mocha.Context & TestContext) {
    await context.cleanup()
  },
}
