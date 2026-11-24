import { ABIS_V3_2, type OffboardSpokeInput, type OnboardSpokeInput } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import {
  MigrationInputsDerivation,
  type MigrationInputsReader,
  type MigrationSpokeInventory,
} from './MigrationInputs.js'
import { deriveMigrationHubInputs, restoredSpokeInventory } from './migrationInputsRead.js'
import { LiveDriver } from './migrationPlanRead.js'
import { Centrifuge } from '../Centrifuge.js'
import { Pool } from './Pool.js'
import { makeThenable } from '../utils/rx.js'
import { of } from 'rxjs'
import { MigrationRecords, rampConfigHash } from './migrationRecords.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString
const lower = (a: unknown) => String(a).toLowerCase()

const v32 = {
  spoke: addr(0x32_01),
  gateway: addr(0x32_02),
  holdings: addr(0x32_03),
  hubRegistry: addr(0x32_04),
  balanceSheet: addr(0x32_05),
  syncManager: addr(0x32_06),
  vaultRegistry: addr(0x32_07),
  poolEscrowFactory: addr(0x32_08),
  shareClassManager: addr(0x32_09),
  asyncRequestManager: addr(0x32_0a),
  batchRequestManager: addr(0x32_0b),
}
const v33 = {
  asyncRequestManager: addr(0x33_0a),
  syncManager: addr(0x33_06),
  asyncVaultFactory: addr(0x33_0c),
  syncDepositVaultFactory: addr(0x33_0d),
  onOffRampFactory: addr(0x33_0e),
}

const SPOKE = 2
const POOL = PoolId.from(1, 7)
const sc1 = ShareClassId.from(POOL, 1)
const sc2 = ShareClassId.from(POOL, 2)
const token1 = addr(0x71)
const token2 = addr(0x72)
const usdc = addr(0xa1)
const dai = addr(0xa2)
const facade = addr(0xfa)
const registry33 = addr(0x33_77)
const manager = addr(0xb1)
const ramp = addr(0xb2)
const gatewayManager = addr(0xb3)
const oldHook = addr(0x41)
const newHook = addr(0x42)
const vault1 = addr(0xc1)
const vault2 = addr(0xc2)

type Script = Record<string, (address: HexString, args: readonly unknown[]) => unknown>

function scripted(script: Script): MigrationInputsReader & { calls: string[] } {
  const calls: string[] = []
  return {
    block: 100n,
    calls,
    async read(requested) {
      return requested.map((call) => {
        calls.push(call.functionName)
        const fn = script[call.functionName]
        if (!fn) return { status: 'failure', error: new Error(`unscripted ${call.functionName}`) }
        return { status: 'success', result: fn(call.address, call.args ?? []) }
      })
    },
    async logs() {
      return []
    },
    async hasCode() {
      return false
    },
  }
}

const has = (list: readonly HexString[]) => (who: unknown) => list.some((entry) => lower(entry) === lower(who))

function liveAfterOffboard(): MigrationSpokeInventory {
  return {
    centrifugeId: SPOKE,
    block: 100n,
    scIds: [],
    tokens: [],
    assetIds: [AssetId.from(SPOKE, 1), AssetId.from(SPOKE, 2)],
    assets: [usdc, dai],
    vaults: [],
    unknownVaults: [],
    rotationAssets: [],
    balanceSheetManagers: [],
    gatewayManagers: [],
    grantedRamps: [],
    syncReserves: [],
    assetPrices: [],
    hookGrants: [],
    notCarried: { balanceSheetManagers: [], gatewayManagers: [] },
    sources: {
      scIds: 'chain',
      assets: 'chain',
      vaults: 'idxchain',
      rotationAssets: 'chain',
      balanceSheetManagers: 'idxchain',
      gatewayManagers: 'idxchain',
      grantedRamps: 'chain',
      syncReserves: 'chain',
      assetPrices: 'chain',
      hookGrants: 'skipped',
    },
  }
}

function recordsScript(phase: number, extra: Script = {}): Script {
  return {
    spokePhase: () => phase,
    removedSpokeManagers: () => [manager, ramp],
    removedGatewayManagers: () => [gatewayManager],
    spokeScIds: () => [sc1.raw, sc2.raw],
    syncKeys: () => [{ scId: sc1.raw, asset: usdc }],
    assetRotated: (_, [, asset]) => lower(asset) === lower(usdc),
    shareToken: (_, [, scId]) => (lower(scId) === lower(sc1.raw) ? token1 : token2),
    tokenLinked: (_, [, scId]) => lower(scId) === lower(sc1.raw),
    recordedOldHook: () => oldHook,
    hook: () => newHook,
    poolId: (address) => (has([ramp])(address) ? POOL.raw : 0n),
    balanceSheet: () => v32.balanceSheet,
    relayer: () => false,
    ...extra,
  }
}

