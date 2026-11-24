import {
  AbiEvent,
  decodeEventLog,
  encodeFunctionData,
  LocalAccount,
  Log,
  RpcLog,
  withRetry,
  type Abi,
  type TransactionReceipt,
} from 'viem'
import { getCallsStatus, getCapabilities, sendCalls } from 'viem/actions'
import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, mainnet, sepolia } from 'viem/chains'
import {
  STANDARD_ABIS as ABI,
  defaultEventDecodeTable,
  selectEventLayout,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import type { HexString } from '../types/index.js'
import type {
  MessageTypeWithSubType,
  OperationConfirmedStatus,
  OperationOutOfPolicyStatus,
  OperationStatus,
  OutOfPolicyBatchCall,
  OutOfPolicyCall,
  PolicyCall,
  SafeMultisigTransactionResponse,
  Signer,
  TransactionContext,
} from '../types/transaction.js'
import { assertMessagesDoNotTargetDisabledChains } from './crosschainHotfix.js'
import { deferredFlags } from './hubExecutionRules.js'
import { CentrifugeId, type PoolId } from './types.js'

class TransactionError extends Error {
  override name = 'TransactionError'
  constructor(public receipt: TransactionReceipt) {
    super('Transaction reverted')
  }
}

export class ChainMismatchError extends Error {
  override name = 'ChainMismatchError'
  constructor(
    public expected: number,
    public actual: number
  ) {
    super(
      `Wallet is connected to chainId=${actual} but transaction targets chainId=${expected}. ` +
        `Refusing to submit to avoid sending funds on the wrong network.`
    )
  }
}

/**
 * Asserts that the wallet's currently-selected chain matches the chain the SDK
 * intends to submit on. Defense-in-depth: even if `_idToChain` returned a wrong
 * value (e.g. compromised indexer), the wallet itself is the source of truth
 * for "where will this tx actually land."
 */
async function assertWalletChainMatches(ctx: TransactionContext): Promise<void> {
  const expected = await ctx.root._idToChain(ctx.centrifugeId)
  const actual = await ctx.walletClient.getChainId()
  if (expected !== actual) {
    throw new ChainMismatchError(expected, actual)
  }
}

/**
 * The pool whose hub policy judges a hub call before it is sent. Every hub call an entity builds for a pool carries
 * one, except the scheduling call, which no policy classifies.
 */
export type PoolPolicyScope = { poolId: PoolId }

export type BatchTransactionData = {
  contract: HexString
  data: HexString[]
  value?: bigint
  messages?: Record<number, MessageTypeWithSubType[]>
  // Set when the target only forwards `msg.value` to its underlying calls inside
  // `multicall` (e.g. VaultRouter) — a direct single call would strand the value.
  alwaysBatch?: boolean
  pendingPoolAdapters?: PendingPoolAdaptersByChain
  /** Judges every call of `data`. */
  policy?: PoolPolicyScope
  /** After a merge, one entry per call of `data`; undefined for a call no policy judges. */
  policies?: (PoolPolicyScope | undefined)[]
}

/** The pool judging each call of a batch by position, from either way `BatchTransactionData` carries it. */
function policyScopesOf({ data, policy, policies }: Pick<BatchTransactionData, 'data' | 'policy' | 'policies'>) {
  return policies ?? data.map(() => policy)
}

/**
 * Per destination, the adapters a transaction installs as the pool's set there (`Hub.setAdapters`) before its pool
 * messages leave. The hub's MultiAdapter cannot price the pool's messages against a set it does not hold yet, so they
 * are priced against these adapters instead.
 */
export type PendingPoolAdaptersByChain = Record<CentrifugeId, readonly HexString[]>

/** Cross-chain messages merged per destination, each destination's list in the order the lists are given. */
export function mergeMessages(
  lists: readonly (Record<number, MessageTypeWithSubType[]> | undefined)[]
): Record<number, MessageTypeWithSubType[]> {
  const messages: Record<number, MessageTypeWithSubType[]> = {}
  for (const list of lists) {
    for (const [cid, types] of Object.entries(list ?? {})) {
      ;(messages[Number(cid)] ??= []).push(...types)
    }
  }
  return messages
}

/** Pending pool adapters merged per destination, each destination's adapters in the order given and without repeats. */
export function mergePendingAdapters(
  lists: readonly (PendingPoolAdaptersByChain | undefined)[]
): Record<CentrifugeId, HexString[]> {
  const pending: Record<CentrifugeId, HexString[]> = {}
  for (const list of lists) {
    for (const [cid, adapters] of Object.entries(list ?? {})) {
      pending[Number(cid)] = [...new Set([...(pending[Number(cid)] ?? []), ...adapters])]
    }
  }
  return pending
}

/**
 * One Hub batch from several transactions' batch data: calls in order, values summed, messages and pending pool
 * adapters merged per destination. Refuses batches to different contracts.
 */
export function mergeBatchTransactionData(batches: BatchTransactionData[]): BatchTransactionData {
  const contracts = [...new Set(batches.map((b) => b.contract))]
  if (contracts.length !== 1) {
    throw new Error(`Cannot batch transactions to different contracts: ${contracts.join(', ')}`)
  }
  const messages = mergeMessages(batches.map((b) => b.messages))
  const pending = mergePendingAdapters(batches.map((b) => b.pendingPoolAdapters))
  const scopes = batches.flatMap(policyScopesOf)
  return {
    contract: contracts[0]!,
    data: batches.flatMap((b) => b.data),
    value: batches.reduce((acc, b) => acc + (b.value ?? 0n), 0n),
    messages,
    alwaysBatch: batches.some((b) => b.alwaysBatch),
    ...(Object.keys(pending).length > 0 ? { pendingPoolAdapters: pending } : {}),
    ...(scopes.some((scope) => scope !== undefined) ? { policies: scopes } : {}),
  }
}

/**
 * Encode the outer calldata for a set of inner calls exactly as the signing
 * path sends it: a single inner call is sent verbatim (no multicall wrapper),
 * while two or more are wrapped in `multicall(bytes[])`. `options.alwaysBatch`
 * forces the wrapper even for a single call. Centralizing this keeps
 * `wrapTransaction` (broadcast) and `buildOnly` (build) byte-for-byte identical.
 *
 * Uses the registered `ABI.Multicall` fragment — the `multicall(bytes[])`
 * selector is identical across every protocol contract that supports batching,
 * so the encoded bytes don't depend on which contract is targeted.
 */
export function encodeBatchCalldata(data: HexString[], options?: { alwaysBatch?: boolean }): HexString {
  if (data.length === 0) throw new Error('No calldata to encode')
  if (data.length === 1 && !options?.alwaysBatch) return data[0]!
  return encodeFunctionData({
    abi: ABI.Multicall,
    functionName: 'multicall',
    args: [data],
  })
}

export async function* wrapTransaction(
  title: string,
  ctx: TransactionContext,
  {
    contract,
    data: data_,
    value: value_,
    messages,
    alwaysBatch,
    pendingPoolAdapters,
    policy,
    policies,
    gas,
  }: {
    contract: HexString
    data: HexString | HexString[]
    value?: bigint
    // The gas limit to declare when sending. Batching and building leave it to whoever sends the result.
    gas?: bigint
    // Messages to estimate gas for, that will be sent as a result of the transaction, separated by Centrifuge ID.
    // Used to estimate the payment for the transaction.
    // It is assumed that the messages belong to a single pool.
    messages?: Record<CentrifugeId, MessageTypeWithSubType[]>
    alwaysBatch?: boolean
    pendingPoolAdapters?: PendingPoolAdaptersByChain
    policy?: PoolPolicyScope
    policies?: (PoolPolicyScope | undefined)[]
  },
  options: {
    simulate: boolean
  } = { simulate: false }
): AsyncGenerator<
  OperationStatus | BatchTransactionData,
  OperationConfirmedStatus | OperationOutOfPolicyStatus | undefined
> {
  const data = Array.isArray(data_) ? data_ : [data_]
  if (ctx.isBatching) {
    yield {
      contract,
      data,
      value: value_,
      messages,
      alwaysBatch,
      ...(pendingPoolAdapters ? { pendingPoolAdapters } : {}),
      ...(policy ? { policy } : {}),
      ...(policies ? { policies } : {}),
    }
  } else {
    if (!options.simulate) {
      const judged = policyCallsOf(data, policyScopesOf({ data, policy, policies }))
      const outOfPolicy = await outOfPolicyStatus(title, ctx, judged)
      if (outOfPolicy) {
        yield outOfPolicy
        return outOfPolicy
      }
    }

    const value = await valueWithMessageFees(ctx, value_, messages, pendingPoolAdapters)

    if (!options.simulate) {
      const result = yield* doTransaction(title, ctx, async () => {
        await assertWalletChainMatches(ctx)
        // Single and batched calls both encode through `encodeBatchCalldata`, the encoder
        // `buildOnly` uses, so the built and signed bytes cannot diverge.
        return ctx.walletClient.sendTransaction({
          to: contract,
          data: encodeBatchCalldata(data, { alwaysBatch }),
          value,
          gas,
        })
      })

      return result
    }

    const call =
      data.length === 1 && !alwaysBatch
        ? { to: contract, data: data[0], value }
        : { to: contract, abi: ABI.Multicall, functionName: 'multicall', args: [data], value }
    const { results } = await ctx.publicClient.simulateCalls({ account: ctx.signingAddress, calls: [call] })

    yield { type: 'TransactionSimulation', title, result: results } satisfies OperationStatus
  }
}

/** The calls of a batch that a pool's hub policy judges, each with its pool; calls with no pool are left out. */
function policyCallsOf(data: readonly HexString[], scopes: readonly (PoolPolicyScope | undefined)[]): PolicyCall[] {
  return data.flatMap((call, index) => {
    const scope = scopes[index]
    return scope ? [{ poolId: scope.poolId, data: call }] : []
  })
}

/** The calls of an ordered send that carry a policy scope, each as a `PolicyCall`. */
function orderedPolicyCalls(calls: readonly OrderedCall[]): PolicyCall[] {
  return calls.flatMap(({ data, policy }) =>
    policy ? data.map((call) => ({ poolId: policy.poolId, data: call })) : []
  )
}

/**
 * The `OutOfPolicy` status for the calls the pools' hub policies do not let through yet, or null when every call may
 * be sent. A caller that sends more than once stops on it, so no later send is signed. The verdicts are read from the
 * chain now, for the wallet's address.
 */
export async function outOfPolicyStatus(
  title: string,
  ctx: TransactionContext,
  calls: PolicyCall[]
): Promise<OperationOutOfPolicyStatus | null> {
  if (calls.length === 0) return null
  const outOfPolicy = await ctx.root._classifyHubCalls(ctx.signingAddress, calls)
  if (outOfPolicy.length === 0) return null
  return {
    id: Math.random().toString(36).substring(2),
    type: 'OutOfPolicy',
    title,
    calls: outOfPolicy,
    batch: batchOf(calls, outOfPolicy),
  }
}

/** Every judged call in send order with its status; one calldata has one verdict, so `notReady` is looked up by it. */
function batchOf(judged: readonly PolicyCall[], notReady: readonly OutOfPolicyCall[]): OutOfPolicyBatchCall[] {
  const statuses = new Map(notReady.map(({ data, status }) => [data, status]))
  const entries = judged.map(({ data }) => ({ data, status: statuses.get(data) ?? ('ready' as const) }))
  const deferred = deferredFlags(entries)
  return entries.map((entry, index) => ({ ...entry, deferred: deferred[index]! }))
}

/** `value` plus the fees for the cross-chain messages the transaction sends, refusing a disabled destination. */
export async function valueWithMessageFees(
  ctx: TransactionContext,
  value: bigint | undefined,
  messages: Record<CentrifugeId, MessageTypeWithSubType[]> | undefined,
  pendingPoolAdapters?: PendingPoolAdaptersByChain
): Promise<bigint> {
  if (!messages) return value ?? 0n
  assertMessagesDoNotTargetDisabledChains(messages)
  const estimates = await Promise.all(
    Object.entries(messages).map(([centId, messageTypes]) => {
      const pending = pendingPoolAdapters?.[Number(centId)]
      return pending
        ? ctx.root._estimate(ctx.centrifugeId, Number(centId), messageTypes, pending)
        : ctx.root._estimate(ctx.centrifugeId, Number(centId), messageTypes)
    })
  )
  return estimates.reduce((acc, val) => acc + val, value ?? 0n)
}

/** One call of {@link sendCallsInOrder}, priced and encoded the way {@link wrapTransaction} prices and encodes it. */
export type OrderedCall = {
  title: string
  contract: HexString
  data: HexString[]
  value?: bigint
  messages?: Record<CentrifugeId, MessageTypeWithSubType[]>
  /** Priced against these when an earlier call in the same send installs them; see {@link PendingPoolAdaptersByChain}. */
  pendingPoolAdapters?: PendingPoolAdaptersByChain
  /** Wraps a single call in `multicall`, as {@link BatchTransactionData.alwaysBatch} does. */
  alwaysBatch?: boolean
  /** Judges every call of `data`; all calls of the send are judged before the first is signed. */
  policy?: PoolPolicyScope
}

/** Refuses a send of several transactions inside a build or a batch, which hold one. */
export function assertNotBatching(title: string, ctx: Pick<TransactionContext, 'isBatching'>): void {
  if (ctx.isBatching) throw new Error(`"${title}" is several transactions and cannot be batched or built as one`)
}

/**
 * Sends calls that cannot share one transaction, in order: as one EIP-5792 `wallet_sendCalls` prompt when the
 * wallet reports batching capabilities for the chain, otherwise one transaction per call, each confirmed before the next is
 * signed. Support is decided before anything is signed, so a rejected or failed prompt is never re-sent as
 * separate transactions. Every call that names a pool is judged by that pool's hub policy before the first is
 * signed. Returns the last call's confirmation, or the `OutOfPolicy` status it yielded when a call is not ready.
 */
export async function* sendCallsInOrder(
  title: string,
  ctx: TransactionContext,
  calls: OrderedCall[]
): AsyncGenerator<OperationStatus, OperationConfirmedStatus | OperationOutOfPolicyStatus> {
  if (calls.length === 0) throw new Error('No calls to send')
  assertNotBatching(title, ctx)

  const outOfPolicy = await outOfPolicyStatus(title, ctx, orderedPolicyCalls(calls))
  if (outOfPolicy) {
    yield outOfPolicy
    return outOfPolicy
  }

  const prepared = await Promise.all(
    calls.map(async (call) => ({
      title: call.title,
      to: call.contract,
      data: encodeBatchCalldata(call.data, { alwaysBatch: call.alwaysBatch }),
      value: await valueWithMessageFees(ctx, call.value, call.messages, call.pendingPoolAdapters),
    }))
  )

  if (await walletSendsCalls(ctx)) {
    const id = Math.random().toString(36).substring(2)
    yield { id, type: 'SigningTransaction', title }
    await assertWalletChainMatches(ctx)
    const { id: bundleId } = await sendCalls(ctx.walletClient, {
      account: ctx.walletClient.account,
      chain: ctx.walletClient.chain,
      calls: prepared.map(({ to, data, value }) => ({ to, data, value })),
    })
    // Polled here rather than with `waitForCallsStatus`, to report the first transaction as soon as the wallet
    // names it and to stop when the caller cancels.
    const deadline = Date.now() + CALL_BUNDLE_TIMEOUT_MS
    let pending: HexString | undefined
    while (true) {
      if (ctx.signal?.aborted) {
        throw new Error(
          `Stopped waiting for "${title}": the transaction was cancelled. The wallet may still execute call bundle ` +
            `${bundleId}; check it there before sending again.`
        )
      }
      const { status, receipts } = await getCallsStatus(ctx.walletClient, { id: bundleId })
      const first = receipts?.[0]?.transactionHash as HexString | undefined
      if (first && !pending) {
        pending = first
        yield { id, type: 'TransactionPending', title, hash: first }
      }
      if (status === 'failure' || receipts?.some((r) => r.status !== 'success')) {
        throw new Error(`"${title}" did not complete: the wallet reports call bundle ${bundleId} as failed`)
      }
      if (status === 'success') {
        const hash = receipts?.[receipts.length - 1]?.transactionHash as HexString | undefined
        if (!hash) throw new Error(`"${title}": the wallet reports call bundle ${bundleId} done without a receipt`)
        if (!pending) yield { id, type: 'TransactionPending', title, hash }
        const receipt = await ctx.publicClient.getTransactionReceipt({ hash })
        const result = { id, type: 'TransactionConfirmed', title, hash, receipt } as const
        yield result
        return result
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `"${title}": call bundle ${bundleId} is still pending after ${CALL_BUNDLE_TIMEOUT_MS / 60_000} minutes. ` +
            `It may still land; check it in the wallet before sending again.`
        )
      }
      await sleep(ctx.walletClient.pollingInterval ?? 4_000, ctx.signal)
    }
  }

  let result: OperationConfirmedStatus | undefined
  for (const call of prepared) {
    result = yield* doTransaction(call.title, ctx, async () => {
      await assertWalletChainMatches(ctx)
      return ctx.walletClient.sendTransaction({ to: call.to, data: call.data, value: call.value })
    })
  }
  return result!
}

