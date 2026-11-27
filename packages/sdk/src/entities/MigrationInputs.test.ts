import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { BaseError, ContractFunctionRevertedError, zeroAddress, encodeFunctionData } from 'viem'
import type { HexString } from '../types/index.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import {
  MigrationInputsDerivation,
  MigrationInputsReadError,
  type MigrationInputsReader,
  type MigrationSpokeInventory,
} from './MigrationInputs.js'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as HexString

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
const usdc = addr(0xa1)
const dai = addr(0xa2)
const escrow = addr(0xe5)

class Revert {
  constructor(readonly errorName: string) {}
}
class Fail {}

type Script = Record<string, (address: HexString, args: readonly unknown[]) => unknown>

function revertError(errorName: string) {
  const inner = new ContractFunctionRevertedError({ abi: [], functionName: 'x' })
  ;(inner as any).data = { errorName }
  return new BaseError('reverted', { cause: inner })
}

/** A reader answering from a script keyed by function name; a `Revert` answers a named revert, a `Fail` a failed read. */
type LogRequest = { address: HexString; topics: HexString[]; fromBlock: bigint }
type Scripted = MigrationInputsReader & {
  calls: { address: HexString; functionName: string; args: readonly unknown[] }[]
  logsRequested: LogRequest[]
}

function scripted(
  script: Script,
  block = 100n,
  logScript?: (input: LogRequest) => { topics: HexString[] }[]
): Scripted {
  const calls: { address: HexString; functionName: string; args: readonly unknown[] }[] = []
  const logsRequested: LogRequest[] = []
  return {
    block,
    calls,
    logsRequested,
    async read(requested) {
      return requested.map((call) => {
        calls.push({ address: call.address, functionName: call.functionName, args: call.args ?? [] })
        encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] } as never)
        const fn = script[call.functionName]
        if (!fn) return { status: 'failure', error: new Error(`unscripted ${call.functionName}`) }
        const value = fn(call.address, call.args ?? [])
        if (value instanceof Revert) return { status: 'failure', error: revertError(value.errorName) }
        if (value instanceof Fail) return { status: 'failure', error: new Error('failed') }
        return { status: 'success', result: value }
      })
    },
    async logs(input) {
      logsRequested.push(input)
      return logScript?.(input) ?? []
    },
    async hasCode() {
      return false
    },
  }
}

function derivation(script: Script, options = {}, logScript?: (input: LogRequest) => { topics: HexString[] }[]) {
  const reader = scripted(script, 100n, logScript)
  return { reader, d: new MigrationInputsDerivation(reader, v32, v33, ABIS_V3_2 as any, SPOKE, options) }
}

const same = (a: HexString, b: HexString) => a.toLowerCase() === b.toLowerCase()

async function rejects(promise: Promise<unknown>, match: RegExp | (new (...args: any[]) => Error)) {
  try {
    await promise
  } catch (error) {
    if (match instanceof RegExp) expect(String((error as Error).message)).to.match(match)
    else expect(error).to.be.instanceOf(match)
    return
  }
  expect.fail('expected a rejection')
}