function setup(script: Script, options: { migration?: HexString } = { migration: facade }) {
  const reader = scripted(script)
  const derivation = new MigrationInputsDerivation(reader, v32, v33, ABIS_V3_2 as any, SPOKE, options)
  return { reader, derivation, records: new MigrationRecords(reader, facade, POOL) }
}

describe('MigrationRecords', () => {
  afterEach(() => sinon.restore())

  describe('restoreOffboarded', () => {
    it('gives back the v3.2 managers, ramps, classes, rotations and sync keys a spoke lost to its offboard', async () => {
      const { derivation, records } = setup(recordsScript(3))
      const live = { ...liveAfterOffboard(), balanceSheetManagers: [addr(0xdd)] }
      const restored = await records.restoreOffboarded(derivation, live, 3)

      expect(restored.balanceSheetManagers).to.deep.equal([manager, ramp])
      expect(restored.gatewayManagers).to.deep.equal([gatewayManager])
      expect(restored.grantedRamps).to.deep.equal([ramp])
      expect(restored.scIds.map((scId) => scId.raw)).to.deep.equal([sc1.raw, sc2.raw])
      expect(restored.tokens).to.deep.equal([token1, token2])
      expect(restored.rotationAssets).to.deep.equal([usdc])
      expect(restored.syncReserves).to.deep.equal([{ scId: sc1.raw, asset: usdc }])
    })

    it('unites the live managers with the removed ones while the spoke is only Frozen', async () => {
      const { derivation, records } = setup(recordsScript(2))
      const live = { ...liveAfterOffboard(), balanceSheetManagers: [addr(0xdd), manager] }
      const restored = await records.restoreOffboarded(derivation, live, 2)

      expect(restored.balanceSheetManagers).to.deep.equal([addr(0xdd), manager, ramp])
    })

    it('keeps the live classes when the freeze left no class record', async () => {
      const { derivation, records } = setup(recordsScript(2, { spokeScIds: () => [] }))
      const live = { ...liveAfterOffboard(), scIds: [sc2], tokens: [token2] }
      const restored = await records.restoreOffboarded(derivation, live, 2)

      expect(restored.scIds).to.deep.equal([sc2])
      expect(restored.tokens).to.deep.equal([token2])
    })

    it('names the live managers the offboard did not remove, with a warning, once Offboarded', async () => {
      const warn = sinon.stub(console, 'warn')
      const { derivation, records } = setup(recordsScript(3))
      const live = {
        ...liveAfterOffboard(),
        balanceSheetManagers: [addr(0xdd), manager],
        gatewayManagers: [addr(0xee), gatewayManager],
      }
      const restored = await records.restoreOffboarded(derivation, live, 3)

      expect(restored.balanceSheetManagers).to.deep.equal([manager, ramp])
      expect(restored.notCarried).to.deep.equal({ balanceSheetManagers: [addr(0xdd)], gatewayManagers: [addr(0xee)] })
      expect(warn.callCount).to.equal(2)
      expect(String(warn.firstCall.args[0])).to.contain('balance sheet').and.contain(addr(0xdd))
      expect(String(warn.secondCall.args[0])).to.contain('gateway').and.contain(addr(0xee))
      warn.restore()

      const quiet = sinon.stub(console, 'warn')
      const frozen = setup(recordsScript(2))
      const union = await frozen.records.restoreOffboarded(frozen.derivation, live, 2)
      expect(union.notCarried).to.deep.equal({ balanceSheetManagers: [], gatewayManagers: [] })
      expect(quiet.called).to.equal(false)
      quiet.restore()
    })

    it('marks every list the facade record filled as coming from the record', async () => {
      const { derivation, records } = setup(recordsScript(3))
      const restored = await records.restoreOffboarded(derivation, liveAfterOffboard(), 3)
      expect(restored.sources).to.include({
        balanceSheetManagers: 'record',
        gatewayManagers: 'record',
        scIds: 'record',
        rotationAssets: 'record',
        syncReserves: 'record',
      })
      expect(restored.sources.vaults).to.equal('idxchain')

      const empty = setup(recordsScript(2, { spokeScIds: () => [], syncKeys: () => [], assetRotated: () => false }))
      const kept = await empty.records.restoreOffboarded(empty.derivation, liveAfterOffboard(), 2)
      expect(kept.sources).to.include({ balanceSheetManagers: 'record', scIds: 'chain', syncReserves: 'chain' })
    })

    it('adds a recorded sync key only once', async () => {
      const { derivation, records } = setup(recordsScript(3))
      const live = { ...liveAfterOffboard(), syncReserves: [{ scId: sc1.raw.toUpperCase(), asset: usdc }] }
      const restored = await records.restoreOffboarded(derivation, live, 3)

      expect(restored.syncReserves).to.have.length(1)
    })
  })

  it('reads the grants off the recorded pre-rotation hook once LinkTokens has moved the token', async () => {
    const { derivation, records } = setup(recordsScript(3))
    expect(await records.hooksBeforeRotation(derivation, [sc1, sc2], [token1, token2])).to.deep.equal([
      oldHook,
      newHook,
    ])
  })

  describe('restoredSpokeInventory', () => {
    const fake = (phase: number, options: { migration?: HexString }) => {
      const { reader, derivation } = setup(recordsScript(phase), options)
      derivation.spokeInventory = async () => liveAfterOffboard()
      return { reader, derivation }
    }

    it('leaves the live derivation alone before the freeze', async () => {
      const { reader, derivation } = fake(1, { migration: facade })
      const inventory = await restoredSpokeInventory(derivation, POOL, 2, {} as any)

      expect(inventory).to.deep.equal(liveAfterOffboard())
      expect(reader.calls).to.deep.equal(['spokePhase'])
    })

    it('reads no record without a migration facade', async () => {
      const { reader, derivation } = fake(3, {})
      await restoredSpokeInventory(derivation, POOL, 2, {} as any)

      expect(reader.calls).to.deep.equal([])
    })

    it('reads the phase once and hands it to the restore', async () => {
      const { reader, derivation } = fake(3, { migration: facade })
      const restore = sinon
        .stub(MigrationRecords.prototype, 'restoreOffboarded')
        .callsFake(async (_derivation, inv) => inv)
      await restoredSpokeInventory(derivation, POOL, 2, {} as any)
      expect(restore.calledOnce).to.equal(true)
      expect(restore.firstCall.args[2]).to.equal(3)
      expect(reader.calls.filter((name) => name === 'spokePhase')).to.have.length(1)
      restore.restore()
    })

    it('restores from the freeze on', async () => {
      const { derivation } = fake(2, { migration: facade })
      const inventory = await restoredSpokeInventory(derivation, POOL, 2, {} as any)

      expect(inventory.scIds.map((scId) => scId.raw)).to.deep.equal([sc1.raw, sc2.raw])
    })
  })

  it('drops the offboard items already done and keeps the whole-spoke totals', async () => {
    const { records } = setup({
      vaultUnlinked: (_, [, vault]) => lower(vault) === lower(vault1),
      assetRotated: (_, [, asset]) => lower(asset) === lower(usdc),
      removedSpokeManagers: () => [manager],
      removedGatewayManagers: () => [],
    })
    const input: OffboardSpokeInput = {
      vaults: [
        { scId: sc1.raw, assetId: '1', vault: vault1 },
        { scId: sc1.raw, assetId: '2', vault: vault2 },
      ],
      assets: [
        { asset: usdc, assetId: '1', scIds: [sc1.raw] },
        { asset: dai, assetId: '2', scIds: [sc1.raw] },
      ],
      balanceSheetManagers: [manager, ramp],
      gatewayManagers: [gatewayManager],
      scIds: [sc1.raw],
      assetIds: ['1', '2'],
      unlinkGas: '0',
      rotateGas: '0',
      managersGas: '0',
      finalizeGas: '0',
      finalize: true,
      totalVaults: '2',
      totalAssets: '2',
      totalManagers: '3',
    }
    const pending = await records.pendingOffboard(input)

    expect(pending.vaults.map((key) => key.vault)).to.deep.equal([vault2])
    expect(pending.assets.map((asset) => asset.asset)).to.deep.equal([dai])
    expect(pending.balanceSheetManagers).to.deep.equal([ramp])
    expect(pending.gatewayManagers).to.deep.equal([gatewayManager])
    expect(pending.scIds).to.deep.equal([sc1.raw])
    expect(pending.assetIds).to.deep.equal(['1', '2'])
    expect([pending.totalVaults, pending.totalAssets, pending.totalManagers]).to.deep.equal(['2', '2', '3'])
  })

  describe('pendingOnboard', () => {
    const configA = '0x01' as HexString
    const configB = '0x02' as HexString
    const seed = (vault: HexString, link: boolean) => ({
      scId: sc1.raw,
      assetId: '1',
      factory: v33.asyncVaultFactory,
      vault,
      link,
    })
    const input = (): OnboardSpokeInput => ({
      scIds: [sc1.raw, sc2.raw],
      seedQueueScIds: [sc1.raw, sc2.raw],
      registerVaults: [seed(vault1, true), seed(vault2, false)],
      configureVaults: [seed(vault1, true), seed(vault2, false)],
      assetPrices: [
        { scId: sc1.raw, assetId: '1' },
        { scId: sc2.raw, assetId: '1' },
      ],
      ramps: [{ scId: sc1.raw, instance: ramp, v32Instance: ramp, extraGasLimit: '0', rampAssets: [usdc] }],
      rampConfigs: [
        { scId: sc1.raw, instance: ramp, v32Instance: ramp, config: configA },
        { scId: sc1.raw, instance: ramp, v32Instance: ramp, config: configB },
      ],
      hookManagers: [{ scId: sc2.raw, hook: newHook, managers: [manager] }],
      linkGas: '0',
      registerGas: '0',
      configureGas: '0',
      hookManagersGas: '0',
      assetPriceGas: '0',
      spokeManagersGas: '0',
      seedGas: '0',
      seedQueueGas: '0',
      finalizeGas: '0',
      seedEscrow: true,
      finalize: true,
      totalTokens: '2',
      totalRegistered: '2',
      totalConfigured: '2',
      totalRamps: '1',
      totalHookGrants: '1',
      totalShareQueues: '2',
      totalAssetPrices: '2',
      totalRampConfigs: '2',
    })
    const doneA = rampConfigHash({ scId: sc1.raw, config: configA })

    it('filters each step against its own record and keeps the totals whole', async () => {
      const { records } = setup({
        tokenLinked: (_, [, scId]) => lower(scId) === lower(sc1.raw),
        shareQueueSeeded: (_, [, scId]) => lower(scId) === lower(sc2.raw),
        assetPriceCopied: (_, [, scId, assetId]) => lower(scId) === lower(sc1.raw) && assetId === 1n,
        vaultRegistered: () => true,
        isLinked: () => false,
        vaultConfigured: (_, [, vault]) => lower(vault) === lower(vault2),
        rampSetup: () => true,
        rampConfigAsserted: (_, [, hash]) => lower(hash) === lower(doneA),
        hookGrantsAsserted: () => false,
        escrowSeeded: () => true,
      })
      const pending = await records.pendingOnboard(input(), registry33)

      expect(pending.scIds).to.deep.equal([sc2.raw])
      expect(pending.seedQueueScIds).to.deep.equal([sc1.raw])
      expect(pending.assetPrices).to.deep.equal([{ scId: sc2.raw, assetId: '1' }])
      expect(pending.registerVaults.map((s) => s.vault)).to.deep.equal([vault1])
      expect(pending.configureVaults.map((s) => s.vault)).to.deep.equal([vault1])
      expect(pending.ramps).to.deep.equal([])
      expect(pending.rampConfigs.map((c) => c.config)).to.deep.equal([configB])
      expect(pending.hookManagers).to.have.length(1)
      expect(pending.seedEscrow).to.equal(false)
      const { totalTokens, totalRegistered, totalConfigured, totalRamps, totalRampConfigs, totalAssetPrices } = pending
      expect([
        totalTokens,
        totalRegistered,
        totalConfigured,
        totalRamps,
        totalRampConfigs,
        totalAssetPrices,
      ]).to.deep.equal(['2', '2', '2', '1', '2', '2'])
    })

    it('keeps a registered vault until the hub has linked it, and drops it once linked', async () => {
      const linked = new Set<string>()
      const { records } = setup({ vaultRegistered: () => true, isLinked: (_, [vault]) => linked.has(lower(vault)) })
      expect((await records.pendingVaultRegistrations([seed(vault1, true)], registry33)).length).to.equal(1)
      linked.add(lower(vault1))
      expect((await records.pendingVaultRegistrations([seed(vault1, true)], registry33)).length).to.equal(0)
    })

    it('keeps a vault the migration has not registered whatever its link', async () => {
      const { records } = setup({ vaultRegistered: () => false, isLinked: () => true })
      expect((await records.pendingVaultRegistrations([seed(vault2, false)], registry33)).length).to.equal(1)
    })

    it('changes nothing on a fresh onboard', async () => {
      const none = () => false
      const { records } = setup({
        tokenLinked: none,
        shareQueueSeeded: none,
        assetPriceCopied: none,
        vaultRegistered: none,
        isLinked: none,
        vaultConfigured: none,
        rampSetup: none,
        rampConfigAsserted: none,
        hookGrantsAsserted: none,
        escrowSeeded: none,
      })
      expect(await records.pendingOnboard(input(), registry33)).to.deep.equal(input())
    })
  })
})