const CALL_BUNDLE_TIMEOUT_MS = 60 * 60 * 1000

/**
 * Whether the connected wallet takes `wallet_sendCalls` on the chain: it answers EIP-5792 `wallet_getCapabilities`
 * with an entry for the chain that states its atomic batching (`atomic`, or the older `atomicBatch`). A local
 * account never does. Any `atomic` status counts, `unsupported` included: a wallet then runs the calls one after the
 * other, in order, which is all `sendCallsInOrder` needs, and is what the fallback does anyway.
 */
async function walletSendsCalls(ctx: TransactionContext): Promise<boolean> {
  const account = ctx.walletClient.account
  const chainId = ctx.walletClient.chain?.id
  if (!account || account.type === 'local' || chainId === undefined) return false
  try {
    const capabilities = (await getCapabilities(ctx.walletClient, { account, chainId })) as
      { atomic?: unknown; atomicBatch?: { supported?: boolean } } | undefined
    return !!capabilities && (capabilities.atomic !== undefined || capabilities.atomicBatch?.supported === true)
  } catch {
    return false
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function* doTransaction(
  title: string,
  ctx: TransactionContext,
  transactionCallback: () => Promise<HexString>
): AsyncGenerator<OperationStatus, OperationConfirmedStatus> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningTransaction', title }
  const hash = await transactionCallback()
  yield { id, type: 'TransactionPending', title, hash }

  const code = await ctx.publicClient.getCode({ address: ctx.signingAddress })
  if (code === SAFE_PROXY_BYTECODE) {
    return yield* waitForSafeTransaction(id, title, hash, ctx)
  }

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') {
    console.error('Transaction reverted', receipt)
    throw new TransactionError(receipt)
  }
  const result = { id, type: 'TransactionConfirmed', title, hash, receipt } as const
  yield result
  return result
}

