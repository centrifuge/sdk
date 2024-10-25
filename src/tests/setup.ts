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
  public allTestsSucceeded = true

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
    if (this.tenderlyFork && this.allTestsSucceeded) {
      await this.tenderlyFork.deleteTenderlyRpcEndpoint()
    }
    console.log('A test has failed, RPC endpoint will not be deleted', this.tenderlyFork.rpcUrl)
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
  afterEach: async function (this: Mocha.Context & TestContext) {
    // TODO: only keep the vn alive if a test involving a query/tx has failed
    if (this.currentTest?.state === 'failed') {
      this.context.allTestsSucceeded = false
    }
  },
  afterAll: async function (this: Mocha.Context & TestContext) {
    await testContext.cleanup()
  },
}
