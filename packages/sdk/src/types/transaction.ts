import {
  Log,
  type Account,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
import {
  emptyMessage as encodeEmptyMessage,
  emptyMessageV3_3,
  isPoolDependentV3_3,
  MessageType,
  MessageTypeV3_3,
  PROTOCOL_VERSION_V3_3,
  toMessageTypeV3_3,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import type { Centrifuge } from '../Centrifuge.js'
import { CentrifugeId, PoolId } from '../utils/types.js'
import type { HexString } from './index.js'
import type { Query } from './query.js'

export type SafeMultisigTransactionResponse = {
  readonly safe: string
  readonly to: string
  readonly value: string
  readonly data?: string
  readonly operation: number
  readonly gasToken: string
  readonly safeTxGas: string
  readonly baseGas: string
  readonly gasPrice: string
  readonly refundReceiver?: string
  readonly nonce: string
  readonly executionDate: string | null
  readonly submissionDate: string
  readonly modified: string
  readonly blockNumber: number | null
  readonly transactionHash: string | null
  readonly safeTxHash: string
  readonly executor: string | null
  readonly proposer: string | null
  readonly proposedByDelegate: string | null
  readonly isExecuted: boolean
  readonly isSuccessful: boolean | null
  readonly ethGasPrice: string | null
  readonly maxFeePerGas: string | null
  readonly maxPriorityFeePerGas: string | null
  readonly gasUsed: number | null
  readonly fee: string | null
  readonly origin: string
  readonly dataDecoded?: any
  readonly confirmationsRequired: number
  readonly confirmations?: {
    readonly owner: string
    readonly submissionDate: string
    readonly transactionHash?: string
    readonly confirmationType?: string
    readonly signature: string
    readonly signatureType: 'CONTRACT_SIGNATURE' | 'EOA' | 'APPROVED_HASH' | 'ETH_SIGN'
  }[]
  readonly trusted: boolean
  readonly signatures: string | null
}

export type OperationStatusType =
  | 'SwitchingChain'
  | 'SigningTransaction'
  | 'SigningMessage'
  | 'SignedMessage'
  | 'TransactionPending'
  | 'TransactionConfirmed'
  | 'CustodialHandoff'
  | 'Queued'
  | 'AwaitingApprovals'
  | 'Approved'
  | 'Rejected'
  | 'Confirmed'
  | 'UnknownTxState'
  | 'AwaitingCrosschainDelivery'

export type OperationSigningStatus = {
  id: string
  type: 'SigningTransaction'
  title: string
}
export type OperationSigningMessageStatus = {
  id: string
  type: 'SigningMessage'
  title: string
}
export type OperationSignedMessageStatus = {
  id: string
  type: 'SignedMessage'
  title: string
  signed: any
}
export type OperationPendingStatus = {
  id: string
  type: 'TransactionPending'
  title: string
  hash: HexString
}
export type OperationConfirmedStatus = {
  id: string
  type: 'TransactionConfirmed'
  title: string
  hash: HexString
  receipt: TransactionReceipt
}
export type OperationSwitchChainStatus = {
  type: 'SwitchingChain'
  chainId: number
}

type SimulationResult = {
  data: HexString
  gasUsed: bigint
  status: string
  logs?: Log[]
}

export type SimulationStatus = {
  type: 'TransactionSimulation'
  title: string
  result: SimulationResult[]
}

/**
 * Why a hub call is not ready to send under the pool's hub policy.
 * - `needs-authorization`: the policy delays it and nothing is scheduled. Schedule the status with
 *   `pool.scheduleOutOfPolicy`.
 * - `pending`: scheduled, and it matures at `validAfter`.
 * - `expired`: it matured and `expiresAt` has passed. Cancel it with `pool.cancelAuthorization`, then schedule again.
 * - `undetermined`: it matured, and the policy's expiry is unknown, so it may be usable or expired.
 * - `forbidden`: the policy refuses this signer the call, and no authorization can change that. See
 *   {@link OutOfPolicyForbiddenReason}.
 */
export type OutOfPolicyCallStatus = 'needs-authorization' | 'pending' | 'expired' | 'undetermined' | 'forbidden'

/**
 * Why a `forbidden` call is refused.
 * - `callerNotAllowed`: the policy confines the signer to a list of selectors, and this one is not on it
 *   (`CallerNotAllowed`).
 * - `accountingOnly`: under onchain accounting, an accounting call from anyone but the NAVManager, a snapshot hook
 *   other than the NAVManager, or a share price update from anyone but the SimplePriceManager
 *   (`OnchainAccountingOnly`).
 * - `other`: any other revert of the policy's classification, for example a share price reference that cannot be read
 *   or calldata the policy cannot decode.
 */
export type OutOfPolicyForbiddenReason = 'callerNotAllowed' | 'accountingOnly' | 'other'

/** One inner call of a transaction that the pool's hub policy does not let through yet. */
export type OutOfPolicyCall = {
  /** The calldata of the inner call; the exact bytes to schedule. */
  data: HexString
  /** The Hub function `data` calls, by selector; null for a selector the v3.3 Hub ABI does not carry. */
  functionName: string | null
  /**
   * The arguments of the call about to be sent, by ABI input name as viem decodes them (`bigint` for a `uint64`, a
   * checksummed `address`); null when `functionName` is null or the calldata does not decode. A refund address, where
   * the call has one, is `args.refund`: an authorization is consumed only by calldata with the same refund address, so
   * compare it with the `args.refund` of an authorization item for the same call
   * (`docs/sdk/hub-policies.md`, "Refund addresses").
   */
  args: Readonly<Record<string, unknown>> | null
  status: OutOfPolicyCallStatus
  /** Why the call is refused; null unless `status` is `forbidden`. */
  reason: OutOfPolicyForbiddenReason | null
  /** Seconds the policy makes this call wait; null when `forbidden`, where it answered none. */
  delay: bigint | null
  /** Unix seconds from which the scheduled authorization can be consumed; null when none is scheduled. */
  validAfter: bigint | null
  /**
   * Unix seconds of the last second the authorization can be consumed. Set only when `status` is `expired`: the expiry
   * is read only once an authorization has matured, so it is null for every other status, `undetermined` (no expiry
   * known) included.
   */
  expiresAt: bigint | null
}

/**
 * One call of a judged transaction, with where it stands. `status` is `ready` for a call the policy lets through now,
 * else why it does not. `deferred` is true only for a ready call that `Pool.executeAuthorizations` rebuilds when a
 * group executes, given the calls of the batch that are not ready (`docs/sdk/hub-policies.md`, "Scheduling a group"):
 * `Pool.scheduleOutOfPolicy` does not send it.
 */
export type OutOfPolicyBatchCall = {
  /** The calldata of the call. */
  data: HexString
  status: 'ready' | OutOfPolicyCallStatus
  deferred: boolean
}

/** One inner call of a hub transaction and the pool whose hub policy judges it. @internal */
export type PolicyCall = { poolId: PoolId; data: HexString }

/**
 * The pool's hub policy does not let at least one inner call of the transaction through, so the transaction stops here:
 * this hub transaction is not signed or sent, a send the method made before it stays done (`docs/sdk/hub-policies.md`,
 * "What stops a method"), and a wallet on another chain was already asked to switch chain. `calls` holds only the
 * calls that are not ready, in transaction order, and `batch` every call that was judged, ready or not, in the order
 * they would have been sent. A call that names no pool is not judged and is not in `batch`: the status of a
 * `Centrifuge.batchTransactions` that merges in an `initiateAuthorizations`, and the status
 * {@link Pool.scheduleOutOfPolicy} itself ends in, lack those entries. The verdicts are read from the hub chain when
 * the transaction starts, at its latest block time. {@link Pool.scheduleOutOfPolicy} takes this status.
 *
 * An awaited transaction that ends here resolves with this status: it does not reject and has no hash, so check
 * `result.type`. `HubPolicyPreflightError` rejects.
 */
export type OperationOutOfPolicyStatus = {
  id: string
  type: 'OutOfPolicy'
  title: string
  calls: OutOfPolicyCall[]
  batch: OutOfPolicyBatchCall[]
}

export type DeployedOnOfframpManagerStatus = {
  type: 'DeployedOnOfframpManager'
  address: HexString
}

export type DeployedOnchainPMStatus = {
  type: 'DeployedOnchainPM'
  address: HexString
}

/**
 * The hub policy of a config is at its address: deployed by the transaction that was just confirmed, or, when `skipped`
 * is true, already there, so nothing was sent.
 */
export type DeployedHubPolicyStatus = {
  type: 'DeployedHubPolicy'
  address: HexString
  skipped: boolean
}

/**
 * A confirmed transaction sent cross-chain messages that the next step depends on,
 * and the SDK is waiting for the destination chain to pick them up.
 */
export type OperationAwaitingCrosschainDeliveryStatus = {
  /**
   * Same `id` as the `TransactionConfirmed` status of the transaction that sent the messages, or a
   * fresh one when they were sent by an earlier transaction the SDK found still in flight.
   */
  id: string
  type: 'AwaitingCrosschainDelivery'
  title: string
  /** The hash of the transaction that sent the messages; absent when an earlier transaction sent them. */
  hash?: HexString
  fromCentrifugeId: CentrifugeId
  toCentrifugeId: CentrifugeId
  messageTypes: MessageTypeWithSubType[]
}

/**
 * Backend mode, custodial route: the backend accepted the transaction and
 * handed it to a Fordefi vault to sign asynchronously (HTTP 202). The
 * transaction observable emits this and completes — no wallet was involved and
 * there is no hash yet.
 *
 * The rest of the custodial lifecycle (queued, awaiting approvals, approved,
 * rejected) is observed through the backend's transaction rows, not through
 * the transaction observable.
 */
export type OperationCustodialHandoffStatus = {
  /** The backend transaction id, which is also this status' id. */
  id: string
  type: 'CustodialHandoff'
  title: string
  txId: string
  signerType: 'fordefi'
  /** The backend's transaction status at hand-off, verbatim. */
  status: string
}

/**
 * The custodial lifecycle statuses.
 *
 * These six are emitted by the backend's LONG-TRACKING surface —
 * `pool.transaction(txId)` / `pool.transactionStatus(txId)` on
 * `@centrifuge/sdk/backend` — and never by the transaction observable, which
 * still completes at hand-off (the 202, {@link OperationCustodialHandoffStatus}).
 * They are members of {@link OperationStatus} so that an app can render a
 * custodial transaction with the same switch it already renders a wallet one
 * with; the tracking surface is typed on the narrower `TrackedTxStatus` union
 * exported from the subpath, so a consumer of that surface still gets exactly
 * the statuses it can receive.
 *
 * Each one echoes the backend row state it was mapped from as
 * `backendStatus`. Typed as `string` rather than the subpath's
 * `BackendTxStatus` on purpose: the root export must not import the backend
 * subpath (`sdk-root-no-backend-subpath`), and the same choice was already made
 * for {@link OperationCustodialHandoffStatus.status}. The narrow type is
 * available where the mapping lives.
 */

/**
 * With the custodian, nothing for anyone to act on yet: the backend has a row
 * (`prepared`) or Fordefi has the request but has reported no quorum
 * (`submitted_for_signing`).
 *
 * A `pending_approval` row whose `approvals` is still null lands here too,
 * rather than on {@link OperationAwaitingApprovalsStatus} with zeroed counts —
 * see the note on that type.
 */
export type OperationQueuedStatus = {
  /** The backend transaction id, which is also this status' id. */
  id: string
  type: 'Queued'
  title: string
  txId: string
  /** The backend row state this was mapped from, verbatim. */
  backendStatus: string
}

/**
 * Waiting on a human approval quorum at Fordefi.
 *
 * `collected` and `required` come from the backend's `approvals` object
 * and are the only two numbers a UI needs to say "1 of 2". They are
 * flat rather than nested so the shape matches the backend's
 * `AwaitingApprovals { collected, required }`.
 *
 * Never synthesised. A `pending_approval` row that carries no `approvals`
 * object maps to {@link OperationQueuedStatus} instead, because
 * `{ collected: 0, required: 0 }` would be a fabricated quorum: the backend
 * deliberately distinguishes "no quorum exists" (null) from "a quorum nobody
 * has voted in", and a UI rendering "0 of 0" would be stating something no
 * component of the system said.
 */
export type OperationAwaitingApprovalsStatus = {
  id: string
  type: 'AwaitingApprovals'
  title: string
  txId: string
  collected: number
  required: number
  backendStatus: string
}

/**
 * The quorum is satisfied and the transaction is signed or being broadcast,
 * but no hash has appeared yet (`signed_pending_broadcast`, `broadcast`).
 *
 * Short-lived by design: once the row carries a `txHash` the same states map to
 * {@link OperationPendingStatus}, so `Approved` is the window in which there is
 * approval to report and nothing to link to a block explorer.
 */
export type OperationApprovedStatus = {
  id: string
  type: 'Approved'
  title: string
  txId: string
  backendStatus: string
}

/** An approver declined (`approval_rejected`). Terminal; the row never signs. */
export type OperationRejectedStatus = {
  id: string
  type: 'Rejected'
  title: string
  txId: string
  backendStatus: string
}

/**
 * The tracked transaction is confirmed on chain (`confirmed`).
 *
 * **Deliberately not `TransactionConfirmed`.** That status promises a
 * `receipt: TransactionReceipt` and the backend tx view carries no receipt, so
 * reusing the discriminant would mean either synthesising one — a fabricated
 * value where a real one is expected — or widening `receipt` to optional,
 * which would break every existing `status.receipt.…` after a narrowing and is
 * exactly the compile break the custodial statuses must not cause. A consumer that needs the
 * receipt has the `hash` and can fetch it.
 */
export type OperationTrackedConfirmedStatus = {
  id: string
  type: 'Confirmed'
  title: string
  txId: string
  hash: HexString
  backendStatus: string
}

/**
 * The SDK could not place this transaction in the lifecycle.
 *
 * A VALUE and not a throw, which is the whole point of it: the tracking
 * surface is a poll, and the two things that produce this — a backend that has
 * grown a row state this SDK version has never heard of, and a row in a state
 * whose defining field is missing — are both "we cannot say where this stands",
 * not "the process is broken". Throwing would end the subscription that was
 * watching the transaction, so a vocabulary drift would take out the surface
 * that would have shown it.
 *
 * It renders as unknown, never as idle or done: `reason` says what could not be
 * mapped and `backendStatus` carries the row state verbatim, so a support
 * conversation starts from the actual value rather than from an absence.
 */
export type OperationUnknownTxStateStatus = {
  id: string
  type: 'UnknownTxState'
  title: string
  txId: string
  /** The backend row state verbatim, recognised or not. */
  backendStatus: string
  /** Why the row could not be mapped, in one sentence. */
  reason: string
}

export type OperationStatus =
  | OperationSigningStatus
  | OperationSigningMessageStatus
  | OperationSignedMessageStatus
  | OperationPendingStatus
  | OperationConfirmedStatus
  | OperationSwitchChainStatus
  | OperationCustodialHandoffStatus
  | OperationQueuedStatus
  | OperationAwaitingApprovalsStatus
  | OperationApprovedStatus
  | OperationRejectedStatus
  | OperationTrackedConfirmedStatus
  | OperationUnknownTxStateStatus
  | SimulationStatus
  | OperationOutOfPolicyStatus
  | DeployedOnOfframpManagerStatus
  | DeployedOnchainPMStatus
  | DeployedHubPolicyStatus
  | OperationAwaitingCrosschainDeliveryStatus

export type EIP1193ProviderLike = {
  request(...args: any): Promise<any>
}
export type Signer = EIP1193ProviderLike | LocalAccount

export type Transaction = Query<OperationStatus> & { centrifugeId: number }

/** A single decoded inner call within a {@link BuiltTransaction}. */
export type BuiltCall = {
  to: HexString
  data: HexString
  value: bigint
}

/**
 * The unsigned transaction envelope produced by `Centrifuge.buildOnly`. It is
 * the calldata a transaction method *would* send, with no signing or broadcast.
 *
 * - `data` is the single call's calldata, or `multicall(bytes[])` calldata when
 *   more than one inner call is wrapped, or when the method requires batching
 *   even for a single call — byte-equal to what the signing path would send
 *   for the same inputs.
 * - `calls` exposes each inner call so consumers can inspect a batch without
 *   re-parsing the multicall.
 * - `messages` carries the cross-chain messages (if any) so consumers can run
 *   the same fee estimation the signing path does.
 * - `pendingPoolAdapters` names, per destination, the adapters the transaction
 *   itself installs as the pool's set (a first activation's `Hub.setAdapters`).
 *   The pool's `messages` to that destination are priced against them: the
 *   hub's MultiAdapter does not hold them until the transaction runs, and
 *   prices the pool at nothing (v3.2) or reverts (v3.3).
 */
export type BuiltTransaction = {
  centrifugeId: number
  chainId: number
  to: HexString
  data: HexString
  value: bigint
  calls: BuiltCall[]
  messages?: Record<number, MessageTypeWithSubType[]>
  pendingPoolAdapters?: Record<number, readonly HexString[]>
}

export type BuildOnlyOptions = {
  /**
   * Address to use as the build-time `signingAddress` for methods whose
   * construction reads it (e.g. permit flows). Defaults to the zero address.
   * No signing is performed with it — it is validated as an address and never
   * used to sign.
   */
  fromAddress?: HexString
}

export type TransactionContext = {
  isBatching?: boolean
  /** Aborts when the transaction's subscriber unsubscribes; long waits inside a transaction stop on it. */
  signal?: AbortSignal
  /**
   * Build-only mode. When true, the transaction is run to produce unsigned
   * calldata (via the `wrapTransaction` batching branch) and no signing,
   * broadcasting, chain switching, or wallet-client interaction happens.
   * In this mode `signer`/`walletClient` are not backed by a real signer and
   * must not be used; build callbacks may read `signingAddress` (defaults to
   * the zero address unless a `fromAddress` is supplied to `buildOnly`).
   */
  isBuilding?: boolean
  signingAddress: HexString
  chain: Chain
  centrifugeId: number
  publicClient: PublicClient
  walletClient: WalletClient<any, Chain, Account>
  signer: Signer
  root: Centrifuge
}

/**
 * The message discriminators live in `@centrifuge/protocol` and are
 * re-exported here, so this module's surface is unchanged.
 *
 * Not tidying, and not a candidate for duplication. `MultiAdapter.estimate` is
 * payload-CONTENT sensitive — the same message padded with `0xff` instead of
 * zero cost 50,815,112,882 wei more — so the crosschain fee is a convention of
 * {@link emptyMessage} rather than a property of the protocol that two
 * implementations can each derive. The backend now prices the payloads for the
 * transactions it builds, so its bytes and these must be identical; one
 * definition is the only arrangement in which they cannot drift.
 */
export { MessageType, MessageTypeV3_3 }

export enum VaultUpdateKind {
  DeployAndLink,
  Link,
  Unlink,
}

export type MessageTypeWithSubType =
  | MessageType._Invalid
  | MessageType.ScheduleUpgrade
  | MessageType.CancelUpgrade
  | MessageType.RecoverTokens
  | MessageType.RegisterAsset
  | MessageType.SetPoolAdapters
  | {
      type:
        | MessageType.NotifyPool
        | MessageType.NotifyShareClass
        | MessageType.NotifyPricePoolPerShare
        | MessageType.NotifyPricePoolPerAsset
        | MessageType.NotifyShareMetadata
        | MessageType.UpdateShareHook
        | MessageType.InitiateTransferShares
        | MessageType.ExecuteTransferShares
        | MessageType.UpdateRestriction
        | MessageType.UpdateBalanceSheetManager
        | MessageType.UpdateGatewayManager
        | MessageType.UpdateHoldingAmount
        | MessageType.UpdateShares
        | MessageType.SetMaxAssetPriceAge
        | MessageType.SetMaxSharePriceAge
        | MessageType.Request
        | MessageType.RequestCallback
        | MessageType.SetRequestManager
        | MessageType.TrustedContractUpdate
        | MessageType.UntrustedContractUpdate
      poolId: PoolId
    }
  | { type: MessageType.UpdateVault; subtype: VaultUpdateKind; poolId: PoolId }
  /**
   * `SetPoolAdapters` naming the pool it configures. Its v3.2 payload carries
   * no pool, so the id only selects the pool's context (its version) for the
   * estimate; on v3.3 it is encoded at offset 1, where `MultiAdapter.estimate`
   * routes it over the pool's own adapter set.
   */
  | { type: MessageType.SetPoolAdapters; poolId: PoolId }
  | MessageV3_3

/**
 * A message under its v3.3 ordinal, for a call v3.3 introduced
 * (`ManagerCallFromHub`, `UpdateManager`, ...). The `protocolVersion` tag
 * keeps it apart from the v3.2 descriptors, whose ordinals overlap: v3.3's
 * `ManagerCallFromHub` is 20, which is v3.2's `SetMaxAssetPriceAge`.
 *
 * A v3.2 descriptor priced for a v3.3 pool is renumbered to its v3.3
 * counterpart (`toMessageTypeV3_3`), so the call sites whose message did not
 * change keep declaring it the v3.2 way.
 */
export type MessageV3_3 = {
  protocolVersion: '3.3'
  type: MessageTypeV3_3
  poolId: PoolId
  subtype?: VaultUpdateKind
  /** The extra gas the message carries; share transfers and hub manager calls. `GasService` adds it to the message's gas. */
  extraGasLimit?: bigint
}

/** A {@link MessageV3_3} descriptor. */
export function messageV3_3(type: MessageTypeV3_3, poolId: PoolId, subtype?: VaultUpdateKind): MessageV3_3 {
  return { protocolVersion: '3.3', type, poolId, ...(subtype !== undefined ? { subtype } : {}) }
}

/**
 * The canonical zero-padded payload for one message, as
 * `GasService.messageOverallGasLimit` and `MultiAdapter.estimate` receive it.
 *
 * A thin adapter over `@centrifuge/protocol`'s `emptyMessage`: the
 * encoding moved there so the backend and the SDK produce the SAME bytes for
 * the same message (see the note on the {@link MessageType} re-export above),
 * and what stays here is only the translation of this package's descriptor
 * shape — a discriminated union carrying a `PoolId` instance — into the
 * package's `(type, poolId, subtype)` arguments. The `?? DeployAndLink` default
 * for an absent `UpdateVault` subtype lives on the package side, so both
 * callers get it.
 *
 * `protocolVersion` is the version of the context the message is priced
 * against: on v3.3 a v3.2 descriptor is renumbered, and a v3.2 type v3.3
 * removed throws rather than pricing some other message.
 */
export function emptyMessage(type: MessageTypeWithSubType, protocolVersion?: ProtocolVersion): HexString {
  if (typeof type === 'object' && 'protocolVersion' in type) {
    if (protocolVersion !== undefined && protocolVersion !== PROTOCOL_VERSION_V3_3) {
      throw new Error(
        `Message ${MessageTypeV3_3[type.type]} exists on protocol v3.3 only, but is priced for ${protocolVersion}`
      )
    }
    const carriesPoolId = isPoolDependentV3_3(type.type) || type.type === MessageTypeV3_3.SetPoolAdapters
    return emptyMessageV3_3(
      type.type,
      carriesPoolId ? type.poolId.raw.toString() : undefined,
      type.subtype,
      type.extraGasLimit
    )
  }

  if (protocolVersion === PROTOCOL_VERSION_V3_3) {
    if (typeof type === 'object') {
      return emptyMessageV3_3(
        toMessageTypeV3_3(type.type),
        type.poolId.raw.toString(),
        type.type === MessageType.UpdateVault ? type.subtype : undefined
      )
    }
    return emptyMessageV3_3(toMessageTypeV3_3(type))
  }

  if (typeof type === 'object') {
    if (type.type === MessageType.SetPoolAdapters) return encodeEmptyMessage(type.type)
    return encodeEmptyMessage(
      type.type,
      type.poolId.raw.toString(),
      type.type === MessageType.UpdateVault ? type.subtype : undefined
    )
  }

  return encodeEmptyMessage(type)
}
