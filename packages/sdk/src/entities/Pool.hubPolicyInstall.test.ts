import { ABIS_V3_3, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { map } from 'rxjs'
import sinon from 'sinon'
import {
  type Abi,
  ContractFunctionExecutionError,
  ContractFunctionZeroDataError,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  zeroAddress,
} from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { StdHubPolicyFactoryMissingError } from '../errors.js'
import { ctx, pool32Id, pool33Id, scId33, scId33b, SPOKE, STD_HUB_POLICY_FACTORY, who } from '../tests/hubGroup.js'
import {
  adapter,
  argsOf,
  callsBuiltBy,
  hubAbi,
  initiated,
  inner,
  judged,
  lastStatus,
  nameOf,
  POLICY,
  recordingWallet,
  rig,
  scheduledData,
  SEPOLIA,
  type Sent,
} from '../tests/hubPolicyRig.js'
import type { OperationOutOfPolicyStatus } from '../types/transaction.js'
import { CAST_CONFIG, CAST_NEW_CALLDATA, CAST_PREVIEW_CALLDATA } from '../tests/hubPolicyFixtures.js'
import type { HexString } from '../types/index.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import { makeThenable } from '../utils/rx.js'
import type { HubPolicyConfig } from './hubPolicyInstall.js'
import { Pool } from './Pool.js'

// The rig is a v3.3 pool on the testnet registry with a scripted hub chain. Each test lists the factory on the hub
// chain's stack itself, or lists none, whatever the pinned address book lists.

const FACTORY = STD_HUB_POLICY_FACTORY
const PREVIEW = '0x1010101010101010101010101010101010101010' as HexString
const OTHER_HUB = '0x7474747474747474747474747474747474747474' as HexString
const REQUEST_MANAGER = '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a' as HexString
const BRIDGING_HOOK = '0x6363636363636363636363636363636363636363' as HexString
const UINT48_MAX = 2n ** 48n - 1n
const UINT128_MAX = 2n ** 128n - 1n

const pool33 = ctx(pool33Id, '3.3').addresses as Record<string, HexString>
const { hub, hubRegistry, multiAdapter, shareClassManager, navManager, simplePriceManager } = pool33
const oracleValuation = pool33.oracleValuation!

/** A policy for the pool: dependencies from its context, the request manager the hub registry answers. */
const config: HubPolicyConfig = {
  delay: 86_400n,
  expiry: 604_800n,
  escalation: 1_209_600n,
  allowlist: [],
  navManager: navManager!,
  onchainAccounting: true,
  isRestrictionUpdateInstant: false,
  thresholdPerSecond: 11_574_074_074_074n,
  maxBrmPriceDeviation: 10n ** 16n,
  maxAbsolutePriceDelta: 5n * 10n ** 16n,
  simplePriceManager: simplePriceManager!,
  requestManager: REQUEST_MANAGER,
  bridgingHook: BRIDGING_HOOK,
  oracleValuation,
}

type Views = Partial<Record<'hub' | 'hubRegistry' | 'multiAdapter' | 'shareClassManager', HexString>>
/** What a policy built for this pool answers for its four dependencies. */
const policyViews = (overrides: Views = {}) => ({ hub, hubRegistry, multiAdapter, shareClassManager, ...overrides })

const deployLog = (policy: HexString) => ({
  address: FACTORY,
  topics: encodeEventTopics({ abi: ABIS_V3_3.StdHubPolicyFactory, eventName: 'DeployHubPolicy', args: { policy } }),
  data: '0x',
})

/** A pool on a hub with the factory listed, a request manager and a preview address. */
function subjectOf({
  contracts = [] as HexString[],
  logs = [deployLog(PREVIEW)],
  factory = FACTORY as HexString | null,
  reads = {},
}: { contracts?: HexString[]; logs?: object[]; factory?: HexString | null; reads?: Record<string, unknown> } = {}) {
  const subject = rig(
    { ...policyViews(), hubRequestManager: REQUEST_MANAGER, previewHubPolicy: () => PREVIEW, ...reads },
    contracts,
    { stdHubPolicyFactory: factory, logs }
  )
  return { ...subject, contracts, pool: new Pool(subject.centrifuge, pool33Id) }
}

async function refusal(run: () => PromiseLike<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a refusal')
}

const callsOf = (subject: { readContract: sinon.SinonStub }, functionName: string) =>
  subject.readContract
    .getCalls()
    .map((call) => call.args[0] as { address: HexString; abi: Abi; functionName: string; args?: readonly unknown[] })
    .filter((call) => call.functionName === functionName)

const sentTo = (sent: Sent[]) => sent.map((tx) => tx.to.toLowerCase())

const BRIDGING_HOOK_WITH_LETTERS = '0x6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a' as HexString

/** The checksummed `address` with the case of one letter flipped: mixed case, and a checksum that no longer holds. */
function wrongChecksum(address: HexString): HexString {
  const checksum = getAddress(address)
  const at = [...checksum.slice(2)].findIndex((char) => /[a-f]/i.test(char)) + 2
  const flipped =
    checksum[at] === checksum[at]!.toUpperCase() ? checksum[at]!.toLowerCase() : checksum[at]!.toUpperCase()
  return `${checksum.slice(0, at)}${flipped}${checksum.slice(at + 1)}` as HexString
}

/** The pool's context as `patch` changes it, for one the bundled registry never lists: no oracle valuation, or other managers. */
function withContext(centrifuge: Centrifuge, patch: Record<string, unknown>) {
  const original = centrifuge.protocolContext.bind(centrifuge)
  sinon
    .stub(centrifuge, 'protocolContext')
    .callsFake(((target: any) =>
      makeThenable(original(target).pipe(map((context) => ({ ...context, ...patch }))))) as any)
}

describe('Pool hub policy install', () => {
  afterEach(() => sinon.restore())

  describe('hubPolicyDependencies', () => {
    const reads = (extra: Record<string, unknown> = {}) => ({
      hubRequestManager: REQUEST_MANAGER,
      bridgingHook: BRIDGING_HOOK,
      navHook: simplePriceManager,
      shareClassCount: 2,
      pricePoolPerShare: ([, scId]: readonly [bigint, string]) =>
        scId === scId33.raw ? [10n ** 18n, 1_700_000_000n] : [2n * 10n ** 18n, 0n],
      ...extra,
    })
    const depsOf = (extra: Record<string, unknown> = {}, factory: HexString | null = FACTORY) => {
      const subject = subjectOf({ reads: reads(extra), factory })
      return { ...subject, read: () => subject.pool.hubPolicyDependencies() }
    }

    it('reads the request manager the hub registry holds toward the hub chain itself', async () => {
      const { read, ...subject } = depsOf()

      expect((await read()).requestManager).to.equal(REQUEST_MANAGER)
      const [call] = callsOf(subject, 'hubRequestManager')
      expect(call).to.deep.include({ address: hubRegistry })
      expect(call!.args).to.deep.equal([pool33Id.raw, 1])
    })

    it('reads the bridging hook the hub registry holds for the pool', async () => {
      const { read, ...subject } = depsOf()

      expect((await read()).bridgingHook).to.equal(BRIDGING_HOOK)
      const [call] = callsOf(subject, 'bridgingHook')
      expect(call).to.deep.include({ address: hubRegistry })
      expect(call!.args).to.deep.equal([pool33Id.raw])
    })

    it('takes the NAV manager, the price manager and the oracle valuation from the pool context', async () => {
      const { read } = depsOf()

      expect(await read()).to.deep.include({ navManager, simplePriceManager, oracleValuation })
    })

    it('answers the zero address for an oracle valuation the chain does not list', async () => {
      const { read, centrifuge } = depsOf()
      withContext(centrifuge, { oracleValuation: undefined })

      expect((await read()).oracleValuation).to.equal(zeroAddress)
    })

    it('reads whether the NAV hook of the pool is the price manager, whatever the case of the address', async () => {
      const { read, ...subject } = depsOf({ navHook: simplePriceManager!.toLowerCase() })

      expect((await read()).usesOnchainNav).to.equal(true)
      const [call] = callsOf(subject, 'navHook')
      expect(call).to.deep.include({ address: navManager })
      expect(call!.args).to.deep.equal([pool33Id.raw])
    })

    it('reads a NAV hook that is another contract as no onchain NAV', async () => {
      const { read } = depsOf({ navHook: BRIDGING_HOOK })

      expect((await read()).usesOnchainNav).to.equal(false)
    })

    it('reads a pool whose NAV hook is unset as no onchain NAV', async () => {
      const { read } = depsOf({ navHook: zeroAddress })

      expect((await read()).usesOnchainNav).to.equal(false)
    })

    it('reads the committed price and its time of every share class', async () => {
      const { read, ...subject } = depsOf()

      const { committedPrices } = await read()

      expect(
        committedPrices.map(({ shareClassId, price, computedAt }) => [
          shareClassId.toString(),
          price.toBigInt(),
          computedAt,
        ])
      ).to.deep.equal([
        [scId33.toString(), 10n ** 18n, 1_700_000_000n],
        [scId33b.toString(), 2n * 10n ** 18n, 0n],
      ])
      expect(callsOf(subject, 'pricePoolPerShare')[0]).to.deep.include({ address: shareClassManager })
    })

    it('lists no committed price for a pool without a share class', async () => {
      const { read } = depsOf({ shareClassCount: 0 })

      expect((await read()).committedPrices).to.deep.equal([])
    })

    it('reads the installed policy from the hub, the zero address when none', async () => {
      const none = depsOf()
      const installed = depsOf()
      installed.chain.installed = true

      expect((await none.read()).installedPolicy).to.equal(zeroAddress)
      expect((await installed.read()).installedPolicy).to.equal(POLICY)
      expect(callsOf(installed, 'policy')[0]).to.deep.include({ address: hub })
    })

    it('reads where the address book lists no factory, which only a deployment needs', async () => {
      const { read } = depsOf({}, null)

      expect((await read()).requestManager).to.equal(REQUEST_MANAGER)
    })

    it('reads the chain on every call, so a policy installed a moment ago shows as installed', async () => {
      const { read, chain } = depsOf()

      const before = await read()
      chain.installed = true
      const after = await read()

      expect([before.installedPolicy, after.installedPolicy]).to.deep.equal([zeroAddress, POLICY])
    })

    it('reads everything on the hub chain, and nothing from the indexer', async () => {
      const { read, centrifuge } = depsOf()
      const indexer = centrifuge._queryData as unknown as sinon.SinonStub
      indexer.resetHistory()

      await read()

      expect(indexer.called).to.equal(false)
      const clients = (centrifuge.getClient as sinon.SinonStub).getCalls().map((call) => call.args[0])
      expect(clients.length).to.be.greaterThan(0)
      expect(new Set(clients)).to.deep.equal(new Set([1]))
    })
  })

  describe('previewHubPolicy', () => {
    it('answers the address the factory derives from the config, not yet deployed', async () => {
      const subject = subjectOf()

      expect(await subject.pool.previewHubPolicy(config)).to.deep.equal({ address: PREVIEW, deployed: false })
      expect(callsOf(subject, 'previewHubPolicy')[0]).to.deep.include({ address: FACTORY })
    })

    it('answers deployed when the previewed address has code', async () => {
      const subject = subjectOf({ contracts: [PREVIEW] })

      expect(await subject.pool.previewHubPolicy(config)).to.deep.equal({ address: PREVIEW, deployed: true })
    })

    it('passes the config to the factory as the struct the contract hashes, field for field', async () => {
      const subject = subjectOf({ reads: { hubRequestManager: CAST_CONFIG.requestManager } })
      withContext(subject.centrifuge, {
        navManager: CAST_CONFIG.navManager,
        simplePriceManager: CAST_CONFIG.simplePriceManager,
      })

      await subject.pool.previewHubPolicy(CAST_CONFIG)

      const [call] = callsOf(subject, 'previewHubPolicy')
      expect(
        encodeFunctionData({
          abi: call!.abi,
          functionName: 'previewHubPolicy',
          args: call!.args as any,
        })
      ).to.equal(CAST_PREVIEW_CALLDATA)
    })

    it('refuses what a deployment refuses, so no address is shown for a policy nobody may deploy', async () => {
      const subject = subjectOf()

      const error = await refusal(() => subject.pool.previewHubPolicy({ ...config, delay: 0n }))

      expect(error.message).to.match(/delay/)
    })

    it('reads the chain on every call, so a policy deployed a moment ago shows as deployed', async () => {
      const subject = subjectOf()

      const before = await subject.pool.previewHubPolicy(config)
      subject.contracts.push(PREVIEW)
      const after = await subject.pool.previewHubPolicy(config)

      expect([before.deployed, after.deployed]).to.deep.equal([false, true])
    })

    it('throws the named error for a chain whose address book lists no factory', async () => {
      const subject = subjectOf({ factory: null })

      const error = await refusal(() => subject.pool.previewHubPolicy(config))

      expect(error).to.be.instanceOf(StdHubPolicyFactoryMissingError)
      expect(error.message).to.match(/no StdHubPolicyFactory/)
    })
  })

  describe('deployHubPolicy', () => {
    it('sends newHubPolicy to the factory on the hub chain and yields the deployed address', async () => {
      const subject = subjectOf()

      const result = await lastStatus(subject.pool.deployHubPolicy(config))

      expect(result).to.deep.equal({ type: 'DeployedHubPolicy', address: PREVIEW, skipped: false })
      expect(subject.sent).to.have.length(1)
      expect(subject.sent[0]!.to.toLowerCase()).to.equal(FACTORY.toLowerCase())
      expect(subject.sent[0]!.data.slice(0, 10)).to.equal('0x0ef75634')
      expect(subject.sent[0]!.value).to.equal(0n)
    })

    it('sends the config as the struct the contract hashes, field for field', async () => {
      const subject = subjectOf({ reads: { hubRequestManager: CAST_CONFIG.requestManager } })
      withContext(subject.centrifuge, {
        navManager: CAST_CONFIG.navManager,
        simplePriceManager: CAST_CONFIG.simplePriceManager,
      })

      await subject.pool.deployHubPolicy({ ...CAST_CONFIG, allowlist: [] })

      expect(subject.sent[0]!.data).to.equal(CAST_NEW_CALLDATA)
    })

    it('skips without signing when the previewed address already has code', async () => {
      const subject = subjectOf({ contracts: [PREVIEW] })

      const result = await lastStatus(subject.pool.deployHubPolicy(config))

      expect(result).to.deep.equal({ type: 'DeployedHubPolicy', address: PREVIEW, skipped: true })
      expect(subject.sent).to.deep.equal([])
    })

    it('skips the second deployment of the same config, since the first left code at its address', async () => {
      const subject = subjectOf()

      const first = await lastStatus(subject.pool.deployHubPolicy(config))
      subject.contracts.push(PREVIEW)
      const second = await lastStatus(subject.pool.deployHubPolicy(config))

      expect([first, second].map((status) => (status as any).skipped)).to.deep.equal([false, true])
      expect(subject.sent).to.have.length(1)
    })

    it('fails when the confirmed receipt carries no DeployHubPolicy event of the factory', async () => {
      const other = { ...deployLog(PREVIEW), address: OTHER_HUB }
      const subject = subjectOf({ logs: [other] })

      const error = await refusal(() => subject.pool.deployHubPolicy(config))

      expect(error.message).to.match(/DeployHubPolicy event/)
    })

    it('fails when the event names another policy than the one previewed', async () => {
      const subject = subjectOf({ logs: [deployLog(OTHER_HUB)] })

      const error = await refusal(() => subject.pool.deployHubPolicy(config))

      expect(error.message).to.match(/previewed/)
    })

    it('builds the deployment without a signer, for a custodial signer that sends the call itself', async () => {
      const subject = subjectOf()

      const built = await subject.centrifuge.buildOnly(subject.pool.deployHubPolicy(config) as any)

      expect(built.to.toLowerCase()).to.equal(FACTORY.toLowerCase())
      expect(built.data.slice(0, 10)).to.equal('0x0ef75634')
    })

    it('refuses to build a deployment of a config that is deployed already, which has no call to build', async () => {
      const subject = subjectOf({ contracts: [PREVIEW] })

      const error = await refusal(() => subject.centrifuge.buildOnly(subject.pool.deployHubPolicy(config) as any))

      expect(error.message).to.contain(`already deployed at ${PREVIEW}, nothing to build`)
    })

    describe('refuses before anything is signed', () => {
      const refused = async (change: Partial<HubPolicyConfig>, factory: HexString | null = FACTORY) => {
        const subject = subjectOf({ factory })
        const error = await refusal(() => subject.pool.deployHubPolicy({ ...config, ...change }))
        expect(subject.sent, 'nothing is signed').to.deep.equal([])
        return error
      }
      const deploys = async (change: Partial<HubPolicyConfig>) => {
        const subject = subjectOf()
        const result = await lastStatus(subject.pool.deployHubPolicy({ ...config, ...change }))
        expect(subject.sent).to.have.length(1)
        return result
      }

      it('a delay of 0, which the policy constructor reverts', async () => {
        expect((await refused({ delay: 0n })).message).to.match(/delay must be greater than 0/)
        expect((await deploys({ delay: 1n })).type).to.equal('DeployedHubPolicy')
      })

      it('an expiry of 0, which the policy constructor reverts', async () => {
        expect((await refused({ expiry: 0n })).message).to.match(/expiry must be greater than 0/)
        expect((await deploys({ expiry: 1n })).type).to.equal('DeployedHubPolicy')
      })

      it('an escalation that is not greater than the delay, which the policy constructor reverts', async () => {
        const equal = await refused({ delay: 100n, escalation: 100n })
        const below = await refused({ delay: 100n, escalation: 99n })

        expect(equal.message).to.match(/escalation must be greater than the delay/)
        expect(below.message).to.match(/escalation must be greater than the delay/)
        expect((await deploys({ delay: 100n, escalation: 101n })).type).to.equal('DeployedHubPolicy')
      })

      it('a duration beyond uint48, which would wrap in the hash of the config', async () => {
        for (const field of ['delay', 'expiry', 'escalation'] as const) {
          const change = { delay: 1n, expiry: 1n, escalation: UINT48_MAX }
          const over = await refused({ ...change, [field]: UINT48_MAX + 1n })
          expect(over.message, field).to.match(new RegExp(`${field}.*uint48`))
        }
        expect((await deploys({ delay: 1n, expiry: UINT48_MAX, escalation: UINT48_MAX })).type).to.equal(
          'DeployedHubPolicy'
        )
      })

      it('a price guard beyond uint128 or below zero', async () => {
        for (const field of ['thresholdPerSecond', 'maxBrmPriceDeviation', 'maxAbsolutePriceDelta'] as const) {
          const over = await refused({ [field]: UINT128_MAX + 1n })
          const negative = await refused({ [field]: -1n })
          expect(over.message, field).to.match(new RegExp(`${field}.*uint128`))
          expect(negative.message, field).to.match(new RegExp(`${field}.*uint128`))
        }
        const full = {
          thresholdPerSecond: UINT128_MAX,
          maxBrmPriceDeviation: UINT128_MAX,
          maxAbsolutePriceDelta: UINT128_MAX,
        }
        expect((await deploys(full)).type).to.equal('DeployedHubPolicy')
      })

      it('a number where a bigint is required, so no amount passes through a float', async () => {
        const error = await refused({ delay: 86_400 as any })

        expect(error.message).to.match(/delay must be a bigint/)
      })

      it('onchainAccounting with a zero NAV manager', async () => {
        const error = await refused({ navManager: zeroAddress })

        expect(error.message).to.match(/onchainAccounting needs a navManager/)
        expect((await deploys({ onchainAccounting: false, navManager: zeroAddress })).type).to.equal(
          'DeployedHubPolicy'
        )
      })

      it('onchainAccounting with a zero price manager', async () => {
        const error = await refused({ simplePriceManager: zeroAddress })

        expect(error.message).to.match(/onchainAccounting needs a simplePriceManager/)
        expect((await deploys({ onchainAccounting: false, simplePriceManager: zeroAddress })).type).to.equal(
          'DeployedHubPolicy'
        )
      })

      it('onchainAccounting with a NAV manager other than the chain’s, which would lock the real one out for good', async () => {
        const error = await refused({ navManager: OTHER_HUB })

        expect(error.message).to.match(/onchainAccounting needs the chain's navManager/)
        expect(error.message).to.contain(navManager!)
        expect((await deploys({ onchainAccounting: false, navManager: OTHER_HUB })).type).to.equal('DeployedHubPolicy')
      })

      it('onchainAccounting with a price manager other than the chain’s, which would lock the real one out for good', async () => {
        const error = await refused({ simplePriceManager: OTHER_HUB })

        expect(error.message).to.match(/onchainAccounting needs the chain's simplePriceManager/)
        expect(error.message).to.contain(simplePriceManager!)
        expect((await deploys({ onchainAccounting: false, simplePriceManager: OTHER_HUB })).type).to.equal(
          'DeployedHubPolicy'
        )
      })

      it('accepts the chain’s managers in any case', async () => {
        const lower = {
          navManager: navManager!.toLowerCase() as HexString,
          simplePriceManager: simplePriceManager!.toLowerCase() as HexString,
        }

        expect((await deploys(lower)).type).to.equal('DeployedHubPolicy')
      })

      it('a request manager other than the one the hub registry holds, which would delay every call to the pool’s own', async () => {
        const error = await refused({ requestManager: OTHER_HUB })

        expect(error.message).to.match(/requestManager/)
        expect(error.message).to.contain(REQUEST_MANAGER)
      })

      it('accepts the request manager the hub registry holds in either case, and none at all', async () => {
        const upper = `0x${REQUEST_MANAGER.slice(2).toUpperCase()}` as HexString
        const lower = REQUEST_MANAGER.toLowerCase() as HexString

        expect(upper).to.not.equal(lower)
        for (const requestManager of [upper, lower, zeroAddress]) {
          expect((await deploys({ requestManager })).type, requestManager).to.equal('DeployedHubPolicy')
        }
      })

      it('an address field that is no address, which the encoder would reject or hash into another policy', async () => {
        const error = await refused({ bridgingHook: '0x1234' as HexString })

        expect(error.message).to.match(/Invalid .*bridgingHook/)
      })

      it('an address field with a wrong checksum, which is a typo', async () => {
        const error = await refused({ bridgingHook: wrongChecksum(BRIDGING_HOOK_WITH_LETTERS) })

        expect(error.message).to.match(/bridgingHook.*wrong checksum/)
      })

      it('an allowlist caller that is no address, which the encoder would reject', async () => {
        const error = await refused({ allowlist: [{ poolId: 7n, caller: '0x1234' as HexString, selectors: [] }] })

        expect(error.message).to.match(/Invalid .*allowlist\[0\] caller/)
      })

      it('an allowlist caller with a wrong checksum, which is a typo', async () => {
        const caller = wrongChecksum(getAddress(`0x${'ab'.repeat(20)}`))

        const error = await refused({ allowlist: [{ poolId: 7n, caller, selectors: [] }] })

        expect(error.message).to.match(/allowlist\[0\] caller.*wrong checksum/)
      })

      it('an allowlist caller in lower, upper or checksummed case, each as the same checksummed policy', async () => {
        const lower = `0x${'ab'.repeat(20)}` as HexString
        const sentFor = async (caller: HexString) => {
          const subject = subjectOf()
          await subject.pool.deployHubPolicy({
            ...config,
            allowlist: [{ poolId: 7n, caller, selectors: ['0xdeadbeef'] }],
          })
          return subject.sent[0]!.data
        }

        const data = await Promise.all([lower, `0x${'AB'.repeat(20)}` as HexString, getAddress(lower)].map(sentFor))

        expect(new Set(data).size).to.equal(1)
      })

      it('a chain whose address book lists no factory, with the named error', async () => {
        const error = await refused({}, null)

        expect(error).to.be.instanceOf(StdHubPolicyFactoryMissingError)
        expect(error.message).to.match(/no StdHubPolicyFactory/)
      })
    })
  })

  describe('installHubPolicy', () => {
    const installable = (reads: Record<string, unknown> = {}, contracts: HexString[] = [PREVIEW]) =>
      subjectOf({ contracts, reads })

    it('sends Hub.setPolicy for the pool when no policy is installed', async () => {
      const subject = installable()

      const result = await lastStatus(subject.pool.installHubPolicy(PREVIEW))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(subject.sent).to.have.length(1)
      expect(subject.sent[0]!.to.toLowerCase()).to.equal(hub!.toLowerCase())
      expect(nameOf(subject.sent[0]!.data)).to.equal('setPolicy')
      expect(argsOf(subject.sent[0]!.data)).to.deep.equal([pool33Id.raw, getAddress(PREVIEW)])
    })

    it('deploys and then installs: newHubPolicy to the factory, then setPolicy to the hub', async () => {
      const subject = installable({}, [])

      await subject.pool.deployHubPolicy(config)
      subject.contracts.push(PREVIEW)
      await subject.pool.installHubPolicy(PREVIEW)

      expect(sentTo(subject.sent)).to.deep.equal([FACTORY.toLowerCase(), hub!.toLowerCase()])
      expect(subject.sent[0]!.data.slice(0, 10)).to.equal('0x0ef75634')
      expect(nameOf(subject.sent[1]!.data)).to.equal('setPolicy')
    })

    it('installs where the address book lists no factory, since a policy that exists needs none', async () => {
      const subject = subjectOf({ contracts: [PREVIEW], factory: null })

      const result = await lastStatus(subject.pool.installHubPolicy(PREVIEW))

      expect(result.type).to.equal('TransactionConfirmed')
    })

    it('builds the install without a signer, for a custodial signer that sends the call itself', async () => {
      const subject = installable()

      const built = await subject.centrifuge.buildOnly(subject.pool.installHubPolicy(PREVIEW) as any)

      expect(built.to.toLowerCase()).to.equal(hub!.toLowerCase())
      expect(built.messages ?? {}).to.deep.equal({})
      expect(nameOf(built.calls[0]!.data)).to.equal('setPolicy')
    })

    describe('the case of the address', () => {
      const upper = `0x${POLICY.slice(2).toUpperCase()}` as HexString

      it('refuses a mixed-case address whose checksum is wrong, which is a typo', async () => {
        const subject = installable({}, [POLICY])

        const error = await refusal(() => subject.pool.installHubPolicy(wrongChecksum(POLICY)))

        expect(error.message).to.match(/wrong checksum/)
        expect(subject.sent).to.deep.equal([])
      })

      it('accepts lower case, upper case and the checksummed address, and sends the checksummed one', async () => {
        const sent: HexString[] = []
        for (const form of [POLICY, upper, getAddress(POLICY)]) {
          const subject = installable({}, [POLICY])
          await subject.pool.installHubPolicy(form)
          sent.push(subject.sent[0]!.data)
          expect(argsOf(subject.sent[0]!.data)[1], form).to.equal(getAddress(POLICY))
        }

        expect(new Set(sent).size).to.equal(1)
        expect(upper).to.not.equal(POLICY)
      })
    })

    describe('refuses before anything is signed', () => {
      const refused = async (reads: Record<string, unknown>, contracts: HexString[] = [PREVIEW], address = PREVIEW) => {
        const subject = installable(reads, contracts)
        const error = await refusal(() => subject.pool.installHubPolicy(address))
        expect(subject.sent, 'nothing is signed').to.deep.equal([])
        return error
      }

      it('an address with no code', async () => {
        const error = await refused({}, [])

        expect(error.message).to.match(/has no code/)
      })

      it('the zero address, which would clear the policy rather than install one', async () => {
        const error = await refused({}, [], zeroAddress)

        expect(error.message).to.match(/zero address/)
      })

      it('a value that is no address, which no contract can sit at', async () => {
        const error = await refused({}, [], '0x1234' as HexString)

        expect(error.message).to.match(/Invalid .*policy/)
      })

      it('the policy installed already, in either case, which would only orphan the pool’s pending authorizations', async () => {
        for (const installed of [POLICY, getAddress(POLICY)]) {
          const subject = installable({}, [POLICY])
          subject.chain.installed = true

          const error = await refusal(() => subject.pool.installHubPolicy(installed))

          expect(error.message, installed).to.match(/installed already/)
          expect(subject.sent).to.deep.equal([])
        }
      })

      for (const view of ['hub', 'hubRegistry', 'multiAdapter', 'shareClassManager'] as const) {
        it(`a policy whose ${view}() is not the pool's, which another deployment of the protocol would have built it for`, async () => {
          const error = await refused(policyViews({ [view]: OTHER_HUB }))

          expect(error.message).to.contain(`${view}()`)
          expect(error.message).to.contain(OTHER_HUB)
          expect(error.message).to.contain(pool33[view]!)
        })
      }

      it('accepts a policy whose four dependencies are the pool’s, in any case', async () => {
        const lower = {
          hub: hub!.toLowerCase(),
          hubRegistry: hubRegistry!.toLowerCase(),
          multiAdapter: multiAdapter!.toLowerCase(),
          shareClassManager: shareClassManager!.toLowerCase(),
        }
        const subject = installable(lower)

        const result = await lastStatus(subject.pool.installHubPolicy(PREVIEW))

        expect(result.type).to.equal('TransactionConfirmed')
      })

      for (const view of ['hub', 'hubRegistry', 'multiAdapter', 'shareClassManager'] as const) {
        it(`a contract that fails to answer ${view}(), so it is no StdHubPolicy even if it answers the other three`, async () => {
          const noView = () => {
            throw new ContractFunctionExecutionError(new ContractFunctionZeroDataError({ functionName: view }), {
              abi: STD_HUB_POLICY_ABI,
              functionName: view,
            })
          }

          const error = await refused({ [view]: noView })

          expect(error.message).to.match(new RegExp(`fails to answer ${view}\\(\\)`))
        })
      }

      it('nothing when a read fails for another reason, which says nothing about the policy', async () => {
        const down = () => {
          throw new Error('rpc is down')
        }

        const error = await refused({ hub: down })

        expect(error.message).to.equal('rpc is down')
      })
    })

    describe('over an installed policy', () => {
      it('ends in OutOfPolicy with nothing signed, naming setPolicy as a call to schedule', async () => {
        const subject = installable()

        const status = await judged(subject, () => subject.pool.installHubPolicy(PREVIEW))

        expect(status.calls.map((call) => [call.functionName, call.status])).to.deep.equal([
          ['setPolicy', 'needs-authorization'],
        ])
      })

      it('is scheduled with scheduleOutOfPolicy and installed by executeAuthorizations once matured', async () => {
        const subject = installable()
        const status = await judged(subject, () => subject.pool.installHubPolicy(PREVIEW))

        const scheduling = await lastStatus(subject.pool.scheduleOutOfPolicy(status))

        expect(scheduling.type).to.equal('TransactionConfirmed')
        expect(subject.sent).to.have.length(1)
        expect(initiated(subject.sent[0]!.data)).to.equal(status.batch[0]!.data)
        subject.sent.splice(0)
        subject.chain.authorizationDefault = 'matured'

        const execution = await lastStatus(subject.pool.executeAuthorizations(scheduledData(status)))

        expect(execution.type).to.equal('TransactionConfirmed')
        expect(subject.sent).to.have.length(1)
        expect(subject.sent[0]!.to.toLowerCase()).to.equal(hub!.toLowerCase())
        expect(nameOf(subject.sent[0]!.data)).to.equal('setPolicy')
        expect(argsOf(subject.sent[0]!.data)).to.deep.equal([pool33Id.raw, getAddress(PREVIEW)])
      })

      it('stays OutOfPolicy while the scheduled install has not matured', async () => {
        const subject = installable()
        const status = await judged(subject, () => subject.pool.installHubPolicy(PREVIEW))
        await subject.pool.scheduleOutOfPolicy(status)
        subject.sent.splice(0)
        subject.chain.authorizationDefault = 'pending'

        const execution = await lastStatus(subject.pool.executeAuthorizations(scheduledData(status)))

        expect(execution.type).to.equal('OutOfPolicy')
        expect(subject.sent).to.deep.equal([])
      })
    })
  })

  describe('a group that holds an install', () => {
    const otherCall = encodeFunctionData({
      abi: hubAbi,
      functionName: 'updateHubManager',
      args: [pool33Id.raw, who, true],
    })
    const setPolicyOf = (policy: HexString) =>
      encodeFunctionData({ abi: hubAbi, functionName: 'setPolicy', args: [pool33Id.raw, policy] })
    const matured = (options: Parameters<typeof subjectOf>[0] = {}) => {
      const subject = subjectOf({ contracts: [PREVIEW], ...options })
      subject.chain.installed = true
      subject.chain.authorizationDefault = 'matured'
      return subject
    }

    for (const [placed, order] of [
      ['ahead of', (install: HexString) => [install, otherCall]],
      ['after', (install: HexString) => [otherCall, install]],
    ] as const) {
      it(`sends one multicall that ends in the install when it is listed ${placed} another call, since a call after it would lose its authorization`, async () => {
        const subject = matured()

        const result = await lastStatus(subject.pool.executeAuthorizations(order(setPolicyOf(PREVIEW))))

        expect(result.type).to.equal('TransactionConfirmed')
        expect(subject.sent).to.have.length(1)
        expect(nameOf(subject.sent[0]!.data)).to.equal('multicall')
        expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal(['updateHubManager', 'setPolicy'])
      })
    }

    it('reads none of the four views of a policy when the group holds no install', async () => {
      const subject = matured()
      subject.readContract.resetHistory()

      await subject.pool.executeAuthorizations([otherCall])

      expect(
        ['hub', 'hubRegistry', 'multiAdapter', 'shareClassManager'].flatMap((name) => callsOf(subject, name))
      ).to.deep.equal([])
    })

    it('sends a lone install as the plain call, with no multicall around it', async () => {
      const subject = matured()

      await subject.pool.executeAuthorizations([setPolicyOf(PREVIEW)])

      expect(subject.sent.map((tx) => nameOf(tx.data))).to.deep.equal(['setPolicy'])
    })

    it('builds as one transaction with the install last, since the Hub refuses only setAdapters inside a batch', async () => {
      const subject = matured()

      const built = await subject.centrifuge.buildOnly(
        subject.pool.executeAuthorizations([setPolicyOf(PREVIEW), otherCall]) as any
      )

      expect(nameOf(built.data)).to.equal('multicall')
      expect(built.calls.map((call) => nameOf(call.data))).to.deep.equal(['updateHubManager', 'setPolicy'])
    })

    it('judges every call before the first is signed, so a refusal of the install sends nothing', async () => {
      const subject = matured()
      subject.chain.authorizationOfCall.set(setPolicyOf(PREVIEW).toLowerCase(), 'pending')

      const result = await lastStatus(subject.pool.executeAuthorizations([otherCall, setPolicyOf(PREVIEW)]))

      expect(result.type).to.equal('OutOfPolicy')
      expect(subject.sent).to.deep.equal([])
    })

    it('holds one install at most, since the first orphans the authorization of the next', async () => {
      const subject = matured()

      const error = await refusal(() =>
        subject.pool.executeAuthorizations([setPolicyOf(PREVIEW), setPolicyOf(OTHER_HUB)])
      )

      expect(error.message).to.match(/installs one policy/)
      expect(subject.sent).to.deep.equal([])
    })

    describe('next to setAdapters, which the Hub refuses inside a batch', () => {
      const withAdapters = async () => {
        const subject = matured({ contracts: [PREVIEW, adapter], reads: { entrypoint: multiAdapter } })
        const [setAdaptersCall] = await callsBuiltBy(
          subject,
          subject.pool.setAdapters([{ centrifugeId: SPOKE, localAdapters: [adapter], remoteAdapters: [adapter] }])
        )
        return { subject, group: [setAdaptersCall!, otherCall, setPolicyOf(PREVIEW)] }
      }

      it('sends setAdapters in a transaction of its own, then one multicall that ends in the install', async () => {
        const { subject, group } = await withAdapters()

        await subject.pool.executeAuthorizations(group)

        expect(subject.sent.map((tx) => nameOf(tx.data))).to.deep.equal(['setAdapters', 'multicall'])
        expect(inner(subject.sent[1]!.data).map(nameOf)).to.deep.equal(['updateHubManager', 'setPolicy'])
      })

      it('hands a wallet that takes wallet_sendCalls one bundle in that order', async () => {
        const { subject, group } = await withAdapters()
        const bundles: { to: HexString; data: HexString }[][] = []
        const receipt = (hash: HexString) => ({
          status: '0x1',
          blockNumber: '0x1',
          gasUsed: '0x1',
          transactionHash: hash,
          logs: [],
        })
        const plain = recordingWallet(subject.sent)
        subject.centrifuge.setSigner({
          request: async ({ method, params }: { method: string; params?: any[] }) => {
            if (method === 'wallet_getCapabilities')
              return { [`0x${SEPOLIA.toString(16)}`]: { atomic: { status: 'supported' } } }
            if (method === 'wallet_sendCalls') {
              bundles.push(params![0].calls)
              return { id: 'bundle-1' }
            }
            if (method === 'wallet_getCallsStatus') return { status: 200, receipts: [receipt(`0x${'11'.repeat(32)}`)] }
            return plain.request({ method, params })
          },
        } as any)

        await subject.pool.executeAuthorizations(group)

        expect(subject.sent).to.deep.equal([])
        expect(bundles).to.have.length(1)
        expect(bundles[0]!.map((call) => nameOf(call.data))).to.deep.equal(['setAdapters', 'multicall'])
        expect(inner(bundles[0]![1]!.data).map(nameOf)).to.deep.equal(['updateHubManager', 'setPolicy'])
      })
    })

    describe('naming an address no pool may install', () => {
      const statusOf = (...calls: [HexString, 'needs-authorization' | 'ready'][]): OperationOutOfPolicyStatus => ({
        id: 'status',
        type: 'OutOfPolicy',
        title: 'Update',
        calls: [],
        batch: calls.map(([data, status]) => ({ data, status, deferred: false })),
      })
      const paths: [string, (subject: ReturnType<typeof matured>, policy: HexString) => PromiseLike<unknown>][] = [
        [
          'executeAuthorizations',
          (subject, policy) => subject.pool.executeAuthorizations([otherCall, setPolicyOf(policy)]),
        ],
        [
          'scheduleOutOfPolicy',
          (subject, policy) =>
            subject.pool.scheduleOutOfPolicy(
              statusOf([otherCall, 'needs-authorization'], [setPolicyOf(policy), 'needs-authorization'])
            ),
        ],
        [
          'initiateAuthorizations',
          (subject, policy) => subject.pool.initiateAuthorizations([otherCall, setPolicyOf(policy)]),
        ],
      ]

      it('sends a raw setPolicy(poolId, 0) through initiateAuthorizations, to remove the policy', async () => {
        const subject = matured()

        const built = await subject.centrifuge.buildOnly(
          subject.pool.initiateAuthorizations([setPolicyOf(zeroAddress)]) as any
        )
        const result = await lastStatus(subject.pool.initiateAuthorizations([setPolicyOf(zeroAddress)]))

        expect(nameOf(built.data)).to.equal('initiateAuthorization')
        expect(result.type).to.equal('TransactionConfirmed')
        expect(argsOf(argsOf(subject.sent[0]!.data)[1] as HexString)).to.deep.equal([pool33Id.raw, zeroAddress])
      })

      it('executes a matured setPolicy(poolId, 0), last in the multicall like any install', async () => {
        const subject = matured()

        const result = await lastStatus(subject.pool.executeAuthorizations([setPolicyOf(zeroAddress), otherCall]))

        expect(result.type).to.equal('TransactionConfirmed')
        expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal(['updateHubManager', 'setPolicy'])
        expect(argsOf(inner(subject.sent[0]!.data)[1]!)).to.deep.equal([pool33Id.raw, zeroAddress])
      })

      it('still refuses a nonzero address that is no policy of this pool, since only the zero address is exempt', async () => {
        const subject = matured({ contracts: [] })

        const error = await refusal(() => subject.pool.executeAuthorizations([setPolicyOf(PREVIEW), otherCall]))

        expect(error.message).to.match(/has no code/)
        expect(subject.sent).to.deep.equal([])
      })

      it('still refuses the zero address through installHubPolicy, which would not name a policy', async () => {
        const subject = matured()

        const error = await refusal(() => subject.pool.installHubPolicy(zeroAddress))

        expect(error.message).to.match(/zero address/)
      })

      for (const [method, run] of paths) {
        describe(method, () => {
          it('sends a policy built for the pool, which is the control for the refusals', async () => {
            const subject = matured()

            const result = (await run(subject, PREVIEW)) as { type: string } | undefined

            expect(result?.type).to.equal('TransactionConfirmed')
          })

          it('passes the zero address, which removes the policy and is refused by installHubPolicy alone', async () => {
            const subject = matured()

            const result = (await run(subject, zeroAddress)) as { type: string } | undefined

            expect(result?.type).to.equal('TransactionConfirmed')
            expect(subject.sent).to.have.length(1)
          })

          it('refuses an address with no code, which nothing can have deployed', async () => {
            const subject = matured({ contracts: [] })

            const error = await refusal(() => run(subject, PREVIEW))

            expect(error.message).to.match(/has no code/)
            expect(subject.sent).to.deep.equal([])
          })

          it('refuses a policy built for another hub', async () => {
            const subject = matured({ reads: policyViews({ hub: OTHER_HUB }) })

            const error = await refusal(() => run(subject, PREVIEW))

            expect(error.message).to.contain('hub()')
            expect(subject.sent).to.deep.equal([])
          })

          it('refuses the policy installed already', async () => {
            const subject = matured({ contracts: [POLICY] })

            const error = await refusal(() => run(subject, POLICY))

            expect(error.message).to.match(/installed already/)
            expect(subject.sent).to.deep.equal([])
          })
        })
      }
    })

    describe('when it is scheduled', () => {
      const statusOf = (...calls: [HexString, 'needs-authorization' | 'ready'][]): OperationOutOfPolicyStatus => ({
        id: 'status',
        type: 'OutOfPolicy',
        title: 'Update',
        calls: [],
        batch: calls.map(([data, status]) => ({ data, status, deferred: false })),
      })

      it('refuses a ready install next to a call to schedule, which it would orphan', async () => {
        const subject = matured()

        const error = await refusal(() =>
          subject.pool.scheduleOutOfPolicy(
            statusOf([otherCall, 'needs-authorization'], [setPolicyOf(PREVIEW), 'ready'])
          )
        )

        expect(error.message).to.match(/installing a policy orphans the authorizations/)
        expect(subject.sent).to.deep.equal([])
      })

      it('schedules an install next to another call, since scheduling consumes nothing', async () => {
        const subject = matured()

        const result = await lastStatus(
          subject.pool.scheduleOutOfPolicy(
            statusOf([otherCall, 'needs-authorization'], [setPolicyOf(PREVIEW), 'needs-authorization'])
          )
        )

        expect(result.type).to.equal('TransactionConfirmed')
        expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal([
          'initiateAuthorization',
          'initiateAuthorization',
        ])
      })
    })
  })

  describe('on a v3.2 pool', () => {
    const v32 = () => {
      const subject = subjectOf({ contracts: [PREVIEW] })
      return { ...subject, pool: new Pool(subject.centrifuge, pool32Id) }
    }
    const methods: [string, (pool: Pool) => PromiseLike<unknown>][] = [
      ['Pool.hubPolicyDependencies', (pool) => pool.hubPolicyDependencies()],
      ['Pool.previewHubPolicy', (pool) => pool.previewHubPolicy(config)],
      ['Pool.deployHubPolicy', (pool) => pool.deployHubPolicy(config)],
      ['Pool.installHubPolicy', (pool) => pool.installHubPolicy(PREVIEW)],
    ]

    for (const [name, run] of methods) {
      it(`${name} throws UnsupportedForProtocolVersionError, naming itself, with nothing signed`, async () => {
        const subject = v32()

        const error = await refusal(() => run(subject.pool))

        expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
        expect(error.message).to.contain(name)
        expect(subject.sent).to.deep.equal([])
      })
    }
  })
})
