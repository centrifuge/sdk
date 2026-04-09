import type { Centrifuge } from '../Centrifuge.js'
import type { HexString, ProtocolContracts } from '../types/index.js'
import type {
  SafeAdminInfo,
  SafeAdminOwner,
  SafeAdminPendingTransaction,
  SafeAdminProposalPayload,
  SafeInfoResponse,
  SafeQueueListItem,
  SafeQueuePage,
} from '../types/safe.js'
import type { SafeMultisigTransactionResponse, Transaction } from '../types/transaction.js'
import type { PreparedTransaction } from '../utils/transaction.js'
import {
  buildRawTransactionPayload,
  createSafeTransactionProposedStatus,
  doTransaction,
} from '../utils/transaction.js'
import { type CentrifugeId } from '../utils/types.js'
import { buildSafeProposalPayload } from './payload.js'
import { getSafeAdminPendingTransactionPermissions } from '../types/safe.js'
import { concatHex, decodeFunctionData, zeroAddress } from 'viem'
import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, mainnet, sepolia } from 'viem/chains'
import {
  HUB_DECODE_ABI,
  HUB_FUNCTION_LABELS,
  SAFE_CLIENT_BASE_URL,
  SAFE_EXEC_ABI,
  SAFE_TX_TYPES,
} from './config.js'

function decodeHubCalldata(data: string | null | undefined): string | null {
  if (!data || data === '0x') return null
  try {
    const { functionName, args } = decodeFunctionData({ abi: HUB_DECODE_ABI, data: data as HexString })
    if (functionName === 'multicall' || functionName === 'executeMulticall') {
      const innerCalls = args[0] as HexString[]
      // Collect unique action labels, preserving order — first occurrence wins
      const seen = new Set<string>()
      for (const innerData of innerCalls) {
        try {
          const { functionName: innerName } = decodeFunctionData({ abi: HUB_DECODE_ABI, data: innerData })
          const label = HUB_FUNCTION_LABELS[innerName] ?? innerName
          seen.add(label)
        } catch {
          // ignore undecoded inner calls
        }
      }
      const labels = [...seen]
      return labels.length > 0 ? labels[0]! : null
    }
    return HUB_FUNCTION_LABELS[functionName] ?? functionName
  } catch {
    return null
  }
}