// TODO: maybe yield Safe Transaction updates as well
async function* waitForSafeTransaction(
  id: string,
  title: string,
  hash: HexString,
  ctx: TransactionContext
): AsyncGenerator<OperationStatus, OperationConfirmedStatus> {
  const chainId = await ctx.root._idToChain(ctx.centrifugeId)
  // First check if tx is actually a safe tx
  let safeTx = await withRetry(() => getSafeTransaction(hash, chainId), {
    retryCount: 5,
    delay: 5000,
  })

  if (!safeTx.isExecuted) {
    safeTx = await withRetry(
      async () => {
        const status = await getSafeTransaction(hash, chainId)
        if (status.isExecuted) return status
        throw new Error(`Timeout waiting for safe transaction to be executed. Transaction hash: ${hash}`)
      },
      {
        retryCount: 360,
        delay: 10000,
      }
    )
  }

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: safeTx.transactionHash as HexString })
  const result = { id, type: 'TransactionConfirmed', title, hash, receipt } as const
  yield result
  return result
}

export async function* doSignMessage<T = any>(
  title: string,
  transactionCallback: () => Promise<T>
): AsyncGenerator<OperationStatus, T> {
  const id = Math.random().toString(36).substring(2)
  yield { id, type: 'SigningMessage', title }
  const message = await transactionCallback()
  yield { id, type: 'SignedMessage', title, signed: message }
  return message
}

