import { firstValueFrom, Observable } from 'rxjs'
import { AbiParameter, decodeAbiParameters, encodeAbiParameters, parseAbi } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import type { PoolNetwork } from '../entities/PoolNetwork.js'
import { generateExecuteProof } from '../entities/OnchainPM.js'
import { ABI } from '../abi/index.js'
import type { HexString } from '../types/index.js'
import type { MarketplaceWorkflow } from '../types/workflow.js'
import { MessageType } from '../types/transaction.js'
import { AssetId, ShareClassId } from './types.js'
import {
  buildScript,
  fillRuntimeSlots,
  type PoolContext,
  type WorkflowDefinition,
  type WorkflowStateSlot,
} from './weiroll.js'
import { computeScriptHash } from './scriptHash.js'
import { buildWorkflowDefinitionFromCatalog } from './catalog.js'

/** A whitelisted policy entry on one chain: catalog workflow + its add-time pinned values. */
export type PolicyEntryInput = {
  workflow: MarketplaceWorkflow
  configurableValues: Record<string, HexString>
  excludedActions?: number[]
}

const INTEGER_TYPE_RE = /^u?int\d*$/
const FIXED_BYTES_TYPE_RE = /^bytes([1-9]|[12]\d|3[0-2])$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ADDRESS_UINT256_ARRAY_TYPE = '(address,uint256)[]'
const ADDRESS_ADDRESS_ARRAY_TYPE = '(address,address)[]'
const ACCOUNTING_TOKEN_LIABILITY_BIT = 1n << 255n
const LIABILITY_ACCOUNTING_TOKEN_TEMPLATES = new Set([
  'erc7540_requestDeposit',
  'erc7540_claimDeposit',
  'erc7540_requestRedeem',
  'erc7540_claimRedeem',
])
const REQUEST_MESSAGE_FUNCTION_NAMES = new Set([
  'requestDeposit',
  'requestRedeem',
  'cancelDepositRequest',
  'cancelRedeemRequest',
  'enableLockDepositRequest',
  'executeLockedDepositRequest',
  'lockDepositRequest',
  'unlockDepositRequest',
])
const REQUEST_CALLBACK_MESSAGE_FUNCTION_NAMES = new Set([
  'approveDeposits',
  'approveRedeems',
  'claimDeposit',
  'claimRedeem',
  'forceCancelDepositRequest',
  'forceCancelRedeemRequest',
  'issueShares',
  'notifyDeposit',
  'notifyRedeem',
  'revokeShares',
])

type WorkflowRuntimeSlotWithSystem = Extract<WorkflowStateSlot, { type: 'runtime' }> & {
  system?: 'payableValue'
}
type EstimateCapableCentrifuge = Centrifuge & {
  _estimate: (fromCentrifugeId: number, toCentrifugeId: number, messageType: unknown) => Observable<bigint>
}
type ProtocolAddressCapableCentrifuge = Centrifuge & {
  _protocolAddresses: (centrifugeId: number) => Observable<{
    onchainPMFactory: HexString
    hub: HexString
  }>
}

function getWorkflowAbiParameter(parameter: string): AbiParameter {
  if (parameter === ADDRESS_UINT256_ARRAY_TYPE) {
    return {
      type: 'tuple[]',
      components: [{ type: 'address' }, { type: 'uint256' }],
    }
  }

  if (parameter === ADDRESS_ADDRESS_ARRAY_TYPE) {
    return {
      type: 'tuple[]',
      components: [{ type: 'address' }, { type: 'address' }],
    }
  }

  return { type: parameter }
}

type WorkflowInputSlot = Extract<WorkflowStateSlot, { type: 'configurable' | 'runtime' }>

const UPDATE_CONTRACT_SELECTOR = 'function updateContract(uint64,bytes16,bytes32,bytes,uint128,address)'
const ASYNC_REQUEST_DEPOSIT_SELECTOR = 'function requestDeposit(uint256,address,address)'
const SLIPPAGE_GUARD_ABI = parseAbi(['function onchainPMFactory() view returns (address)'])
const ACCOUNTING_TOKEN_MINTER_ABI = parseAbi(['function minters(uint64,address) view returns (bool)'])

