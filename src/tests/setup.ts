import { Centrifuge } from '../Centrifuge.js'
import { TenderlyFork } from './tenderly.js'
import { sepolia } from 'viem/chains'

declare global {
  namespace Mocha {
    interface Context {
      context: TestContext & TestContext
    }
  }
}

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
    this.centrifuge.setSigner(this.tenderlyFork.account)
  }

  async cleanup() {
    if (this.tenderlyFork) {
      await this.tenderlyFork.deleteTenderlyRpcEndpoint()
    }
  }
}

export function withContext(fn: (this: Mocha.Context & { context: TestContext }) => Promise<void>) {
  return function (this: Mocha.Context) {
    return fn.call(this)
  }
}

const testContext = new TestContext()

export const mochaHooks = {
  beforeAll: async function (this: Mocha.Context & TestContext) {
    this.timeout(30000) // Increase timeout for setup
    await testContext.initialize()
    this.context = testContext as TestContext
  },

  afterAll: async function (this: Mocha.Context & TestContext) {
    await testContext.cleanup()
  },
}
