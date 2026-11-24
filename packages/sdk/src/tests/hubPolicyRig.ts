import { ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeErrorResult,
  getAddress,
  keccak256,
  zeroAddress,
} from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { Pool } from '../entities/Pool.js'
import { PoolNetwork } from '../entities/PoolNetwork.js'
import { ShareClass } from '../entities/ShareClass.js'
import type { HexString } from '../types/index.js'
import type { OperationOutOfPolicyStatus } from '../types/transaction.js'
import { STD_HUB_POLICY_ABI } from '../utils/stdHubPolicy.js'
import {
  HUB,
  noHook,
  pool33Id,
  scId33,
  scId33b,
  setupV33,
  SPOKE,
  stubUnwiredAdapters,
  stubWiredAdapters,
  thenable,
  who,
} from './hubGroup.js'

// A v3.3 pool on the testnet registry whose hub chain is scripted: a policy that is installed or not, the delay of each
// call by function name, and an authorization in the state a test sets. The wallet records what it is asked to send.

export const POLICY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HexString
export const NOW = 10_000n
export const EXPIRY = 500
export const SIGNER = getAddress('0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d')
export const OTHER_SIGNER = getAddress('0x3333333333333333333333333333333333333333')
export const SEPOLIA = 11155111
export const INSTANT = new Set([
  'notifyPool',
  'notifyAssetPrice',
  'notifySharePrice',
  'notifyShareMetadata',
  'setPoolMetadata',
  'updateShareClassMetadata',
])
export const vaultAddress = '0x7777777777777777777777777777777777777777' as HexString
export const asset = '0x4444444444444444444444444444444444444444' as HexString
export const token = '0x2222222222222222222222222222222222222222' as HexString
export const adapter = '0x8888888888888888888888888888888888888888' as HexString
export const registrar = '0x3333333333333333333333333333333333333333' as HexString

export type Authorization = 'matured' | 'pending' | 'expired' | 'none'
export type Sent = { to: HexString; data: HexString; value: bigint }
export type Status = { type: string; calls?: OperationOutOfPolicyStatus['calls'] }

export const hubAbi = ABIS_V3_3.Hub
export const nameOf = (data: HexString) => decodeFunctionData({ abi: hubAbi, data }).functionName as string
export const argsOf = (data: HexString) => decodeFunctionData({ abi: hubAbi, data }).args as readonly any[]
export const inner = (data: HexString): HexString[] =>
  nameOf(data) === 'multicall' ? [...(argsOf(data)[0] as readonly HexString[])] : [data]
/** A canonical Freeze of a restriction hook is instant under the policy; the other restriction updates are delayed. */
export const isFreeze = (data: HexString) =>
  nameOf(data) === 'updateRestriction' && (argsOf(data)[3] as HexString).startsWith('0x02')
export const delayedOf = (calls: HexString[]) => calls.filter((call) => !INSTANT.has(nameOf(call)) && !isFreeze(call))

export const revert = (errorName: 'CallerNotAllowed' | 'OnchainAccountingOnly') =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: STD_HUB_POLICY_ABI,
      functionName: 'authorizationDelay',
      data: encodeErrorResult({ abi: STD_HUB_POLICY_ABI, errorName }),
    }),
    { abi: STD_HUB_POLICY_ABI, functionName: 'authorizationDelay', args: [] }
  )

/** What the hub chain answers about the pool's policy; flipped between an entity's run and the execution. */
export type Chain = {
  installed: boolean
  /** The authorization of a delayed call by function name; `authorizationDefault` where not listed. */
  authorization: Map<string, Authorization>
  authorizationDefault: Authorization
  /** The authorization of one calldata (lowercase), ahead of its function name's. */
  authorizationOfCall: Map<string, Authorization>
  /** The functions the policy lets through with no delay, besides a Freeze. */
  instant: Set<string>
  forbidden: Set<string>
  expiry: number | 'no answer'
}

export function recordingWallet(sent: Sent[]) {
  return {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [SIGNER]
        case 'eth_chainId':
          return `0x${SEPOLIA.toString(16)}`
        case 'eth_sendTransaction':
          sent.push({ to: params![0].to, data: params![0].data, value: BigInt(params![0].value ?? '0x0') })
          return `0x${'99'.repeat(32)}`
        default:
          throw new Error(`wallet: unexpected RPC method "${method}"`)
      }
    },
  }
}

export function rig(reads: Record<string, unknown> = {}, contracts: readonly HexString[] = []) {
  const chain: Chain = {
    installed: false,
    authorization: new Map(),
    authorizationOfCall: new Map(),
    authorizationDefault: 'matured',
    instant: new Set(INSTANT),
    forbidden: new Set(),
    expiry: EXPIRY,
  }
  const dataById = new Map<string, HexString>()
  const policyReads = {
    policy: () => (chain.installed ? POLICY : zeroAddress),
    authorizationDelay: ([, , data]: readonly [bigint, HexString, HexString]) => {
      const name = nameOf(data)
      if (chain.forbidden.has(name)) throw revert('CallerNotAllowed')
      return chain.instant.has(name) || isFreeze(data) ? 0 : 100
    },
    authId: ([, data]: readonly [bigint, HexString]) => {
      const id = keccak256(data)
      dataById.set(id, data)
      return id
    },
    authorizedAfter: ([id]: readonly [string]) => {
      const data = dataById.get(id)!
      const authorization =
        chain.authorizationOfCall.get(data.toLowerCase()) ??
        chain.authorization.get(nameOf(data)) ??
        chain.authorizationDefault
      return {
        matured: Number(NOW) - 1,
        pending: Number(NOW) + 50,
        expired: Number(NOW) - 1_000,
        none: 0,
      }[authorization]
    },
    onchainAccounting: () => false,
    simplePriceManager: () => zeroAddress,
    expiry: () => {
      if (chain.expiry === 'no answer') {
        throw new ContractFunctionRevertedError({ abi: STD_HUB_POLICY_ABI, functionName: 'expiry' })
      }
      return chain.expiry
    },
  }
  const subject = setupV33({ ...reads, ...policyReads }, contracts, { now: NOW })
  const { centrifuge } = subject
  const sent: Sent[] = []
  // A fee per message that depends on the destination and the adapters it is priced against, so equal values say
  // the same messages were priced against the same adapters, whatever way they were grouped.
  sinon
    .stub(centrifuge, '_estimate')
    .callsFake(((from: number, to: number, types: unknown[], pending?: unknown[]) =>
      thenable(
        from === to ? 0n : BigInt(types.length) * (BigInt(to) * 1_000n + BigInt(pending?.length ?? 0) * 7n)
      )) as any)
  centrifuge.setSigner(recordingWallet(sent) as any)
  return { ...subject, chain, sent }
}