function getSelectorFunctionName(selector: string): string {
  const match = selector.match(/^function\s+([^(]+)\(/)
  if (!match?.[1]) {
    throw new Error(`Unsupported function selector format: "${selector}"`)
  }
  return match[1]
}

function pad32left(hex: string): HexString {
  return `0x${hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as HexString
}

function pad32right(hex: string): HexString {
  return `0x${hex.replace(/^0x/, '').toLowerCase().padEnd(64, '0')}` as HexString
}

function encodeUint(value: bigint): HexString {
  return `0x${value.toString(16).padStart(64, '0')}` as HexString
}

async function resolveWorkflowExecutorAddress(centrifuge: Centrifuge, network: PoolNetwork): Promise<HexString> {
  const deployedOnchainPM = await firstValueFrom(network.onchainPM())
  if (deployedOnchainPM) {
    return deployedOnchainPM.address
  }

  const { onchainPMFactory } = await firstValueFrom(
    (centrifuge as ProtocolAddressCapableCentrifuge)._protocolAddresses(network.centrifugeId)
  )
  const client = await firstValueFrom(centrifuge.getClient(network.centrifugeId))
  const predictedOnchainPM = await client.readContract({
    address: onchainPMFactory,
    abi: ABI.OnchainPMFactory,
    functionName: 'getAddress',
    args: [network.pool.id.raw],
  })

  if (!predictedOnchainPM || predictedOnchainPM.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      `Failed to resolve OnchainPM address for pool ${network.pool.id.toString()} on centrifugeId ${network.centrifugeId}`
    )
  }

  return predictedOnchainPM
}

function resolveCatalogAddressValue(workflow: MarketplaceWorkflow, value: string | undefined): HexString | undefined {
  if (!value) return undefined
  const resolved = value.startsWith('$') ? workflow.variables[value.slice(1)] : value
  return resolved && ADDRESS_RE.test(resolved) ? (resolved as HexString) : undefined
}


function resolveWorkflowAssetAddress(workflow: MarketplaceWorkflow): HexString {
  const assetAddress = workflow.variables.asset
  if (!assetAddress || !ADDRESS_RE.test(assetAddress)) {
    throw new Error(`Workflow "${workflow.workflowRef}" is missing a valid "asset" variable`)
  }

  return assetAddress as HexString
}

function usesLiabilityAccountingToken(workflow: MarketplaceWorkflow): boolean {
  if (LIABILITY_ACCOUNTING_TOKEN_TEMPLATES.has(workflow.template)) {
    return true
  }

  throw new Error(
    `Workflow "${workflow.workflowRef}" uses accounting tokens, but template "${workflow.template}" has no accounting-token mapping`
  )
}

function toAccountingTokenId(poolIdRaw: bigint, assetAddress: HexString, liability: boolean): bigint {
  const baseId = (poolIdRaw << 160n) | BigInt(assetAddress)
  return liability ? baseId | ACCOUNTING_TOKEN_LIABILITY_BIT : baseId
}

function resolveWorkflowAccountingTokenId(network: PoolNetwork, workflow: MarketplaceWorkflow): bigint {
  // Prefer the workflow's own `toTokenId(poolId, asset, isLiability)` action, which
  // declares the exact asset + liability flag the on-chain execution uses (e.g. the
  // redeem templates hardcode `isLiability=false`). Fall back to the template guess.
  const toTokenIdAction = workflow.actions.find((action) => action.selector.startsWith('function toTokenId('))
  if (toTokenIdAction) {
    const assetAddress =
      resolveCatalogAddressValue(workflow, toTokenIdAction.inputs[1]?.input?.[0]) ??
      resolveWorkflowAssetAddress(workflow)
    const liability = toTokenIdAction.inputs[2]?.input?.[0] === 'true'
    return toAccountingTokenId(network.pool.id.raw, assetAddress, liability)
  }
  return toAccountingTokenId(
    network.pool.id.raw,
    resolveWorkflowAssetAddress(workflow),
    usesLiabilityAccountingToken(workflow)
  )
}

function parseTupleArrayLines(rawValue: string): string[] {
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseAddressUint256Array(rawValue: string): [HexString, bigint][] {
  const lines = parseTupleArrayLines(rawValue)
  if (lines.length === 0) return []

  return lines.map((line, index) => {
    const [addressRaw, valueRaw, ...rest] = line.split(',').map((part) => part.trim())
    if (!addressRaw || !valueRaw || rest.length > 0) {
      throw new Error(`Expected "address, uint256" on line ${index + 1}, got "${line}"`)
    }
    if (!ADDRESS_RE.test(addressRaw)) {
      throw new Error(`Expected address on line ${index + 1}, got "${addressRaw}"`)
    }
    return [addressRaw as HexString, BigInt(valueRaw)]
  })
}

function parseAddressAddressArray(rawValue: string): [HexString, HexString][] {
  const lines = parseTupleArrayLines(rawValue)
  if (lines.length === 0) return []

  return lines.map((line, index) => {
    const [leftRaw, rightRaw, ...rest] = line.split(',').map((part) => part.trim())
    if (!leftRaw || !rightRaw || rest.length > 0) {
      throw new Error(`Expected "address, address" on line ${index + 1}, got "${line}"`)
    }
    if (!ADDRESS_RE.test(leftRaw)) {
      throw new Error(`Expected first address on line ${index + 1}, got "${leftRaw}"`)
    }
    if (!ADDRESS_RE.test(rightRaw)) {
      throw new Error(`Expected second address on line ${index + 1}, got "${rightRaw}"`)
    }
    return [leftRaw as HexString, rightRaw as HexString]
  })
}







function normalizeExcludedActions(workflow: MarketplaceWorkflow, excludedActions: number[] = []): number[] {
  const normalized = [...excludedActions].sort((a, b) => a - b)

  for (let index = 0; index < normalized.length; index += 1) {
    const actionIndex = normalized[index]!
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= workflow.actions.length) {
      throw new Error(`Workflow "${workflow.workflowRef}" excludes invalid action index ${actionIndex}`)
    }
    if (!workflow.actions[actionIndex]?.optional) {
      throw new Error(`Workflow "${workflow.workflowRef}" action ${actionIndex} is not optional`)
    }
    if (index > 0 && normalized[index - 1] === actionIndex) {
      throw new Error(`Workflow "${workflow.workflowRef}" excludes action ${actionIndex} more than once`)
    }
  }

  return normalized
}

function hasConfigurableInputs(workflow: MarketplaceWorkflow): boolean {
  // The explicit-input-kinds format (centrifuge/workflows#86) dropped the per-input
  // `configurable` flag — configurable inputs are now variables of `kind: 'configurable'`,
  // surfaced as `configurable` state slots in the built definition. Treat a build failure
  // as "has configurable" so the legacy workflowId fallback isn't used unsafely.
  try {
    return buildWorkflowDefinitionFromCatalog(workflow).state.some((slot) => slot.type === 'configurable')
  } catch {
    return true
  }
}

function canUseLegacyCatalogWorkflowIdFallback(
  workflow: MarketplaceWorkflow,
  entry: { configurableValues?: Record<string, HexString>; excludedActions?: number[] }
): boolean {
  return (
    Object.keys(entry.configurableValues ?? {}).length === 0 &&
    (entry.excludedActions?.length ?? 0) === 0 &&
    !hasConfigurableInputs(workflow)
  )
}

function getCatalogWorkflowIdOrThrow(workflow: MarketplaceWorkflow): HexString {
  if (!/^0x[0-9a-fA-F]{64}$/.test(workflow.workflowId)) {
    throw new Error(`Workflow "${workflow.workflowRef}" is missing a valid catalog workflowId`)
  }

  return workflow.workflowId as HexString
}

function collectRequiredMagicKeys(workflowDef: WorkflowDefinition): Set<string> {
  const keys = new Set<string>()

  workflowDef.state.forEach((slot) => {
    if (slot.type === 'magic') keys.add(slot.key)
    if (slot.type === 'template') {
      collectRequiredMagicKeys(slot.workflow).forEach((key) => keys.add(key))
    }
  })

  workflowDef.actions.forEach((action) => {
    if (typeof action.target !== 'string') keys.add(action.target.key)
  })

  return keys
}

function getPayableRuntimeSlots(workflowDef: WorkflowDefinition) {
  return workflowDef.state
    .filter((slot) => slot.type === 'runtime' && (slot as WorkflowRuntimeSlotWithSystem).system === 'payableValue')
    .map((slot) => slot as WorkflowRuntimeSlotWithSystem)
    .sort((left, right) => (left.actionIndex ?? 0) - (right.actionIndex ?? 0))
}

async function estimateWorkflowActionValue(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  workflow: MarketplaceWorkflow
  action: MarketplaceWorkflow['actions'][number]
}): Promise<bigint> {
  const { centrifuge, network, workflow, action } = options
  const functionName = getSelectorFunctionName(action.selector)

  if (functionName === 'updateContract') {
    return firstValueFrom(
      (centrifuge as EstimateCapableCentrifuge)._estimate(network.centrifugeId, network.pool.centrifugeId, {
        type: MessageType.UntrustedContractUpdate,
        poolId: network.pool.id,
      })
    )
  }

  if (functionName === 'submitQueuedAssets') {
    return firstValueFrom(
      (centrifuge as EstimateCapableCentrifuge)._estimate(network.centrifugeId, network.pool.centrifugeId, {
        type: MessageType.UpdateHoldingAmount,
        poolId: network.pool.id,
      })
    )
  }

  if (functionName === 'crosschainTransferShares') {
    const destinationCentrifugeId = Number(workflow.variables.destinationCentrifugeId)
    if (!Number.isFinite(destinationCentrifugeId)) {
      throw new Error(
        `Workflow "${workflow.workflowRef}" is missing a valid "destinationCentrifugeId" variable for cross-chain transfer`
      )
    }

    return firstValueFrom(
      (centrifuge as EstimateCapableCentrifuge)._estimate(network.centrifugeId, destinationCentrifugeId, {
        type: MessageType.InitiateTransferShares,
        poolId: network.pool.id,
      })
    )
  }

  if (REQUEST_MESSAGE_FUNCTION_NAMES.has(functionName)) {
    return firstValueFrom(
      (centrifuge as EstimateCapableCentrifuge)._estimate(network.centrifugeId, network.pool.centrifugeId, {
        type: MessageType.Request,
        poolId: network.pool.id,
      })
    )
  }

  if (REQUEST_CALLBACK_MESSAGE_FUNCTION_NAMES.has(functionName)) {
    const cfgAssetId = workflow.variables.cfgAssetId
    if (!cfgAssetId) {
      throw new Error(
        `Workflow "${workflow.workflowRef}" action "${action.name ?? action.selector}" requires cfgAssetId to estimate a request callback fee`
      )
    }

    return firstValueFrom(
      (centrifuge as EstimateCapableCentrifuge)._estimate(network.centrifugeId, new AssetId(cfgAssetId).centrifugeId, {
        type: MessageType.RequestCallback,
        poolId: network.pool.id,
      })
    )
  }

  throw new Error(
    `Workflow "${workflow.workflowRef}" action "${action.name ?? action.selector}" requires valueNonZero, but fee estimation is not implemented for selector "${action.selector}"`
  )
}




export function applyWorkflowExclusions(
  workflow: MarketplaceWorkflow,
  excludedActions: number[] = []
): MarketplaceWorkflow {
  const normalized = normalizeExcludedActions(workflow, excludedActions)
  if (normalized.length === 0) return workflow

  const excluded = new Set(normalized)

  return {
    ...workflow,
    actions: workflow.actions.filter((_, index) => !excluded.has(index)),
  }
}

export function buildPreparedWorkflowDefinition(
  workflow: MarketplaceWorkflow,
  excludedActions: number[] = []
): {
  workflow: MarketplaceWorkflow
  workflowDef: WorkflowDefinition
  excludedActions: number[]
} {
  const normalizedExcludedActions = normalizeExcludedActions(workflow, excludedActions)
  const preparedWorkflow = applyWorkflowExclusions(workflow, normalizedExcludedActions)

  return {
    workflow: preparedWorkflow,
    workflowDef: buildWorkflowDefinitionFromCatalog(preparedWorkflow),
    excludedActions: normalizedExcludedActions,
  }
}

export async function resolveWorkflowShareClassId(network: PoolNetwork, scId?: HexString): Promise<HexString> {
  if (scId) return scId

  const details = await firstValueFrom(network.details())
  const shareClasses = details.activeShareClasses

  if (shareClasses.length === 0) {
    throw new Error('No active share classes found on this network')
  }
  if (shareClasses.length > 1) {
    throw new Error(
      'This group has no share class configured. Open the Groups tab, edit this group, and set a share class.'
    )
  }

  return shareClasses[0]!.id.raw
}




const HUB_PRICE_POOL_PER_ASSET_ABI = parseAbi([
  'function pricePoolPerAsset(uint64,bytes16,uint128) view returns (uint128)',
])
const ORACLE_HUB_ABI = parseAbi(['function hub() view returns (address)'])
const HUB_HOLDINGS_ABI = parseAbi(['function holdings() view returns (address)'])






const ASSET_TO_ID_SELECTOR = 'function assetToId(address,uint256)'
const HOLDINGS_IS_INITIALIZED_ABI = parseAbi(['function isInitialized(uint64,bytes16,uint128) view returns (bool)'])





export async function estimateWorkflowExecutionValue(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  workflow: MarketplaceWorkflow
  workflowDef: WorkflowDefinition
}): Promise<{ runtimeValues: Record<string, HexString>; totalValue: bigint }> {
  const { centrifuge, network, workflow, workflowDef } = options
  const payableSlots = getPayableRuntimeSlots(workflowDef)
  if (payableSlots.length === 0) {
    return { runtimeValues: {}, totalValue: 0n }
  }

  const entries = await Promise.all(
    payableSlots.map(async (slot) => {
      const actionIndex = slot.actionIndex
      if (actionIndex == null) {
        throw new Error(`Workflow "${workflow.workflowRef}" is missing payable action metadata`)
      }

      const action = workflow.actions[actionIndex]
      if (!action?.valueNonZero) {
        throw new Error(
          `Workflow "${workflow.workflowRef}" payable slot "${slot.key}" does not map to a valueNonZero action`
        )
      }

      const estimate = await estimateWorkflowActionValue({
        centrifuge,
        network,
        workflow,
        action,
      })

      return [slot.key, encodeUint(estimate), estimate] as const
    })
  )

  return {
    runtimeValues: Object.fromEntries(entries.map(([key, encoded]) => [key, encoded])) as Record<string, HexString>,
    totalValue: entries.reduce((sum, [, , value]) => sum + value, 0n),
  }
}

export async function resolveWorkflowPoolContext(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  workflowDef: WorkflowDefinition
  workflow: MarketplaceWorkflow
  strategist: HexString
  poolEscrowAddress?: HexString
  scId?: HexString
}): Promise<{ poolContext: PoolContext; resolvedScId?: HexString }> {
  const { centrifuge, network, workflowDef, workflow, poolEscrowAddress, scId } = options
  const requiredMagicKeys = collectRequiredMagicKeys(workflowDef)

  if (requiredMagicKeys.size === 0) {
    return { poolContext: {} }
  }

  const poolContext: PoolContext = {}

  if (requiredMagicKeys.has('$executor') || requiredMagicKeys.has('$onchainPM')) {
    const executor = pad32left(await resolveWorkflowExecutorAddress(centrifuge, network))
    if (requiredMagicKeys.has('$executor')) {
      poolContext.$executor = executor
    }
    if (requiredMagicKeys.has('$onchainPM')) {
      poolContext.$onchainPM = executor
    }
  }
  if (requiredMagicKeys.has('$poolId')) {
    poolContext.$poolId = encodeUint(network.pool.id.raw)
  }
  if (requiredMagicKeys.has('$poolEscrow')) {
    if (!poolEscrowAddress) throw new Error('Pool escrow address is required for this workflow')
    poolContext.$poolEscrow = pad32left(poolEscrowAddress)
  }

  const needsShareClass =
    requiredMagicKeys.has('$scId') ||
    requiredMagicKeys.has('$onOffRamp') ||
    requiredMagicKeys.has('$accountingTokenId') ||
    requiredMagicKeys.has('$accountingTokenAssetId')

  if (!needsShareClass) {
    return { poolContext }
  }

  const resolvedScId = await resolveWorkflowShareClassId(network, scId)
  const shareClassId = new ShareClassId(resolvedScId)
  const details = await firstValueFrom(network.details())
  const activeShareClass = details.activeShareClasses.find((shareClass) => shareClass.id.equals(resolvedScId))

  if (!activeShareClass) {
    throw new Error(`Share class ${resolvedScId} is not active on network ${network.centrifugeId}`)
  }

  if (requiredMagicKeys.has('$scId')) {
    poolContext.$scId = pad32right(resolvedScId)
  }

  const needsAccountingToken =
    requiredMagicKeys.has('$accountingTokenId') || requiredMagicKeys.has('$accountingTokenAssetId')
  const accountingTokenId = needsAccountingToken ? resolveWorkflowAccountingTokenId(network, workflow) : undefined

  if (requiredMagicKeys.has('$accountingTokenId')) {
    if (accountingTokenId == null) {
      throw new Error(`Workflow "${workflow.workflowRef}" is missing accounting token context`)
    }
    poolContext.$accountingTokenId = encodeUint(accountingTokenId)
  }

  if (requiredMagicKeys.has('$onOffRamp')) {
    const onOffRampManager = await firstValueFrom(network.onOfframpManager(shareClassId))
    poolContext.$onOffRamp = pad32left(onOffRampManager.onrampAddress)
  }

  if (requiredMagicKeys.has('$accountingTokenAssetId')) {
    if (accountingTokenId == null) {
      throw new Error(`Workflow "${workflow.workflowRef}" is missing accounting token context`)
    }

    const spokeAddress = workflow.variables.spoke
    if (!spokeAddress || !ADDRESS_RE.test(spokeAddress)) {
      throw new Error(`Workflow "${workflow.workflowRef}" is missing a valid "spoke" variable`)
    }
    const accountingTokenAddress = workflow.variables.accountingToken
    if (!accountingTokenAddress || !ADDRESS_RE.test(accountingTokenAddress)) {
      throw new Error(`Workflow "${workflow.workflowRef}" is missing a valid "accountingToken" variable`)
    }

    const client = await firstValueFrom(centrifuge.getClient(network.centrifugeId))
    let assetId: bigint
    try {
      assetId = await client.readContract({
        address: spokeAddress as HexString,
        abi: ABI.Spoke,
        functionName: 'assetToId',
        args: [accountingTokenAddress as HexString, accountingTokenId!],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('UnknownAsset')) {
        throw new Error(
          `Workflow "${workflow.workflowRef}" requires accounting token ${accountingTokenAddress} with tokenId ${accountingTokenId.toString()}, but that asset is not registered on spoke ${spokeAddress}.`
        )
      }
      throw error
    }

    poolContext.$accountingTokenAssetId = encodeUint(assetId)
  }

  return { poolContext, resolvedScId }
}

export async function buildWorkflowScriptBase(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  workflow: MarketplaceWorkflow
  strategist: HexString
  poolEscrowAddress?: HexString
  scId?: HexString
  configurableValues: Record<string, HexString>
  excludedActions?: number[]
}): Promise<{
  workflow: MarketplaceWorkflow
  workflowDef: WorkflowDefinition
  commands: HexString[]
  state: HexString[]
  stateBitmap: bigint
  poolContext: PoolContext
  resolvedScId?: HexString
}> {
  const { workflow: preparedWorkflow, workflowDef } = buildPreparedWorkflowDefinition(
    options.workflow,
    options.excludedActions
  )
  const { poolContext, resolvedScId } = await resolveWorkflowPoolContext({
    centrifuge: options.centrifuge,
    network: options.network,
    workflowDef,
    workflow: preparedWorkflow,
    strategist: options.strategist,
    poolEscrowAddress: options.poolEscrowAddress,
    scId: options.scId,
  })
  const { commands, state, stateBitmap } = buildScript(workflowDef, {
    poolContext,
    configurableValues: options.configurableValues,
  })

  return {
    workflow: preparedWorkflow,
    workflowDef,
    commands,
    state,
    stateBitmap,
    poolContext,
    resolvedScId,
  }
}

/**
 * Builds the full `OnchainPM.execute` argument set (commands/state/stateBitmap/proof)
 * plus the native `value` for a single added workflow. This is the same pipeline the
 * execute view runs for one workflow — extracted so several workflows can be built and
 * then batched through `OnchainPM.executeMultiple`. Runs the permission preflights
 * (throwing if the workflow isn't fully set up) and fills any payable runtime slots.
 */
/**
 * Build the full `OnchainPM.execute` argument set (commands/state/stateBitmap/proof) plus
 * native `value` for a single whitelisted policy entry. Permission preflights are NOT run
 * here — they live in the app; a keeper relies on `simulate`. `policy` is the strategist's
 * full set of entries on this chain, needed to rebuild the Merkle proof tree.
 */
export async function buildWorkflowExecuteParams(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  entry: PolicyEntryInput
  policy: PolicyEntryInput[]
  strategist: HexString
  scId?: HexString
  poolEscrowAddress?: HexString
  /** Already-encoded runtime values keyed by slot key. Account workflows have none. */
  runtimeValues?: Record<string, HexString>
}): Promise<{
  commands: HexString[]
  state: HexString[]
  stateBitmap: bigint
  callbacks: never[]
  proof: HexString[]
  value: bigint
}> {
  const { centrifuge, network, entry, policy, strategist, scId, poolEscrowAddress, runtimeValues = {} } = options

  const {
    workflow: preparedWorkflow,
    workflowDef,
    commands,
    state: baseState,
    stateBitmap,
  } = await buildWorkflowScriptBase({
    centrifuge,
    network,
    workflow: entry.workflow,
    strategist,
    poolEscrowAddress,
    scId,
    configurableValues: entry.configurableValues,
    excludedActions: entry.excludedActions ?? [],
  })

  const { runtimeValues: estimatedValueRuntimeValues, totalValue } = await estimateWorkflowExecutionValue({
    centrifuge,
    network,
    workflow: preparedWorkflow,
    workflowDef,
  })
  const state = fillRuntimeSlots(baseState, workflowDef, { ...runtimeValues, ...estimatedValueRuntimeValues })
  const currentScriptHash = computeScriptHash(commands, baseState, stateBitmap, [])
  const allGroupScriptHashes = await computeWorkflowGroupScriptHashes({
    centrifuge,
    network,
    policy,
    strategist,
    scId,
    poolEscrowAddress,
  })
  const proof = await generateExecuteProof(currentScriptHash, allGroupScriptHashes)

  return { commands, state, stateBitmap, callbacks: [], proof, value: totalValue }
}

export async function computeWorkflowScriptHash(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  workflow: MarketplaceWorkflow
  strategist: HexString
  poolEscrowAddress?: HexString
  scId?: HexString
  configurableValues: Record<string, HexString>
  excludedActions?: number[]
}): Promise<{
  workflow: MarketplaceWorkflow
  workflowDef: WorkflowDefinition
  scriptHash: HexString
  resolvedScId?: HexString
}> {
  const { workflow, workflowDef, commands, state, stateBitmap, resolvedScId } = await buildWorkflowScriptBase(options)

  return {
    workflow,
    workflowDef,
    resolvedScId,
    scriptHash: computeScriptHash(commands, state, stateBitmap, []),
  }
}

/**
 * Compute one script hash per policy entry — the leaves of the strategist's on-chain
 * Merkle root. `policy` is already this-chain only (the caller filters by chain). On a
 * build failure for an entry with no configurable/excluded customization, falls back to
 * the catalog's pre-computed `workflowId`.
 */
export async function computeWorkflowGroupScriptHashes(options: {
  centrifuge: Centrifuge
  network: PoolNetwork
  policy: PolicyEntryInput[]
  strategist: HexString
  scId?: HexString
  poolEscrowAddress?: HexString
}): Promise<HexString[]> {
  const { centrifuge, network, policy, strategist, scId, poolEscrowAddress } = options

  return Promise.all(
    policy.map(async (entry) => {
      try {
        const { scriptHash } = await computeWorkflowScriptHash({
          centrifuge,
          network,
          workflow: entry.workflow,
          strategist,
          poolEscrowAddress,
          scId,
          configurableValues: entry.configurableValues ?? {},
          excludedActions: entry.excludedActions ?? [],
        })

        return scriptHash
      } catch (error) {
        if (canUseLegacyCatalogWorkflowIdFallback(entry.workflow, entry)) {
          return getCatalogWorkflowIdOrThrow(entry.workflow)
        }
        throw error
      }
    })
  )
}







export function isWorkflowInputOptional(parameter: string): boolean {
  return parameter === ADDRESS_UINT256_ARRAY_TYPE || parameter === ADDRESS_ADDRESS_ARRAY_TYPE
}

export function encodeWorkflowInputValue(parameter: string, rawValue: string): HexString {
  const value = rawValue.trim()
  if (!value && !isWorkflowInputOptional(parameter)) {
    throw new Error(`Missing value for ${parameter}`)
  }

  if (INTEGER_TYPE_RE.test(parameter)) {
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [BigInt(value)]) as HexString
  }

  if (parameter === 'address') {
    if (!ADDRESS_RE.test(value)) {
      throw new Error(`Expected address for ${parameter}, got "${rawValue}"`)
    }
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [value as HexString]) as HexString
  }

  if (parameter === 'bool') {
    if (value !== 'true' && value !== 'false') {
      throw new Error(`Expected "true" or "false" for ${parameter}, got "${rawValue}"`)
    }
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [value === 'true']) as HexString
  }

  if (parameter === ADDRESS_UINT256_ARRAY_TYPE) {
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [parseAddressUint256Array(value)]) as HexString
  }

  if (parameter === ADDRESS_ADDRESS_ARRAY_TYPE) {
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [parseAddressAddressArray(value)]) as HexString
  }

  if (FIXED_BYTES_TYPE_RE.test(parameter)) {
    const size = Number(parameter.slice('bytes'.length))
    const expectedLength = 2 + size * 2
    if (!new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)) {
      throw new Error(`Expected ${parameter} (${expectedLength} chars) for configurable value, got "${rawValue}"`)
    }
    return encodeAbiParameters([getWorkflowAbiParameter(parameter)], [value as HexString]) as HexString
  }

  throw new Error(`Unsupported workflow input type "${parameter}"`)
}

export const encodeConfigurableValue = encodeWorkflowInputValue
