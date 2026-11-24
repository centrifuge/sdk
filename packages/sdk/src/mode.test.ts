import { expect } from 'chai'
import { firstValueFrom, of, Subject } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from './Centrifuge.js'
import { GraphqlDataSource, type DataSource } from './data/DataSource.js'
import {
  CentrifugeError,
  DeploymentVerificationError,
  PolicyDeniedError,
  PoolMigratingError,
  TxPreparationError,
  WalletRequiredError,
} from './errors.js'
import { LocalBuildStrategy, type PrepareOutcome, type TxStrategy } from './tx/TxStrategy.js'

const stubDataSource: DataSource = {
  query: () => of({}),
}

const stubTxStrategy: TxStrategy = {
  prepare: () => of({ route: 'local', built: {} } as unknown as PrepareOutcome),
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('SDK transports', () => {
  it('defaults to the GraphQL data source and the local build strategy', () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    expect(centrifuge._dataSource).to.be.instanceOf(GraphqlDataSource)
    expect(centrifuge._txStrategy).to.be.instanceOf(LocalBuildStrategy)
  })

  it('advertises no mode flag: config carries only the seams', () => {
    // There is no `mode` on the configuration surface at all, so a caller
    // cannot ask for a transport the public SDK does not ship.
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    expect(Object.keys(centrifuge.config)).to.not.include('mode')
    expect((centrifuge.config as Record<string, unknown>).mode).to.equal(undefined)
  })

  it('targets public-api by default (v3.3 Phase 1)', () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    expect((centrifuge._dataSource as GraphqlDataSource).target).to.equal('public-api')
  })

  it('honours an explicit api-v3 target', () => {
    const centrifuge = new Centrifuge({ environment: 'testnet', graphqlTarget: 'api-v3' })
    expect((centrifuge._dataSource as GraphqlDataSource).target).to.equal('api-v3')
  })

  describe('catalogue entries under the default target', () => {
    it('serves deployments from public-api, one row per chain and version', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(centrifuge as any, '_executeGraphql').resolves({
        deployments: {
          nodes: [
            { centrifugeId: '1', chainId: 11155111, registryVersion: '3.2' },
            { centrifugeId: '1', chainId: 11155111, registryVersion: '3.3' },
          ],
        },
      })

      expect(await centrifuge.deployments()).to.deep.equal([
        { centrifugeId: '1', chainId: '11155111', protocolVersion: '3.2' },
        { centrifugeId: '1', chainId: '11155111', protocolVersion: '3.3' },
      ])
    })

    it('serves the same entry when the api-v3 target is selected explicitly', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet', graphqlTarget: 'api-v3' })
      const execute = sinon
        .stub(centrifuge as any, '_executeGraphql')
        .resolves({ tokenInstanceSnapshots: { items: [] } })

      const result = await centrifuge._queryData('sharePricesReport', { tokenIds: [] })

      expect(execute.calledOnce).to.equal(true)
      expect(execute.firstCall.args[0]).to.contain('tokenInstanceSnapshots')
      expect(result).to.deep.equal({ tokenInstanceSnapshots: { items: [] } })
    })
  })

  it('uses both injected seams when both are supplied', () => {
    const centrifuge = new Centrifuge({
      environment: 'testnet',
      dataSource: stubDataSource,
      txStrategy: stubTxStrategy,
    })
    expect(centrifuge._dataSource).to.equal(stubDataSource)
    expect(centrifuge._txStrategy).to.equal(stubTxStrategy)
  })

  it('resolves the seams independently, each falling back to its own default', () => {
    // The two seams are orthogonal: reads from a backend with wallet-signed
    // writes (and the reverse) are legitimate configurations, so supplying one
    // must not be a construction error nor silently replace the other.
    const readsOnly = new Centrifuge({ environment: 'testnet', dataSource: stubDataSource })
    expect(readsOnly._dataSource).to.equal(stubDataSource)
    expect(readsOnly._txStrategy).to.be.instanceOf(LocalBuildStrategy)

    const writesOnly = new Centrifuge({ environment: 'testnet', txStrategy: stubTxStrategy })
    expect(writesOnly._dataSource).to.be.instanceOf(GraphqlDataSource)
    expect(writesOnly._txStrategy).to.equal(stubTxStrategy)
  })

  it('keeps the graphqlTarget default when a txStrategy alone is injected', () => {
    // `graphqlTarget` is orthogonal to the seams and keeps its 'public-api'
    // default no matter which seam is supplied.
    const centrifuge = new Centrifuge({ environment: 'testnet', txStrategy: stubTxStrategy })
    expect((centrifuge._dataSource as GraphqlDataSource).target).to.equal('public-api')
  })

  it('throws WalletRequiredError when a transaction is awaited without a signer', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    const tx = centrifuge._transact(async function* () {
      throw new Error('should not get here')
    }, 1)
    let error: unknown
    try {
      await tx
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(WalletRequiredError)
    expect((error as Error).message).to.contain('Signer not set')
  })

  describe('_queryData', () => {
    it('routes reads through the data source and applies postProcess', async () => {
      let calls = 0
      const dataSource: DataSource = {
        query: (name, vars) => {
          calls++
          return of({ name, vars })
        },
      }
      const centrifuge = new Centrifuge({
        environment: 'testnet',
        dataSource,
        txStrategy: stubTxStrategy,
      })
      const result = await centrifuge._queryData<{ name: string; vars: any }, string>(
        'blockchains',
        { a: 1 },
        (data: { name: string; vars: any }) => `${data.name}:${data.vars.a}`
      )
      expect(result).to.equal('blockchains:1')
      expect(calls).to.equal(1)
    })

    it('refetches when the data source emits an invalidation', async () => {
      let calls = 0
      const invalidations = new Subject<void>()
      const dataSource: DataSource = {
        query: () => {
          calls++
          return of(calls)
        },
        invalidations$: () => invalidations,
      }
      const centrifuge = new Centrifuge({
        environment: 'testnet',
        dataSource,
        txStrategy: stubTxStrategy,
      })
      const values: number[] = []
      const subscription = centrifuge._queryData<number>('blockchains').subscribe((value) => values.push(value))
      await wait(10)
      expect(calls).to.equal(1)
      invalidations.next()
      await wait(10)
      expect(calls).to.equal(2)
      expect(values).to.deep.equal([1, 2])
      subscription.unsubscribe()
    })
  })

  describe('LocalBuildStrategy', () => {
    it('rejects a payload that is not a Transaction', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      const strategy = new LocalBuildStrategy(centrifuge)
      let error: unknown
      try {
        await firstValueFrom(strategy.prepare({ action: 'updatePoolMetadata', poolId: '1', payload: 42 }, {}))
      } catch (e) {
        error = e
      }
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.contain('expected `payload` to be a Transaction')
    })
  })
})