export function isLocalAccount(signer: Signer): signer is LocalAccount {
  return 'type' in signer && signer.type === 'local'
}

// Event lookups go through @centrifuge/protocol's version-namespaced decode
// table — there is deliberately no global topic0 map: same-named
// events change signatures across protocol versions (restructure constraints,
// rule 7). While exactly one version is bundled, that version is the default;
// an ambiguous table (migration window) requires an explicit version.
function resolveEventTableVersion(protocolVersion?: ProtocolVersion): ProtocolVersion {
  if (protocolVersion) return protocolVersion
  const versions = Object.keys(defaultEventDecodeTable())
  if (versions.length !== 1) {
    throw new Error(
      `parseEventLogs requires an explicit protocolVersion when ${versions.length} ` +
        'protocol versions are registered'
    )
  }
  return versions[0]!
}

function getAbiEvent(topics: readonly HexString[], version: ProtocolVersion): AbiEvent | undefined {
  const candidates = defaultEventDecodeTable()[version]?.[topics[0]!] ?? []
  return selectEventLayout(candidates, topics)
}

// Match a block's event logs against the decode table of one protocol version.
export function parseEventLogs(parameters: {
  logs: (Log | RpcLog)[]
  eventName?: string | readonly string[]
  address?: HexString | HexString[]
  /** Defaults to the single registered protocol version; explicit once several are bundled. */
  protocolVersion?: ProtocolVersion
}): Log<bigint, number, false, undefined, true, Abi, string>[] {
  const { logs, eventName: eventName_, address: address_, protocolVersion } = parameters
  const eventName =
    eventName_ !== undefined ? new Set(typeof eventName_ === 'string' ? [eventName_] : eventName_) : null
  const address =
    address_ !== undefined
      ? new Set((Array.isArray(address_) ? address_ : [address_]).map((a) => a.toLowerCase()))
      : null
  const version = resolveEventTableVersion(protocolVersion)

  return logs
    .map((log) => {
      try {
        const abiItem = getAbiEvent(log.topics as HexString[], version)
        if (!abiItem) return null as never

        // Check that the event is one we care about
        if (eventName && eventName.size && !eventName.has(abiItem.name)) return null
        if (address && address.size && !address.has(log.address)) return null

        const event = decodeEventLog({
          ...log,
          abi: [abiItem],
          strict: true,
        })

        return { ...event, ...log }
      } catch {
        return null as never
      }
    })
    .filter(Boolean) as any
}