describe('the records in the plan driver and the hub inputs', () => {
  afterEach(() => sinon.restore())
  const SPOKE_CID = 2
  const REGISTRY_33 = addr(0x33_77)

  it('filters the offboard and spoke onboard inputs through the facade records, with the v3.3 registry', async () => {
    const root = new Centrifuge({ environment: 'testnet' })
    const pool = new Pool(root, POOL.toString())
    const offboard = { vaults: [], totalVaults: '0' } as unknown as OffboardSpokeInput
    const onboardSpoke = { scIds: [], totalTokens: '0' } as unknown as OnboardSpokeInput
    sinon.stub(LiveDriver.prototype as any, 'spokeInputs').resolves({ offboard, onboardSpoke })
    sinon.stub(LiveDriver.prototype as any, 'v33').resolves({ spokeRegistry: REGISTRY_33 })
    const pendingOffboard = sinon.stub().resolves({ ...offboard, vaults: ['filtered'] })
    const pendingOnboard = sinon.stub().resolves({ ...onboardSpoke, scIds: ['filtered'] })
    sinon.stub(LiveDriver.prototype as any, 'records').resolves({ pendingOffboard, pendingOnboard })
    const driver = new LiveDriver(root, pool, null, addr(0x0e), {})

    expect(await driver.offboardInput(SPOKE_CID)).to.deep.equal({ ...offboard, vaults: ['filtered'] })
    expect(pendingOffboard.firstCall.args).to.deep.equal([offboard])
    expect(await driver.onboardSpokeInput(SPOKE_CID)).to.deep.equal({ ...onboardSpoke, scIds: ['filtered'] })
    expect(pendingOnboard.firstCall.args).to.deep.equal([onboardSpoke, REGISTRY_33])
  })

  it('takes the hub onboard grants from the restored managers of an offboarded spoke', async () => {
    const root = new Centrifuge({ environment: 'testnet' })
    const ctx = {
      centrifugeId: 1,
      protocolVersion: '3.2',
      contractAbis: ABIS_V3_2,
      ...v32,
      ...v33,
    }
    sinon.stub(root, 'protocolContext').callsFake(() => makeThenable(of(ctx)) as any)
    sinon.stub(root, 'getClient').callsFake(() => makeThenable(of({ getBlockNumber: async () => 100n })) as any)
    sinon.stub(root as any, '_queryData').callsFake(() => of([]))
    sinon.stub(MigrationInputsDerivation.prototype, 'hubShareClassCount').resolves(0)
    sinon.stub(MigrationInputsDerivation.prototype, 'spokeInventory').resolves(liveAfterOffboard())
    sinon.stub(MigrationInputsDerivation.prototype, 'hubInventory').resolves({} as any)
    sinon.stub(MigrationInputsDerivation.prototype, 'onboardHubInput').callsFake((_inv, grants) => ({ grants }) as any)
    const managerGrants = sinon
      .stub(MigrationInputsDerivation.prototype, 'managerGrants')
      .callsFake(async (centrifugeId, managers) =>
        managers.map((who) => ({ centrifugeId: String(centrifugeId), kind: 'spoke' as const, who }))
      )
    sinon.stub(MigrationRecords.prototype, 'spokePhase').resolves(3)
    sinon
      .stub(MigrationRecords.prototype, 'restoreOffboarded')
      .callsFake(async (_derivation, inv) => ({ ...inv, balanceSheetManagers: [manager, ramp] }))

    const hubInputs = await deriveMigrationHubInputs(root, POOL, [SPOKE_CID], { migration: facade })

    expect(managerGrants.firstCall.args).to.deep.equal([SPOKE_CID, [manager, ramp]])
    expect((hubInputs.onboardHub as unknown as { grants: { who: string }[] }).grants.map((g) => g.who)).to.deep.equal([
      manager,
      ramp,
    ])
  })
})