describe('typed errors', () => {
  it('extend CentrifugeError and carry their class name', () => {
    const errors = [
      new WalletRequiredError(),
      new PoolMigratingError('pool is migrating', '281474976710657'),
      new TxPreparationError('unsupported', 'UNSUPPORTED_ACTION'),
      new PolicyDeniedError('denied'),
      new DeploymentVerificationError('mismatch', { chainId: 1, protocolVersion: 'v3.1', field: 'hub' }),
    ]
    for (const error of errors) {
      expect(error).to.be.instanceOf(Error)
      expect(error).to.be.instanceOf(CentrifugeError)
      expect(error.name).to.equal(error.constructor.name)
    }
  })

  it('carry their typed context', () => {
    expect(new WalletRequiredError().message).to.equal('Signer not set')
    expect(new PoolMigratingError('paused', '1').poolId).to.equal('1')
    expect(new TxPreparationError('unknown chain', 'UNKNOWN_CHAIN').code).to.equal('UNKNOWN_CHAIN')
    expect(new PolicyDeniedError('denied').violations).to.deep.equal([])
    expect(new PolicyDeniedError('denied', [{ rule: 'x' }]).violations).to.deep.equal([{ rule: 'x' }])
    const deploymentError = new DeploymentVerificationError('mismatch', {
      chainId: 1,
      protocolVersion: 'v3.1',
      field: 'hub',
    })
    expect(deploymentError.chainId).to.equal(1)
    expect(deploymentError.protocolVersion).to.equal('v3.1')
    expect(deploymentError.field).to.equal('hub')
  })
})