/** The calls a build yields, as the calldata a group is made of. */
export async function callsBuiltBy(subject: ReturnType<typeof rig>, tx: unknown): Promise<HexString[]> {
  const built = await subject.centrifuge.buildOnly(tx as any, { fromAddress: SIGNER })
  return built.calls.map((call) => call.data)
}

export const lastStatus = async (tx: PromiseLike<unknown>) => (await tx) as Status

/**
 * Installs a policy that has scheduled nothing, runs `write` and returns the `OutOfPolicy` status it ends in, with
 * nothing signed.
 */
export async function judged(subject: { chain: Chain; sent: Sent[] }, write: () => PromiseLike<unknown>) {
  subject.chain.installed = true
  subject.chain.authorizationDefault = 'none'
  const status = (await write()) as OperationOutOfPolicyStatus
  expect(status.type).to.equal('OutOfPolicy')
  expect(subject.sent, 'nothing is signed before the status is scheduled').to.deep.equal([])
  return status
}

export const outline = (status: OperationOutOfPolicyStatus) =>
  status.batch.map(({ data, status: verdict, deferred }) => [nameOf(data), verdict, deferred])

/** The calldata an `initiateAuthorization` schedules. */
export const initiated = (data: HexString) => {
  expect(nameOf(data)).to.equal('initiateAuthorization')
  return argsOf(data)[1] as HexString
}

/** The calls of a status that `Pool.scheduleOutOfPolicy` schedules: the group `Pool.executeAuthorizations` takes. */
export const scheduledData = (status: OperationOutOfPolicyStatus) =>
  status.batch.filter((call) => call.status === 'needs-authorization').map((call) => call.data)

/** A pool whose two share classes are deployed on the hub and the spoke, so a share price update notifies both. */
export function sharePriceFixture(centrifuge: Centrifuge) {
  const pool = new Pool(centrifuge, pool33Id)
  const shareClasses = [scId33, scId33b].map((id) => new ShareClass(centrifuge, pool, id.raw))
  const networks = [HUB, SPOKE].map((id) => {
    const network = new PoolNetwork(centrifuge, pool, id)
    sinon
      .stub(network, 'details')
      .returns(thenable({ isActive: true, activeShareClasses: [{ id: scId33 }, { id: scId33b }] }) as any)
    return network
  })
  sinon.stub(pool, 'activeNetworks').returns(thenable(networks) as any)
  return { pool, shareClasses }
}

export function sharePriceRig() {
  const subject = rig()
  return { ...subject, ...sharePriceFixture(subject.centrifuge) }
}

export const FIRST_DEPLOYMENT = { isActive: false, activeShareClasses: [] }
export const deployedClass = { isActive: true, activeShareClasses: [{ id: scId33, vaults: [] }] }

/** The reads a deployment makes of the spoke, for a pool whose adapters are wired or not. */
export const DEPLOY_READS = { manager: false, requestManager: noHook, safe: who }

/** A pool whose spoke network reports `details`, with its adapters wired or not. */
export function deployFixture(centrifuge: Centrifuge, details: object, { wired = true }: { wired?: boolean } = {}) {
  const pool = new Pool(centrifuge, pool33Id)
  const network = new PoolNetwork(centrifuge, pool, SPOKE)
  sinon.stub(network, 'details').returns(thenable(details) as any)
  const others = new Map<number, PoolNetwork>()
  sinon.stub(pool, 'network').callsFake(((centrifugeId: number) => {
    if (centrifugeId === SPOKE) return thenable(network) as any
    if (!others.has(centrifugeId)) {
      const other = new PoolNetwork(centrifuge, pool, centrifugeId)
      sinon.stub(other, 'details').returns(thenable(FIRST_DEPLOYMENT) as any)
      others.set(centrifugeId, other)
    }
    return thenable(others.get(centrifugeId)) as any
  }) as any)
  if (wired) stubWiredAdapters(centrifuge)
  else stubUnwiredAdapters(centrifuge)
  return { pool, network }
}

/** A rig for {@link deployFixture}. */
export function deployRig(details: object, { wired = true, reads = {} }: { wired?: boolean; reads?: object } = {}) {
  const subject = rig({ ...DEPLOY_READS, ...reads }, [adapter])
  return { ...subject, ...deployFixture(subject.centrifuge, details, { wired }) }
}

/** Two sends carry the same calls, in the same order, to the same contract, with the same value. */
export const same = (entity: readonly Sent[], executed: readonly Sent[]) => {
  expect(executed.map((tx) => ({ ...tx, data: inner(tx.data) }))).to.deep.equal(
    entity.map((tx) => ({ ...tx, data: inner(tx.data) }))
  )
}