export type SafeAdminWrapperConfig = {
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
    const [chainId, protocolAddresses] = await Promise.all([
      this.#resolveChainId(centrifugeId),
      this.#root._protocolAddresses(centrifugeId),
    ])
    const hubAddress = (protocolAddresses as ProtocolContracts).hub?.toLowerCase()

    const results = await this.#fetchAllTransactionItems(
      `/v1/chains/${chainId}/safes/${safeAddress}/transactions/queued`
    )

    const normalized = results
      .map((item) => this.#normalizePendingTransaction(item))
      .filter((item): item is SafeAdminPendingTransaction => item !== null)

    // The queue endpoint only returns confirmation counts, not individual signers.
    // Fetch full details from the Transaction Service in parallel to get accurate confirmedBy and data.
    return Promise.all(
      normalized.map(async (tx) => {
        if (!tx.safeTxHash) return tx
        try {
          const details = await this.#getTransaction(centrifugeId, tx.safeTxHash)
          const txData = (details.data ?? tx.data ?? null) as HexString | null
          const decoded = decodeHubCalldata(txData)
          return {
            ...tx,
            confirmedBy: (details.confirmations ?? []).map((c) => c.owner as HexString),
            data: txData,
            humanDescription: decoded ?? tx.humanDescription ?? null,
            group: hubAddress
              ? tx.target?.toLowerCase() === hubAddress
                ? ('hub' as const)
                : ('spoke' as const)
              : undefined,
          }
        } catch {
          return tx
        }
      })
    )
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

  /**
   * Generic Safe proposal. Wraps any prepared SDK transaction as a Safe tx,
   * signs it, and posts it to the Safe Transaction Service.
   *
   * Usage:
   *   safeAdmin.propose(
   *     poolId.centrifugeId,
   *     safeAddress,
   *     await shareClass.prepareUpdateSharePrice(price, date, safeAddress),
   *     'Update share price'
   *   )
   */
  propose(
    centrifugeId: CentrifugeId,
    safeAddress: HexString,
    prepared: PreparedTransaction,
    title: string
  ): Transaction {
    const self = this
    return this.#root._transact(async function* (ctx) {
      const safeInfo = await self.getSafeInfo(centrifugeId, safeAddress)
      const isOwner = safeInfo.owners.some((o) => o.address.toLowerCase() === ctx.signingAddress.toLowerCase())
      if (!isOwner) {
        throw new Error(`Connected wallet "${ctx.signingAddress}" is not an owner of Safe "${safeAddress}"`)
      }

      const publicClient = await self.#root.getClient(centrifugeId)
      const rawPayload = await buildRawTransactionPayload(
        { root: self.#root, centrifugeId, executionAddress: safeAddress },
        prepared
      )
      const proposal = await buildSafeProposalPayload({
        rawPayload,
        safeAddress,
        sender: ctx.signingAddress,
        publicClient,
        nonce: await self.getNextNonce(centrifugeId, safeAddress),
      })

      const id = Math.random().toString(36).substring(2)
      yield { id, type: 'SigningTransaction', title } as const

      const signature = await ctx.walletClient.signTypedData({
        account: ctx.walletClient.account ?? ctx.signingAddress,
        domain: { chainId: ctx.chain.id, verifyingContract: safeAddress },
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

      const chainId = await self.#resolveChainId(centrifugeId)
      await self.#fetchJson(`/v1/chains/${chainId}/transactions/${safeAddress}/propose`, {
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
          origin: self.#config.origin ?? 'centrifuge-apps-v3',
        }),
      })

      const result = createSafeTransactionProposedStatus({
        id,
        title,
        safeAddress,
        safeTxHash: proposal.safeTxHash,
        nonce: Number(proposal.nonce),
        proposer: ctx.signingAddress,
      })

      yield result
      return result
    }, centrifugeId)
  }

  confirmPendingTransaction(centrifugeId: CentrifugeId, safeAddress: HexString, safeTxHash: HexString): Transaction {
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
          confirmedBy: (transaction.confirmations ?? []).map((c) => c.owner as HexString),
        },
        safeInfo.owners
      )

      if (!permissions.isOwner) {
        throw new Error(`Connected wallet "${ctx.signingAddress}" is not an owner of Safe "${safeAddress}"`)
      }
      if (transaction.isExecuted) {
        throw new Error(`Safe transaction "${safeTxHash}" has already been executed`)
      }
      if (!permissions.canSign) {
        throw new Error(
          `Wallet "${ctx.signingAddress}" has already signed this transaction. Please connect a different Safe owner wallet to add another confirmation.`
        )
      }

      const id = Math.random().toString(36).substring(2)
      yield { id, type: 'SigningTransaction', title: 'Confirm Safe transaction' } as const

      const signature = await ctx.walletClient.signTypedData({
        account: ctx.walletClient.account ?? ctx.signingAddress,
        domain: {
          chainId: ctx.chain.id,
          verifyingContract: safeAddress,
        },
        primaryType: 'SafeTx',
        types: SAFE_TX_TYPES,
        message: {
          to: transaction.to as HexString,
          value: BigInt(transaction.value),
          data: (transaction.data ?? '0x') as HexString,
          operation: transaction.operation,
          safeTxGas: BigInt(transaction.safeTxGas),
          baseGas: BigInt(transaction.baseGas),
          gasPrice: BigInt(transaction.gasPrice),
          gasToken: transaction.gasToken as HexString,
          refundReceiver: (transaction.refundReceiver ?? zeroAddress) as HexString,
          nonce: BigInt(transaction.nonce),
        },
      })

      const chainId = await self.#resolveChainId(centrifugeId)
      await self.#fetchJson(`/v1/chains/${chainId}/transactions/${safeTxHash}/confirmations`, {
        method: 'POST',
        body: JSON.stringify({ signature }),
      })

      const result = createSafeTransactionProposedStatus({
        id,
        title: 'Confirm Safe transaction',
        safeAddress,
        safeTxHash: safeTxHash as HexString,
        nonce: Number(transaction.nonce),
        proposer: ctx.signingAddress,
      })

      yield result
      return result
    }, centrifugeId)
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
          abi: SAFE_EXEC_ABI,
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

  async #resolveChainId(centrifugeId: CentrifugeId) {
    return await this.#root._idToChain(centrifugeId)
  }

  async #getTransaction(centrifugeId: CentrifugeId, safeTxHash: HexString): Promise<SafeMultisigTransactionResponse> {
    const chainId = await this.#resolveChainId(centrifugeId)
    const networkName = this.#safeApiNetworkName(chainId)
    const url = `https://safe-transaction-${networkName}.safe.global/api/v1/multisig-transactions/${safeTxHash}/`
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Safe Transaction Service request failed (${response.status}): ${errorText || response.statusText}`)
    }
    return (await response.json()) as SafeMultisigTransactionResponse
  }

  #safeApiNetworkName(chainId: number): string {
    const name: Record<number, string> = {
      [mainnet.id]: 'mainnet',
      [base.id]: 'base',
      [arbitrum.id]: 'arbitrum',
      [sepolia.id]: 'sepolia',
      [baseSepolia.id]: 'base-sepolia',
      [arbitrumSepolia.id]: 'arbitrum-sepolia',
      [avalanche.id]: 'avalanche',
    }
    if (name[chainId]) return name[chainId]
    throw new Error(`Safe Transaction Service does not support chainId "${chainId}"`)
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
    const confirmedByFromApi = (item.transaction.confirmations ?? executionInfo.confirmations ?? [])
      .map((confirmation) => confirmation.signer?.value ?? confirmation.owner?.value ?? null)
      .filter((address): address is HexString => !!address)

    const proposerAddress =
      executionInfo.proposer?.value ??
      item.transaction.proposer?.value ??
      item.transaction.sender?.value ??
      item.transaction.txInfo?.sender?.value ??
      null

    // The proposer always signs when proposing, but the queue endpoint doesn't return
    // individual signers — only counts. Ensure the proposer is always in confirmedBy.
    const confirmedBy: HexString[] =
      proposerAddress && !confirmedByFromApi.some((a) => a.toLowerCase() === proposerAddress.toLowerCase())
        ? [proposerAddress as HexString, ...confirmedByFromApi]
        : confirmedByFromApi

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
      proposer: proposerAddress ?? confirmedBy[0] ?? null,
      confirmationsRequired: executionInfo.confirmationsRequired ?? 0,
      confirmationsSubmitted: executionInfo.confirmationsSubmitted ?? 0,
      confirmedBy,
      target: item.transaction.txInfo?.to?.value ?? null,
      data: (item.transaction.txInfo?.hexData ?? null) as HexString | null,
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