function safeApiNetworkName(chainId: number) {
  const name = {
    [mainnet.id]: 'mainnet',
    [base.id]: 'base',
    [arbitrum.id]: 'arbitrum',
    [sepolia.id]: 'sepolia',
    [baseSepolia.id]: 'base-sepolia',
    [arbitrumSepolia.id]: 'arbitrum-sepolia',
    [avalanche.id]: 'avalanche',
  }[chainId]

  if (name) return name
  throw new Error(`Safe API does not support chainId "${chainId}"`)
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

async function getSafeTransaction(hash: HexString, chainId: number) {
  // The host is always one of the hardcoded, verified `safe.global` domains
  // above (`safeApiNetworkName` throws on any other `chainId`), but `hash`
  // still gets interpolated into the path unescaped. It is expected to be a
  // transaction hash the SDK itself just got back from sending a transaction,
  // never free-form user input, but nothing upstream enforces that shape at
  // runtime -- so it is checked here rather than trusted, before it can turn
  // a wallet/provider bug into a malformed or redirected request.
  if (!TRANSACTION_HASH_PATTERN.test(hash)) {
    throw new Error(`getSafeTransaction: "${hash}" is not a valid transaction hash`)
  }

  const networkName = safeApiNetworkName(chainId)
  const endpoint = `https://safe-transaction-${networkName}.safe.global`
  const url = `${endpoint}/api/v1/multisig-transactions/${hash}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Error fetching Safe transaction: ${response.statusText}`)
  }
  const data = await response.json()
  return data as SafeMultisigTransactionResponse
}
