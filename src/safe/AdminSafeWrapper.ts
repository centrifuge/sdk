import type { Centrifuge } from '../Centrifuge.js'
import type { ShareClass } from '../entities/ShareClass.js'
import type { HexString } from '../types/index.js'
import type {
  SafeAdminAction,
  SafeAdminInfo,
  SafeAdminOwner,
  SafeAdminPendingTransaction,
  SafeAdminProposalPayload,
  SafeAdminResolution,
  SafeAdminResolutionInput,
} from '../types/safe.js'
import type { SafeMultisigTransactionResponse, Transaction } from '../types/transaction.js'
import {
  buildRawTransactionPayload,
  createSafeTransactionProposedStatus,
  doTransaction,
} from '../utils/transaction.js'
import { type CentrifugeId, PoolId } from '../utils/types.js'
import type { Price } from '../utils/BigInt.js'
import { buildSafeProposalPayload } from './payload.js'
import { getSafeAdminPendingTransactionPermissions } from '../types/safe.js'
import { concatHex, parseAbi, zeroAddress } from 'viem'

const SAFE_CLIENT_BASE_URL = 'https://safe-client.safe.global'

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

const SAFE_EXECUTION_ABI = parseAbi([
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)',
])

type SafeInfoResponse = {
  address: HexString
  nonce?: number | string
  threshold: number
  owners: ({ value?: HexString; name?: string | null } | HexString)[]
}

type SafeAddressRef = {
  value?: HexString
  name?: string | null
}

type SafeQueueExecutionInfo = {
  type?: string
  submittedAt?: number
  nonce?: number
  safeTxHash?: HexString
  proposer?: SafeAddressRef | null
  confirmationsRequired?: number
  confirmationsSubmitted?: number
  confirmations?: SafeQueueConfirmation[]
}

type SafeQueueTxInfo = {
  methodName?: string
  humanDescription?: string | null
  to?: SafeAddressRef
  sender?: SafeAddressRef | null
}

type SafeQueueConfirmation = {
  signer?: SafeAddressRef | null
  owner?: SafeAddressRef | null
}

type SafeQueueTransactionSummary = {
  id?: string
  timestamp?: number
  submissionDate?: string | null
  txStatus?: string
  safeTxHash?: HexString | null
  proposer?: SafeAddressRef | null
  sender?: SafeAddressRef | null
  txHash?: HexString | null
  txInfo?: SafeQueueTxInfo
  executionInfo?: SafeQueueExecutionInfo
  confirmations?: SafeQueueConfirmation[]
}

type SafeQueueListItem = {
  type?: string
  transaction?: SafeQueueTransactionSummary
}

type SafeQueuePage = {
  count?: number
  next?: string | null
  previous?: string | null
  results?: SafeQueueListItem[]
}

export type SafeAdminWrapperConfig = {
  resolveSafe: (args: SafeAdminResolutionInput) => SafeAdminResolution | null
  origin?: string
  serviceUrl?: string
}

export class SafeAdminWrapper {
  readonly #root: Centrifuge
  readonly #config: SafeAdminWrapperConfig

  constructor(root: Centrifuge, config: SafeAdminWrapperConfig) {
    this.#root = root
    this.#config = config
  }

  resolveSafe(action: SafeAdminAction, poolId: PoolId) {
    return this.#config.resolveSafe({ action, poolId })
  }

  async getSafeInfo(centrifugeId: CentrifugeId, safeAddress: HexString): Promise<SafeAdminInfo> {
    const chainId = await this.#resolveChainId(centrifugeId)
    const response = await this.#fetchJson<SafeInfoResponse>(`/v1/chains/${chainId}/safes/${safeAddress}`)

    return {
      address: response.address,
      nonce: Number(response.nonce ?? 0),
      threshold: Number(response.threshold),
      owners: (response.owners ?? [])
        .map((owner) =>
          typeof owner === 'string'
            ? { address: owner }
            : owner.value
              ? {
                  address: owner.value,
                  name: owner.name ?? null,
                }
              : null
        )
        .filter((owner): owner is SafeAdminOwner => owner !== null),
    }
  }

