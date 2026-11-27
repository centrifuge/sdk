import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { ContractFunctionRevertedError, decodeFunctionData } from 'viem'
import {
  migrationBuilders,
  resolveMigrationChain,
  resolveMigrationContext,
  V33_MIGRATION_ABI_V3_3,
} from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { MessageTypeV3_3 } from '../types/transaction.js'
import { HexString } from '../types/index.js'
import { simulatingClient, stubChain } from '../tests/utils.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import {
  buildMigrationOperation,
  migrationOperationChain,
  migrationOperationMessages,
  migrationRecordName,
  migrationRelayTargets,
  MigrationSimulationError,
  worklistSnapshot,
  type MigrationOperation,
} from './PoolMigration.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId } from '../utils/types.js'

const poolId = PoolId.from(1, 9)
const SPOKE = 2
const signer = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as HexString
const SC_ID = '0x00010000000000010009000000000001'

function setup() {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  sinon
    .stub(centrifuge as any, '_poolRows')
    .returns(of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'migrating' }]))
  stubChain(centrifuge)
  const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: signer })
  return { centrifuge, pool: new Pool(centrifuge, poolId), build }
}

const facade = resolveMigrationChain(1, { environment: 'testnet' }).migration

describe('Pool.migrationStep', () => {
  afterEach(() => sinon.restore())

  it('signs each operation on the chain it belongs to', () => {
    expect(migrationOperationChain(poolId, { name: 'initiateMigration' })).to.equal(1)
    expect(
      migrationOperationChain(poolId, {
        name: 'relayFreeze',
        args: { centrifugeId: SPOKE, syncReserves: [], extraGasLimit: '0' },
      })
    ).to.equal(1)
    expect(
      migrationOperationChain(poolId, { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn: 'hub' } })
    ).to.equal(1)
    expect(
      migrationOperationChain(poolId, { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn: 'spoke' } })
    ).to.equal(SPOKE)
    expect(
      migrationOperationChain(poolId, { name: 'lock', args: { centrifugeId: 3, allSpokesQuiescent: true } })
    ).to.equal(3)
  })

  it('prices one relay per named spoke and none toward the hub chain', () => {
    const relay = { protocolVersion: '3.3', type: MessageTypeV3_3.ManagerCallFromHub, poolId }
    expect(
      migrationOperationMessages(poolId, { name: 'relayArm', args: { spokeCentrifugeIds: [1, 2, 3] } })
    ).to.deep.equal({
      2: [relay],
      3: [relay],
    })
    expect(
      migrationOperationMessages(poolId, {
        name: 'relayFreeze',
        args: { centrifugeId: SPOKE, syncReserves: [], extraGasLimit: '0' },
      })
    ).to.deep.equal({ 2: [relay] })
    expect(
      migrationOperationMessages(poolId, { name: 'activate', args: { restoreGas: '1', spokeCentrifugeIds: [1, 2] } })
    ).to.deep.equal({
      2: [relay],
    })
    const onboardHub: MigrationOperation = {
      name: 'onboardHub',
      args: { input: { v32Admins: [], holdings: [], epochAssetIds: [], grants: [], noV32Spokes: true } },
    }
    expect(migrationOperationMessages(poolId, onboardHub, [1, 2, 3])).to.deep.equal({ 2: [relay], 3: [relay] })
    expect(migrationOperationMessages(poolId, onboardHub)).to.deep.equal({})
    expect(
      migrationOperationMessages(poolId, { name: 'lock', args: { centrifugeId: 2, allSpokesQuiescent: false } })
    ).to.deep.equal({})
  })

  it('prices the hub onboard a relay toward each remote armed spoke, read off the hub facade', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    sinon
      .stub(centrifuge as any, '_poolRows')
      .returns(of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'migrating' }]))
    const reads: { functionName: string; args: unknown[] }[] = []
    stubChain(centrifuge, {
      readContract: async (call: { functionName: string; args: unknown[] }) => {
        reads.push(call)
        if (call.functionName === 'armedSpokes') return [1, SPOKE, 3]
        throw new Error(`unexpected read ${call.functionName}`)
      },
    })
    const pool = new Pool(centrifuge, poolId)
    const built = await centrifuge.buildOnly(
      pool.migrationStep({
        name: 'onboardHub',
        args: { input: { v32Admins: [], holdings: [], epochAssetIds: [], grants: [], noV32Spokes: false } },
      }),
      { fromAddress: signer }
    )
    const relay = { protocolVersion: '3.3', type: MessageTypeV3_3.ManagerCallFromHub, poolId }
    expect(built.messages).to.deep.equal({ [SPOKE]: [relay], 3: [relay] })
    expect(reads.find((call) => call.functionName === 'armedSpokes')!.args).to.deep.equal([poolId.raw])
  })

  it('reads no armed spokes for an operation that names its own targets', async () => {
    const readContract = sinon.stub().rejects(new Error('no read expected'))
    expect(
      await migrationRelayTargets(
        { readContract },
        poolId,
        { name: 'relayArm', args: { spokeCentrifugeIds: [2] } },
        'testnet'
      )
    ).to.deep.equal([])
    expect(readContract.called).to.equal(false)
  })

  it('builds the protocol builders bytes with the signer as refund, on the facade', async () => {
    const { pool, build } = setup()
    const operation: MigrationOperation = {
      name: 'relayFreeze',
      args: { centrifugeId: SPOKE, syncReserves: [{ scId: SC_ID, asset: USDC }], extraGasLimit: '300000' },
    }
    const built = await build(pool.migrationStep(operation))
    const expected = migrationBuilders.relayFreeze(
      resolveMigrationContext(poolId.raw.toString(), { environment: 'testnet' }),
      {
        poolId: poolId.raw.toString(),
        centrifugeId: String(SPOKE),
        syncReserves: [{ scId: SC_ID, asset: USDC }],
        extraGasLimit: '300000',
        refundAddress: signer,
      }
    )
    expect(built.to.toLowerCase()).to.equal(facade.toLowerCase())
    expect(built.data).to.equal(expected.data)
    expect(built.value).to.equal(0n)
    expect(decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: built.data }).functionName).to.equal('relayFreeze')
    expect(built.messages).to.deep.equal({
      [SPOKE]: [{ protocolVersion: '3.3', type: MessageTypeV3_3.ManagerCallFromHub, poolId }],
    })
  })

  it('always installs the breaker on activate and forwards a caller value', () => {
    const built = buildMigrationOperation({
      environment: 'testnet',
      poolId,
      signedOn: 1,
      refundAddress: signer,
      operation: { name: 'activate', args: { restoreGas: '250000', spokeCentrifugeIds: [2], value: 123n } },
    })
    const decoded = decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: built.data })
    expect(decoded.functionName).to.equal('activate')
    expect(
      (decoded.args as unknown as [bigint, { installBridgeCircuitBreaker: boolean }])[1].installBridgeCircuitBreaker
    ).to.equal(true)
    expect(built.value).to.equal(123n)
  })

  it('builds lock on the chain it locks and installPoolAdapters on either side of the lane, toward the other end', () => {
    const lock = buildMigrationOperation({
      environment: 'testnet',
      poolId,
      signedOn: 3,
      refundAddress: signer,
      operation: { name: 'lock', args: { centrifugeId: 3, allSpokesQuiescent: true } },
    })
    expect(decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: lock.data }).args).to.deep.equal([true])
    const side = (signOn: 'hub' | 'spoke') => {
      const operation: MigrationOperation = { name: 'installPoolAdapters', args: { centrifugeId: SPOKE, signOn } }
      const built = buildMigrationOperation({
        environment: 'testnet',
        poolId,
        signedOn: migrationOperationChain(poolId, operation),
        refundAddress: signer,
        operation,
      })
      return decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: built.data }).args
    }
    expect(side('hub')).to.deep.equal([poolId.raw, SPOKE])
    expect(side('spoke')).to.deep.equal([poolId.raw, 1])
  })

  it("names a revert the simulation left a bare selector, such as the Gateway's NotEnoughGas", () => {
    const bare = new ContractFunctionRevertedError({ abi: [], data: '0xdd629f86', functionName: 'relayArm' })
    const error = new MigrationSimulationError('relayArm', bare)
    expect(error.message).to.equal('Migration operation relayArm fails in simulation: NotEnoughGas()')
    expect((error.reason as Error).message).to.equal('NotEnoughGas()')

    const unknown = new ContractFunctionRevertedError({ abi: [], data: '0x12345678', functionName: 'relayArm' })
    expect(new MigrationSimulationError('relayArm', unknown).reason).to.equal(unknown)
    const plain = new Error('OffboardAlreadyStarted')
    expect(new MigrationSimulationError('relayOffboard', plain).reason).to.equal(plain)
  })

  it('names the simulation failure and never reaches signing', () => {
    const error = new MigrationSimulationError('relayOffboard', new Error('OffboardAlreadyStarted'))
    expect(error.message).to.contain('relayOffboard')
    expect(error.message).to.contain('OffboardAlreadyStarted')
    expect(error.name).to.equal('MigrationSimulationError')
  })
})