describe('MigrationInputsDerivation', () => {
  it('finds the v3.2 ramps among the balance sheet managers by their immutables', async () => {
    const ramp = addr(0xf1)
    const other = addr(0xf2)
    const eoa = addr(0xf3)
    const { d } = derivation({
      poolId: (address) => (same(address, ramp) || same(address, other) ? POOL.raw : new Fail()),
      balanceSheet: (address) => (same(address, ramp) ? v32.balanceSheet : addr(0x99)),
      relayer: (address) => (same(address, eoa) ? new Fail() : false),
    })
    expect(await d.v32Ramps(POOL, [ramp, other, eoa])).to.deep.equal([ramp])
  })

  it('keeps only the candidates the registry holds as managers, once each', async () => {
    const live = addr(0xb1)
    const stale = addr(0xb2)
    const { d } = derivation({ manager: (_, [, who]) => same(who as HexString, live) })
    expect(await d.liveManagers(POOL, v32.balanceSheet, [live, stale, live])).to.deep.equal([live])
  })

  it('refuses a manager read that fails instead of reading it as not a manager', async () => {
    const { d } = derivation({ manager: () => new Fail() })
    await rejects(d.liveManagers(POOL, v32.balanceSheet, [addr(1)]), MigrationInputsReadError)
  })

  it('reads the spoke classes off the share-token map, skipping the absent ones', async () => {
    const { d } = derivation({
      shareToken: (_, [, scId]) =>
        scId === sc1.raw ? addr(0x51) : scId === sc2.raw ? new Revert('ShareTokenDoesNotExist') : zeroAddress,
    })
    const classes = await d.spokeClasses(POOL, 3)
    expect(classes.scIds.map((id) => id.raw)).to.deep.equal([sc1.raw])
    expect(classes.tokens).to.deep.equal([addr(0x51)])
  })

  it('treats any other share-token failure as a failed read', async () => {
    const { d } = derivation({ shareToken: () => new Fail() })
    await rejects(d.spokeClasses(POOL, 1), /absent-key revert/)
  })

  const onChainLinked = addr(0xd7)
  const positionVault = addr(0xd8)
  const chainScript = {
    idToAsset: (_: HexString, [id]: readonly unknown[]) => {
      const counter = Number(BigInt(id as bigint) & 0xffffffffffffffffn)
      if (counter === 1) return [usdc, 0n]
      if (counter === 2) return [addr(0x69), 7n]
      return new Revert('UnknownAsset')
    },
    vault: (address: HexString, args: readonly unknown[]) => {
      if (!same(address, v32.vaultRegistry)) return new Fail()
      const [, scId, assetId, manager] = args as [bigint, HexString, bigint, HexString]
      if (!same(manager, v32.asyncRequestManager)) return new Fail()
      if (scId === sc1.raw && assetId === AssetId.from(SPOKE, 1).raw) return onChainLinked
      if (scId === sc2.raw && assetId === AssetId.from(SPOKE, 2).raw) return positionVault
      return zeroAddress
    },
  }

  it("reads every class and registered asset, ERC-6909 included, under the stack's ARM", async () => {
    const { d, reader } = derivation(chainScript)

    const linked = await d.linkedVaultsOnChain(POOL, [sc1, sc2])

    expect(linked).to.deep.equal([onChainLinked, positionVault])
    const lookups = reader.calls.filter((call) => call.functionName === 'vault')
    expect(lookups).to.have.length(2 * 2)
  })

  it('asks for nothing when the spoke has no share classes', async () => {
    const { d, reader } = derivation(chainScript)
    expect(await d.linkedVaultsOnChain(POOL, [])).to.deep.equal([])
    expect(reader.calls).to.have.length(0)
  })

  it('unlinks a vault the chain holds linked even when the indexer returns no vaults at all', async () => {
    const { d } = derivation({
      ...chainScript,
      vaultDetails: () => ({ assetId: AssetId.from(SPOKE, 1).raw, asset: usdc, tokenId: 0n, isLinked: true }),
      poolId: (address) => (same(address, onChainLinked) || same(address, positionVault) ? POOL.raw : new Fail()),
      scId: () => sc1.raw,
      syncDepositManager: () => new Fail(),
    })
    sinon.stub(d, 'spokeClasses').resolves({ scIds: [sc1, sc2], tokens: [addr(0x51), addr(0x52)] })
    sinon.stub(d, 'liveManagers').resolves([])
    sinon.stub(d, 'rotationAssets').resolves([])
    sinon.stub(d, 'v32Ramps').resolves([])
    sinon.stub(d, 'syncReserveKeys').resolves([])
    sinon.stub(d, 'registeredAssetPriceKeys').resolves([])
    sinon.stub(d, 'hookGrants').resolves([])

    const inventory = await d.spokeInventory(POOL, 2, {
      vaults: [],
      managers: [],
      rampInstances: [],
      ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
    })
    const offboard = d.offboardInput(inventory, [])

    expect(offboard.vaults.map((key) => key.vault)).to.deep.equal([onChainLinked, positionVault])
    expect(offboard.totalVaults).to.equal('2')
  })

  const facade = addr(0xfa)
  const afterOffboard = (unlinkedCount: number, unlinked: HexString[]) => {
    const { d, reader } = derivation(
      {
        ...chainScript,
        vault: (_, args) => {
          const [, , assetId] = args as [bigint, HexString, bigint]
          if (assetId === AssetId.from(SPOKE, 1).raw) return addr(0xd1)
          if (assetId === AssetId.from(SPOKE, 2).raw) return addr(0xd2)
          return zeroAddress
        },
        vaultDetails: () => ({ assetId: AssetId.from(SPOKE, 1).raw, asset: usdc, tokenId: 0n, isLinked: false }),
        poolId: () => POOL.raw,
        scId: () => sc1.raw,
        syncDepositManager: () => new Fail(),
        vaultUnlinked: (_, [, vault]) => unlinked.some((known) => same(known, vault as HexString)),
        unlinkedVaults: () => unlinkedCount,
      },
      { migration: facade }
    )
    sinon.stub(d, 'spokeClasses').resolves({ scIds: [sc1], tokens: [addr(0x51)] })
    sinon.stub(d, 'liveManagers').resolves([])
    sinon.stub(d, 'rotationAssets').resolves([])
    sinon.stub(d, 'v32Ramps').resolves([])
    sinon.stub(d, 'syncReserveKeys').resolves([])
    sinon.stub(d, 'registeredAssetPriceKeys').resolves([])
    sinon.stub(d, 'hookGrants').resolves([])
    return { d, reader }
  }
  const indexed = (vaults: HexString[]) => ({
    vaults,
    managers: [],
    rampInstances: [],
    ramp: { relayers: [], offrampAssets: [], offrampReceivers: [] },
  })

  it("seeds the onboard with every vault the facade unlinked from the ARM slot the offboard leaves, with no indexer vaults", async () => {
    const { d } = afterOffboard(2, [addr(0xd1), addr(0xd2)])

    const inventory = await d.spokeInventory(POOL, 1, indexed([]))
    const seeds = d.onboardSpokeInput(inventory, [], { seeds: [], configs: [] }).registerVaults

    expect(seeds.map((seed) => seed.vault)).to.deep.equal([addr(0xd1), addr(0xd2)])
    expect(seeds.every((seed) => seed.link)).to.equal(true)
  })

  it('refuses to build after the offboard when the facade unlinked a vault neither the registry nor the indexer names', async () => {
    const { d } = afterOffboard(3, [addr(0xd1), addr(0xd2)])

    await rejects(d.spokeInventory(POOL, 1, indexed([])), /2 of the candidates read as unlinked by the facade, expected 3/)
  })

  it('does not ask the facade for its count when no facade is configured', async () => {
    const { d, reader } = derivation({ unlinkedVaults: () => new Fail() })
    await d.assertEveryUnlinkedVaultKnown(POOL, [])
    expect(reader.calls).to.have.length(0)
  })

  it('walks the spoke asset ids until the first unknown one and keeps the ERC-20s only', async () => {
    const { d, reader } = derivation({
      idToAsset: (_, [id]) => {
        const counter = Number(BigInt(id as bigint) & 0xffffffffffffffffn)
        if (counter === 1) return [usdc, 0n]
        if (counter === 2) return [addr(0x69), 7n]
        if (counter === 3) return [dai, 0n]
        return new Revert('UnknownAsset')
      },
    })
    const assets = await d.registeredAssets(true, false)
    expect(assets.assets).to.deep.equal([usdc, dai])
    expect(assets.assetIds.map((id) => id.raw)).to.deep.equal([AssetId.from(SPOKE, 1).raw, AssetId.from(SPOKE, 3).raw])
    expect(reader.calls.filter((call) => call.functionName === 'idToAsset')).to.have.length(32)
  })

  it('rotates an asset the escrow holds or has a ledger entry for, never the pool share token', async () => {
    const token = addr(0x51)
    const { d } = derivation({
      escrow: () => escrow,
      balanceOf: (address) => (same(address, usdc) ? 5n : 0n),
      holding: (_, [, asset]) => (same(asset as HexString, dai) ? [0n, 3n] : [0n, 0n]),
    })
    expect(await d.rotationAssets(POOL, [sc1], [usdc, dai, token, addr(0xa3)], [token])).to.deep.equal([usdc, dai])
  })

  it('orders the asset ids the batch request manager has state for', async () => {
    const a1 = AssetId.from(1, 1)
    const a2 = AssetId.from(1, 2)
    const a3 = AssetId.from(1, 3)
    const { d } = derivation({
      epochId: (_, [, , id]) => (id === a1.raw ? [1, 0, 0, 0] : [0, 0, 0, 0]),
      pendingDeposit: (_, [, , id]) => (id === a2.raw ? 9n : 0n),
      pendingRedeem: () => 0n,
    })
    expect((await d.orderedAssetIds(POOL, [sc1], [a1, a2, a3])).map((id) => id.raw)).to.deep.equal([a1.raw, a2.raw])
  })

  it('seeds the holdings that carry an amount or the liability flag', async () => {
    const a1 = AssetId.from(1, 1)
    const a2 = AssetId.from(1, 2)
    const a3 = AssetId.from(1, 3)
    const { d } = derivation({
      holding: (_, [, , id]) => (id === a1.raw ? [10n, 10n, false] : id === a2.raw ? [0n, 0n, true] : [0n, 0n, false]),
    })
    expect(await d.holdingSeeds(POOL, [sc1], [a1, a2, a3])).to.deep.equal([
      { scId: sc1.raw, assetId: a1.raw.toString() },
      { scId: sc1.raw, assetId: a2.raw.toString() },
    ])
  })

  it('keys the sync reserves and asset prices on the non-zero entries of the grid', async () => {
    const id1 = AssetId.from(SPOKE, 1)
    const id2 = AssetId.from(SPOKE, 2)
    const { d } = derivation({
      maxReserve: (_, [, scId, asset]) => (scId === sc1.raw && same(asset as HexString, usdc) ? 1n : 0n),
      markersPricePoolPerAsset: (_, [, scId, id]) => (scId === sc2.raw && id === id2.raw ? [5n, 0n, 0n] : [0n, 0n, 0n]),
    })
    expect(await d.syncReserveKeys(POOL, [sc1, sc2], [usdc, dai])).to.deep.equal([{ scId: sc1.raw, asset: usdc }])
    expect(await d.assetPriceKeys(POOL, [sc1, sc2], [id1, null, id2])).to.deep.equal([
      { scId: sc2.raw, assetId: id2.raw.toString() },
    ])
  })

  it('refuses a registered id on the hub probe window edge instead of answering short', async () => {
    const { d } = derivation({ isRegistered: (_, [id]) => BigInt(id as bigint) === AssetId.from(16, 1).raw })
    await rejects(d.hubAssetIds(), /probe window edge/)
  })

  it('reads the spoke record off the hub and refuses a failed read', async () => {
    const { d } = derivation({ hubRequestManager: (_, [, cid]) => (cid === 2 || cid === 5 ? addr(0x77) : zeroAddress) })
    expect(await d.hubSpokeRecord(POOL)).to.deep.equal([2, 5])
    const { d: failing } = derivation({ hubRequestManager: () => new Fail() })
    await rejects(failing.hubSpokeRecord(POOL), /hubRequestManager/)
  })

  it('grants every balance sheet manager on v3.3 except the periphery, with the stack contracts swapped', async () => {
    const external = addr(0xc1)
    const periphery = addr(0xc2)
    const { d } = derivation({
      poolId: (address) => (same(address, periphery) ? POOL.raw : new Fail()),
      contractUpdater: (address) => (same(address, periphery) ? BigInt(addr(0xc9)) : new Fail()),
    })
    const grants = await d.managerGrants(SPOKE, [external, periphery, v32.asyncRequestManager, v32.syncManager])
    expect(grants.map((grant) => grant.who)).to.deep.equal([
      `0x${external.slice(2)}${'0'.repeat(24)}`,
      `0x${v33.asyncRequestManager.slice(2)}${'0'.repeat(24)}`,
      `0x${v33.syncManager.slice(2)}${'0'.repeat(24)}`,
    ])
    expect(grants.every((grant) => grant.kind === 'spoke' && grant.centrifugeId === '2')).to.equal(true)
  })

  const vaultDetails = (isLinked: boolean) => ({
    assetId: AssetId.from(SPOKE, 1).raw,
    asset: usdc,
    tokenId: 0n,
    isLinked,
  })

  it('resolves the live vaults through the registry and names the unknown ones', async () => {
    const vault = addr(0xd1)
    const foreign = addr(0xd2)
    const unknown = addr(0xd3)
    const { d } = derivation({
      vaultDetails: (_, [who]) => (same(who as HexString, unknown) ? new Revert('UnknownVault') : vaultDetails(true)),
      poolId: (address) => (same(address, vault) ? POOL.raw : POOL.raw + 1n),
      scId: () => sc1.raw,
      syncDepositManager: (address) => (same(address, vault) ? addr(0x55) : new Fail()),
    })
    const { vaults, unknown: dropped } = await d.liveVaults(POOL, [vault, foreign, unknown])
    expect(dropped).to.deep.equal([unknown])
    expect(vaults).to.have.length(1)
    expect(vaults[0]).to.include({
      vault,
      asset: usdc,
      isLinked: true,
      isSync: true,
      factory: v33.syncDepositVaultFactory,
    })
  })

  it("restores a vault's link bit from the facade record once the offboard unlinked it on v3.2", async () => {
    const linked = addr(0xd1)
    const never = addr(0xd2)
    const migration = addr(0x33)
    const { d, reader } = derivation(
      {
        vaultDetails: () => vaultDetails(false),
        poolId: () => POOL.raw,
        scId: () => sc1.raw,
        syncDepositManager: () => new Fail(),
        vaultUnlinked: (address, [, vault]) => same(address, migration) && same(vault as HexString, linked),
      },
      { migration }
    )
    const { vaults } = await d.liveVaults(POOL, [linked, never])
    expect(vaults.map((vault) => vault.isLinked)).to.deep.equal([true, false])
    expect(reader.calls.filter((call) => call.functionName === 'vaultUnlinked')).to.have.length(2)
    const { d: bare } = derivation({
      vaultDetails: () => vaultDetails(false),
      poolId: () => POOL.raw,
      scId: () => sc1.raw,
      syncDepositManager: () => new Fail(),
    })
    expect((await bare.liveVaults(POOL, [linked])).vaults[0]!.isLinked).to.equal(false)
  })

  it('sweeps hook-manager grants with the token as a left-padded topic and re-reads each grantee', async () => {
    const hook = addr(0x11)
    const token = addr(0x51)
    const who = addr(0xc1)
    const gone = addr(0xc2)
    const { d, reader } = derivation(
      {
        hook: () => hook,
        manager: (_, [, candidate]) => same(candidate as HexString, who),
      },
      { hookLogsFromBlock: 0n },
      ({ topics }) =>
        topics.length === 2
          ? [who, gone].map((grantee) => ({
              topics: [topics[0]!, topics[1]!, `0x${grantee.slice(2).padStart(64, '0')}` as HexString],
            }))
          : []
    )
    const grants = await d.hookGrants([sc1], [token])
    expect(grants).to.deep.equal([{ scId: sc1, token, v32Hook: hook, managers: [who] }])
    expect(reader.logsRequested[0]!.topics[1]).to.equal(`0x${'0'.repeat(24)}${token.slice(2)}`)
  })

  it('refuses a hook sweep that starts after the hook was deployed', async () => {
    const { d, reader } = derivation({ hook: () => addr(0x11) }, { hookLogsFromBlock: 50n })
    reader.hasCode = async () => true
    await rejects(d.hookGrants([sc1], [addr(0x51)]), /after hook .* was deployed/)
  })

  describe('the inputs', () => {
    const inventory = (over: Partial<MigrationSpokeInventory> = {}): MigrationSpokeInventory => ({
      centrifugeId: SPOKE,
      block: 100n,
      notCarried: { balanceSheetManagers: [], gatewayManagers: [] },
      scIds: [sc1],
      tokens: [addr(0x51)],
      assetIds: [AssetId.from(SPOKE, 1), AssetId.from(SPOKE, 2)],
      assets: [usdc, dai],
      vaults: [
        {
          vault: addr(0xd1),
          factory: v33.asyncVaultFactory,
          scId: sc1,
          assetId: AssetId.from(SPOKE, 1),
          asset: usdc,
          isLinked: true,
          isSync: false,
        },
        {
          vault: addr(0xd2),
          factory: v33.asyncVaultFactory,
          scId: sc1,
          assetId: AssetId.from(SPOKE, 2),
          asset: dai,
          isLinked: false,
          isSync: false,
        },
      ],
      unknownVaults: [],
      rotationAssets: [dai],
      balanceSheetManagers: [addr(0xb1)],
      gatewayManagers: [addr(0xb2), addr(0xb3)],
      grantedRamps: [],
      syncReserves: [{ scId: sc1.raw, asset: usdc }],
      assetPrices: [{ scId: sc1.raw, assetId: AssetId.from(SPOKE, 1).raw.toString() }],
      hookGrants: [],
      sources: {} as MigrationSpokeInventory['sources'],
      ...over,
    })

    it('builds the offboard input from the linked vaults and sweeps the rotated ids once', () => {
      const { d } = derivation({})
      const input = d.offboardInput(inventory(), [AssetId.from(1, 1), AssetId.from(SPOKE, 2)])
      expect(input.vaults).to.deep.equal([
        { scId: sc1.raw, assetId: AssetId.from(SPOKE, 1).raw.toString(), vault: addr(0xd1) },
      ])
      expect(input.assets).to.deep.equal([
        { asset: dai, assetId: AssetId.from(SPOKE, 2).raw.toString(), scIds: [sc1.raw] },
      ])
      expect(input.assetIds).to.deep.equal([AssetId.from(1, 1).raw.toString(), AssetId.from(SPOKE, 2).raw.toString()])
      expect(input).to.include({
        finalize: true,
        totalVaults: '1',
        totalAssets: '1',
        totalManagers: '3',
        unlinkGas: '0',
      })
    })

    it('refuses a rotation asset the spoke never registered', () => {
      const { d } = derivation({})
      expect(() => d.offboardInput(inventory({ rotationAssets: [addr(0xa9)] }), [])).to.throw(
        /not among the spoke registered assets/
      )
    })

    it('seeds every live vault on the onboard with its v3.2 link state', () => {
      const { d } = derivation({})
      const input = d.onboardSpokeInput(
        inventory(),
        [{ scId: sc1.raw, hook: addr(0x33), managers: [addr(1), addr(2)] }],
        { seeds: [], configs: [] }
      )
      expect(input.registerVaults.map((seed) => seed.link)).to.deep.equal([true, false])
      expect(input.configureVaults).to.deep.equal(input.registerVaults)
      expect(input).to.include({
        seedEscrow: true,
        finalize: true,
        totalTokens: '1',
        totalRegistered: '2',
        totalHookGrants: '2',
        totalShareQueues: '1',
        totalAssetPrices: '1',
        totalRamps: '0',
      })
    })

    it('resolves hook grants through the hook map and keeps a class on its own hook seedless', () => {
      const v32Hook = addr(0x11)
      const v33Hook = addr(0x22)
      const { d } = derivation({}, { hookMap: { v32: [v32Hook], v33: [v33Hook] } })
      const seeds = d.hookManagerSeeds([
        { scId: sc1, token: addr(0x51), v32Hook, managers: [addr(1)] },
        { scId: sc2, token: addr(0x52), v32Hook: addr(0x12), managers: [addr(2)] },
      ])
      expect(seeds).to.deep.equal([{ scId: sc1.raw, hook: v33Hook, managers: [addr(1)] }])
    })

    it('refuses two granted v3.2 ramp instances on one share class', async () => {
      const r1 = addr(0xf1)
      const r2 = addr(0xf2)
      const { d } = derivation({
        poolId: () => POOL.raw,
        scId: () => sc1.raw,
        previewManager: () => addr(0xf9),
        onramp: () => false,
        offramp: () => false,
        relayer: () => false,
      })
      await rejects(
        d.rampSeeds(POOL, inventory({ grantedRamps: [r1, r2] }), {
          relayers: [],
          offrampAssets: [],
          offrampReceivers: [],
        }),
        /two BS-granted v3.2 OnOfframp instances/
      )
    })

    it('replays a ramp config from the instance maps, once per tuple', async () => {
      const r1 = addr(0xf1)
      const relayer = addr(0xee)
      const { d } = derivation({
        poolId: () => POOL.raw,
        scId: () => sc1.raw,
        previewManager: () => addr(0xf9),
        onramp: (_, [asset]) => same(asset as HexString, usdc),
        relayer: (_, [who]) => same(who as HexString, relayer),
        offramp: (_, [asset]) => same(asset as HexString, dai),
      })
      const { seeds, configs } = await d.rampSeeds(POOL, inventory({ grantedRamps: [r1] }), {
        relayers: [relayer, relayer],
        offrampAssets: [dai],
        offrampReceivers: [addr(0xdd)],
      })
      expect(seeds).to.deep.equal([
        { scId: sc1.raw, instance: addr(0xf9), v32Instance: r1, extraGasLimit: '0', rampAssets: [usdc, dai] },
      ])
      expect(configs).to.have.length(3)
      expect(configs.map((config) => config.config.slice(0, 66).endsWith(`${'0'.repeat(63)}0`))).to.deep.equal([
        true,
        false,
        false,
      ])
    })
  })
})