  async getNextNonce(centrifugeId: CentrifugeId, safeAddress: HexString): Promise<bigint> {
    const [safeInfo, pendingTransactions] = await Promise.all([
      this.getSafeInfo(centrifugeId, safeAddress),
      this.getPendingTransactions(centrifugeId, safeAddress),
    ])

    const highestPendingNonce = pendingTransactions.reduce<number>(
      (maxNonce, tx) => Math.max(maxNonce, tx.nonce),
      safeInfo.nonce - 1
    )

    return BigInt(Math.max(safeInfo.nonce, highestPendingNonce + 1))
  }

  async getPendingTransactions(centrifugeId: CentrifugeId, safeAddress: HexString): Promise<SafeAdminPendingTransaction[]> {
    const chainId = await this.#resolveChainId(centrifugeId)
    const results = await this.#fetchAllTransactionItems(
      `/v1/chains/${chainId}/safes/${safeAddress}/transactions/queued`
    )

    return results
      .map((item) => this.#normalizePendingTransaction(item))
      .filter((item): item is SafeAdminPendingTransaction => item !== null)
  }

  async getTransactionHistory(centrifugeId: CentrifugeId, safeAddress: HexString): Promise<SafeAdminPendingTransaction[]> {
    const chainId = await this.#resolveChainId(centrifugeId)
    const results = await this.#fetchAllTransactionItems(
      `/v1/chains/${chainId}/safes/${safeAddress}/transactions/history`
    )

    return results
      .map((item) => this.#normalizePendingTransaction(item))
      .filter((item): item is SafeAdminPendingTransaction => item !== null)
  }

  async prepareUpdateSharePriceProposal(
    shareClass: ShareClass,
    pricePerShare: Price,
    updatedAt: Date,
    signerAddress: HexString
  ): Promise<SafeAdminProposalPayload> {
    const resolution = this.resolveSafe('shareClass.updateSharePrice', shareClass.pool.id)
    if (!resolution) {
      throw new Error(`No admin Safe configured for pool "${shareClass.pool.id.toString()}"`)
    }

    const publicClient = await this.#root.getClient(shareClass.pool.centrifugeId)
    const prepared = await shareClass.prepareUpdateSharePrice(pricePerShare, updatedAt, resolution.safeAddress)
    const rawPayload = await buildRawTransactionPayload(
      {
        root: this.#root,
        centrifugeId: shareClass.pool.centrifugeId,
        executionAddress: resolution.safeAddress,
      },
      prepared
    )
    return buildSafeProposalPayload({
      rawPayload,
      safeAddress: resolution.safeAddress,
      sender: signerAddress,
      publicClient,
      nonce: await this.getNextNonce(shareClass.pool.centrifugeId, resolution.safeAddress),
    })
  }