describe('Pool.pinMigrationRecord', () => {
  afterEach(() => sinon.restore())

  it('pins under {environment}-migration-{poolId} and refuses another pool', async () => {
    const pinJson = sinon.stub().resolves('bafyrecord')
    const centrifuge = new Centrifuge({ environment: 'testnet', pinJson })
    const pool = new Pool(centrifuge, poolId)
    const record = {
      poolId: poolId.raw.toString(),
      centrifugeId: SPOKE,
      step: 'unlinkVaults' as const,
      worklist: worklistSnapshot([
        {
          centrifugeId: SPOKE,
          shareClassId: SC_ID,
          assetId: AssetId.from(SPOKE, 1),
          pendingDeposit: new Balance(10n, 6),
          pendingRedeem: new Balance(0n, 18),
          queuedInvest: new Balance(0n, 6),
          queuedRedeem: new Balance(5n, 18),
        },
      ]),
      acceptance: { operator: signer, acceptedAt: '2026-11-03T12:00:00.000Z' },
      overrides: {},
      planInputBlocks: { '1': 12004859, '2': 50894934 },
    }
    expect(await pool.pinMigrationRecord(record)).to.equal('bafyrecord')
    expect(pinJson.firstCall.args).to.deep.equal([record, migrationRecordName('testnet', poolId)])
    expect(record.worklist[0]).to.deep.equal({
      centrifugeId: SPOKE,
      shareClassId: SC_ID,
      assetId: AssetId.from(SPOKE, 1).raw.toString(),
      pendingDeposit: '10',
      pendingRedeem: '0',
      queuedInvest: '0',
      queuedRedeem: '5',
    })
    let refused: unknown
    try {
      await pool.pinMigrationRecord({ ...record, poolId: '7' })
    } catch (e) {
      refused = e
    }
    expect(String(refused)).to.contain('names pool 7')
  })
})

describe('Pool.migrationBundle', () => {
  afterEach(() => sinon.restore())

  const FEE = 7n
  const freeze = (centrifugeId: number): MigrationOperation => ({
    name: 'relayFreeze',
    args: { centrifugeId, syncReserves: [], extraGasLimit: '300000' },
  })
  const three: MigrationOperation[] = [
    freeze(SPOKE),
    freeze(3),
    { name: 'activate', args: { restoreGas: '250000', spokeCentrifugeIds: [1], value: 5n } },
  ]

  function signing(results: { status: 'success' | 'failure'; error?: Error }[][]) {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    sinon
      .stub(centrifuge as any, '_poolRows')
      .returns(of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'migrating' }]))
    sinon.stub(centrifuge as any, '_estimate').resolves(FEE)
    const simulateCalls = sinon.stub()
    results.forEach((answer, i) => simulateCalls.onCall(i).resolves({ results: answer }))
    stubChain(centrifuge, simulatingClient(simulateCalls))
    const sent: { to: string; data: HexString; value: string }[] = []
    centrifuge.setSigner({
      request: async ({ method, params }: { method: string; params?: any[] }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [signer]
        if (method === 'eth_chainId') return `0x${(11155111).toString(16)}`
        if (method === 'eth_sendTransaction') {
          sent.push(params![0])
          throw new Error('stop after send')
        }
        throw new Error(`unexpected signer request: ${method}`)
      },
    } as any)
    return { pool: new Pool(centrifuge, poolId), simulateCalls, sent }
  }

  async function errorOf(promise: PromiseLike<unknown>) {
    try {
      await promise
    } catch (e) {
      return e as Error
    }
    throw new Error('expected a rejection')
  }

  it("sends three hub operations as one facade multicall whose value is the entries' sum", async () => {
    const ok = { status: 'success' as const }
    const { pool, simulateCalls, sent } = signing([[ok, ok, ok], [ok]])
    expect((await errorOf(pool.migrationBundle(three))).message).to.contain('stop after send')

    expect(sent).to.have.length(1)
    expect(sent[0]!.to.toLowerCase()).to.equal(facade.toLowerCase())
    const decoded = decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: sent[0]!.data })
    expect(decoded.functionName).to.equal('multicall')
    const entries = (decoded.args as unknown as [{ data: HexString; value: bigint }[]])[0]
    const alone = three.map((operation) =>
      buildMigrationOperation({ environment: 'testnet', poolId, signedOn: 1, refundAddress: signer, operation })
    )
    expect(entries.map((e) => e.data)).to.deep.equal(alone.map((b) => b.data))
    expect(entries.map((e) => e.value)).to.deep.equal([FEE, FEE, 5n])
    expect(BigInt(sent[0]!.value)).to.equal(FEE + FEE + 5n)

    const [entryCalls, bundleCalls] = simulateCalls.getCalls().map((call) => call.args[0])
    expect(entryCalls.account.toLowerCase()).to.equal(signer)
    expect(entryCalls.calls.map((c: any) => [c.data, c.value])).to.deep.equal(entries.map((e) => [e.data, e.value]))
    expect(bundleCalls.calls).to.deep.equal([{ to: facade, data: sent[0]!.data, value: FEE + FEE + 5n }])
  })

  it('simulates a step with the relay fee it will pay, and sends that same value', async () => {
    const ok = { status: 'success' as const }
    const { pool, simulateCalls, sent } = signing([[ok]])
    const arm: MigrationOperation = { name: 'relayArm', args: { spokeCentrifugeIds: [1, SPOKE] } }
    expect((await errorOf(pool.migrationStep(arm))).message).to.contain('stop after send')

    const [simulated] = simulateCalls.getCalls().map((call) => call.args[0].calls)
    expect(simulated).to.have.length(1)
    expect(simulated[0].value).to.equal(FEE)
    expect(BigInt(sent[0]!.value)).to.equal(FEE)
  })

  it('simulates a step that relays nothing with no value', async () => {
    const ok = { status: 'success' as const }
    const { pool, simulateCalls } = signing([[ok]])
    await errorOf(pool.migrationStep({ name: 'initiateMigration' }))
    expect(simulateCalls.firstCall.args[0].calls[0].value ?? 0n).to.equal(0n)
  })

  it('declares the gas a caller passes on migrationStep and migrationBundle, and leaves it to the wallet without one', async () => {
    const ok = { status: 'success' as const }
    const gas = { gas: 15_000_000n }

    const step = signing([[ok]])
    await errorOf(step.pool.migrationStep(freeze(SPOKE), gas))
    const bundle = signing([[ok, ok, ok], [ok]])
    await errorOf(bundle.pool.migrationBundle(three, gas))
    const single = signing([[ok]])
    await errorOf(single.pool.migrationBundle([freeze(SPOKE)], gas))
    for (const { sent } of [step, bundle, single]) {
      expect(sent).to.have.length(1)
      expect(sent[0]).to.include({ gas: '0xe4e1c0' })
    }

    const stepWithout = signing([[ok]])
    await errorOf(stepWithout.pool.migrationStep(freeze(SPOKE)))
    const bundleWithout = signing([[ok, ok, ok], [ok]])
    await errorOf(bundleWithout.pool.migrationBundle(three))
    for (const { sent } of [stepWithout, bundleWithout]) {
      expect(sent).to.have.length(1)
      expect(sent[0]).to.not.have.property('gas')
    }
  })

  it('builds the same transaction with or without a gas option, since the consumer sends it', async () => {
    const { pool, build } = setup()
    sinon.stub((pool as any)._root, '_estimate').resolves(FEE)
    expect(await build(pool.migrationBundle(three, { gas: 15_000_000n }))).to.deep.equal(
      await build(pool.migrationBundle(three))
    )
  })

  it('refuses a bundle with a failing entry before signing, naming the entry and its place', async () => {
    const ok = { status: 'success' as const }
    const { pool, simulateCalls, sent } = signing([
      [ok, { status: 'failure', error: new Error('OffboardAlreadyStarted') }, ok],
    ])
    const error = await errorOf(pool.migrationBundle(three))
    expect(error).to.be.instanceOf(MigrationSimulationError)
    expect(error).to.include({ operation: 'relayFreeze' })
    expect((error as MigrationSimulationError).position).to.deep.equal({ index: 2, count: 3 })
    expect(error.message).to.contain('entry 2 of 3')
    expect(error.message).to.contain('OffboardAlreadyStarted')
    expect(simulateCalls.callCount).to.equal(1)
    expect(sent).to.have.length(0)
  })

  it('refuses a bundle whose entries pass alone but whose multicall fails, before signing', async () => {
    const ok = { status: 'success' as const }
    const { pool, sent } = signing([[ok, ok, ok], [{ status: 'failure', error: new Error('ValueMismatch') }]])
    const error = await errorOf(pool.migrationBundle(three))
    expect(error).to.be.instanceOf(MigrationSimulationError)
    expect(error).to.include({ operation: 'multicall' })
    expect(error.message).to.contain('ValueMismatch')
    expect(sent).to.have.length(0)
  })

  it('builds a bundle with its fees priced into the value and no messages left for the consumer to price', async () => {
    const { pool, build } = setup()
    sinon.stub((pool as any)._root, '_estimate').resolves(FEE)
    const built = await build(pool.migrationBundle(three))
    expect(built.to.toLowerCase()).to.equal(facade.toLowerCase())
    expect(decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: built.data }).functionName).to.equal('multicall')
    expect(built.value).to.equal(FEE + FEE + 5n)
    expect(built.messages).to.equal(undefined)
  })

  it('sends a one-operation bundle as the plain call, byte-equal to migrationStep', async () => {
    const { pool, build } = setup()
    sinon.stub((pool as any)._root, '_estimate').resolves(FEE)
    const bundled = await build(pool.migrationBundle([freeze(SPOKE)]))
    const step = await build(pool.migrationStep(freeze(SPOKE)))
    expect(bundled).to.deep.equal(step)
    expect(decodeFunctionData({ abi: V33_MIGRATION_ABI_V3_3, data: bundled.data }).functionName).to.equal('relayFreeze')
  })

  it('refuses an operation signed off the hub chain and an empty bundle', () => {
    const { pool } = setup()
    expect(() =>
      pool.migrationBundle([freeze(SPOKE), { name: 'lock', args: { centrifugeId: 3, allSpokesQuiescent: true } }])
    ).to.throw(/lock is not signed on the hub chain 1/)
    expect(() => pool.migrationBundle([])).to.throw(/at least one operation/)
  })

  it('refuses lock and forceRelease in a bundle of two or more, since the facade would be their sender', () => {
    const { pool } = setup()
    const hubLock: MigrationOperation = { name: 'lock', args: { centrifugeId: 1, allSpokesQuiescent: true } }
    expect(() => pool.migrationBundle([freeze(SPOKE), hubLock])).to.throw(/lock is checked against the lock admin/)
    expect(() => pool.migrationBundle([{ name: 'forceRelease' }, freeze(SPOKE)])).to.throw(
      /forceRelease is checked against the lock admin/
    )
  })
})