  executePendingTransaction(centrifugeId: CentrifugeId, safeAddress: HexString, safeTxHash: HexString): Transaction {
    const self = this
    return this.#root._transact(async function* (ctx) {
      const [safeInfo, transaction] = await Promise.all([
        self.getSafeInfo(centrifugeId, safeAddress),
        self.#getTransaction(centrifugeId, safeTxHash),
      ])

      const permissions = getSafeAdminPendingTransactionPermissions(
        ctx.signingAddress,
        {
          isExecuted: transaction.isExecuted,
          confirmationsRequired: transaction.confirmationsRequired,
          confirmationsSubmitted: transaction.confirmations?.length ?? 0,
          confirmedBy: (transaction.confirmations ?? []).map((confirmation) => confirmation.owner as HexString),
        },
        safeInfo.owners
      )

      if (!permissions.isOwner) {
        throw new Error(`Connected wallet "${ctx.signingAddress}" is not an owner of Safe "${safeAddress}"`)
      }
      if (transaction.isExecuted) {
        throw new Error(`Safe transaction "${safeTxHash}" has already been executed`)
      }
      if (!permissions.canExecute) {
        throw new Error(
          `Safe transaction "${safeTxHash}" is not executable yet (${transaction.confirmations?.length ?? 0}/${transaction.confirmationsRequired} confirmations)`
        )
      }

      const signatures = self.#buildExecutionSignatures(transaction)

      yield* doTransaction('Execute Safe transaction', ctx, () =>
        ctx.walletClient.writeContract({
          address: safeAddress,
          abi: SAFE_EXECUTION_ABI,
          functionName: 'execTransaction',
          args: [
            transaction.to as HexString,
            BigInt(transaction.value),
            (transaction.data ?? '0x') as HexString,
            transaction.operation,
            BigInt(transaction.safeTxGas),
            BigInt(transaction.baseGas),
            BigInt(transaction.gasPrice),
            transaction.gasToken as HexString,
            (transaction.refundReceiver ?? zeroAddress) as HexString,
            signatures,
          ],
        })
      )
    }, centrifugeId)
  }

  updateSharePrice(shareClass: ShareClass, pricePerShare: Price, updatedAt = new Date()): Transaction {
    const self = this
    return this.#root._transact(async function* (ctx) {
      const resolution = self.resolveSafe('shareClass.updateSharePrice', shareClass.pool.id)
      if (!resolution) {
        throw new Error(`No admin Safe configured for pool "${shareClass.pool.id.toString()}"`)
      }

      const safeInfo = await self.getSafeInfo(shareClass.pool.centrifugeId, resolution.safeAddress)
      const isOwner = safeInfo.owners.some((owner) => owner.address.toLowerCase() === ctx.signingAddress.toLowerCase())
      if (!isOwner) {
        throw new Error(`Connected wallet "${ctx.signingAddress}" is not an owner of Safe "${resolution.safeAddress}"`)
      }

      const proposal = await self.prepareUpdateSharePriceProposal(shareClass, pricePerShare, updatedAt, ctx.signingAddress)

      const id = Math.random().toString(36).substring(2)
      yield { id, type: 'SigningTransaction', title: proposal.title } as const

      const signature = await ctx.walletClient.signTypedData({
        account: ctx.walletClient.account ?? ctx.signingAddress,
        domain: {
          chainId: ctx.chain.id,
          verifyingContract: proposal.safeAddress,
        },
        primaryType: 'SafeTx',
        types: SAFE_TX_TYPES,
        message: {
          to: proposal.to,
          value: proposal.value,
          data: proposal.data,
          operation: proposal.operation,
          safeTxGas: proposal.safeTxGas,
          baseGas: proposal.baseGas,
          gasPrice: proposal.gasPrice,
          gasToken: proposal.gasToken,
          refundReceiver: proposal.refundReceiver,
          nonce: proposal.nonce,
        },
      })

      await self.#fetchJson(`/v1/chains/${ctx.chain.id}/transactions/${resolution.safeAddress}/propose`, {
        method: 'POST',
        body: JSON.stringify({
          to: proposal.to,
          value: proposal.value.toString(),
          data: proposal.data,
          operation: proposal.operation,
          nonce: proposal.nonce.toString(),
          safeTxGas: proposal.safeTxGas.toString(),
          baseGas: proposal.baseGas.toString(),
          gasPrice: proposal.gasPrice.toString(),
          gasToken: proposal.gasToken,
          refundReceiver: proposal.refundReceiver,
          safeTxHash: proposal.safeTxHash,
          sender: proposal.sender,
          signature,
          origin: self.#config.origin ?? 'centrifuge-apps-v3-admin-safe-poc',
        }),
      })

      const result = createSafeTransactionProposedStatus({
        id,
        title: proposal.title,
        safeAddress: proposal.safeAddress,
        safeTxHash: proposal.safeTxHash,
        nonce: Number(proposal.nonce),
        proposer: ctx.signingAddress,
      })

      yield result
      return result
    }, shareClass.pool.centrifugeId)
  }

  async #resolveChainId(centrifugeId: CentrifugeId) {
    return await this.#root._idToChain(centrifugeId)
  }

  async #getTransaction(centrifugeId: CentrifugeId, safeTxHash: HexString): Promise<SafeMultisigTransactionResponse> {
    const chainId = await this.#resolveChainId(centrifugeId)
    return await this.#fetchJson<SafeMultisigTransactionResponse>(`/v1/chains/${chainId}/transactions/${safeTxHash}`)
  }

  #buildExecutionSignatures(transaction: SafeMultisigTransactionResponse): HexString {
    const confirmations = [...(transaction.confirmations ?? [])]
    if (confirmations.length === 0) {
      throw new Error(`Safe transaction "${transaction.safeTxHash}" has no collected confirmations`)
    }

    const unsupported = confirmations.find(
      (confirmation) =>
        confirmation.signatureType !== 'EOA' && confirmation.signatureType !== 'ETH_SIGN'
    )
    if (unsupported) {
      throw new Error(
        `Safe transaction "${transaction.safeTxHash}" has unsupported confirmation type "${unsupported.signatureType}"`
      )
    }

    confirmations.sort((a, b) => a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()))
    return concatHex(confirmations.map((confirmation) => confirmation.signature as HexString))
  }

  #normalizePendingTransaction(item: SafeQueueListItem): SafeAdminPendingTransaction | null {
    if (item.type !== 'TRANSACTION' || !item.transaction) return null

    const executionInfo = item.transaction.executionInfo
    if (!executionInfo || executionInfo.type !== 'MULTISIG' || executionInfo.nonce === undefined) return null
    const confirmedBy = (item.transaction.confirmations ?? executionInfo.confirmations ?? [])
      .map((confirmation) => confirmation.signer?.value ?? confirmation.owner?.value ?? null)
      .filter((address): address is HexString => !!address)

    return {
      id: item.transaction.id ?? `${this.#extractSafeTxHash(item.transaction.id) ?? executionInfo.nonce}`,
      safeTxHash:
        executionInfo.safeTxHash ??
        item.transaction.safeTxHash ??
        this.#extractSafeTxHash(item.transaction.id) ??
        null,
      nonce: executionInfo.nonce,
      methodName: item.transaction.txInfo?.methodName ?? null,
      humanDescription: item.transaction.txInfo?.humanDescription ?? null,
      submittedAt:
        executionInfo.submittedAt ??
        item.transaction.timestamp ??
        this.#toUnixTimestamp(item.transaction.submissionDate) ??
        null,
      txStatus: item.transaction.txStatus,
      proposer:
        executionInfo.proposer?.value ??
        item.transaction.proposer?.value ??
        item.transaction.sender?.value ??
        item.transaction.txInfo?.sender?.value ??
        confirmedBy[0] ??
        null,
      confirmationsRequired: executionInfo.confirmationsRequired ?? 0,
      confirmationsSubmitted: executionInfo.confirmationsSubmitted ?? 0,
      confirmedBy,
      target: item.transaction.txInfo?.to?.value ?? null,
      txHash: item.transaction.txHash ?? null,
      isExecuted: item.transaction.txStatus === 'SUCCESS',
    }
  }

  #extractSafeTxHash(value?: string | null): HexString | null {
    if (!value) return null
    const match = value.match(/(0x[a-fA-F0-9]{64})/)
    return (match?.[1] as HexString | undefined) ?? null
  }

  #toUnixTimestamp(value?: string | null): number | null {
    if (!value) return null
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return null
    return Math.floor(parsed / 1000)
  }

  async #fetchAllTransactionItems(path: string): Promise<SafeQueueListItem[]> {
    const results: SafeQueueListItem[] = []
    let nextPath: string | null = path

    while (nextPath) {
      const response = await this.#fetchJson<SafeQueuePage>(nextPath)
      results.push(...(response.results ?? []))
      nextPath = this.#toRelativePath(response.next)
    }

    return results
  }

  #toRelativePath(value?: string | null): string | null {
    if (!value) return null
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value)
      return `${url.pathname}${url.search}`
    }
    return value
  }

  async #fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.#config.serviceUrl ?? SAFE_CLIENT_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Safe service request failed (${response.status}): ${errorText || response.statusText}`)
    }

    return (await response.json()) as T
  }
}
