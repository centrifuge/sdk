import type {
  CrosschainBlockchainRef,
  CrosschainInnerMessage,
  CrosschainPoolRef,
  CrosschainTokenRef,
} from './crosschainMessages.js'

/**
 * Context used to enrich a cross-chain message description with human-readable
 * pool/token/destination labels. All fields are optional; when a label cannot be
 * resolved a `[??]` placeholder is used instead.
 *
 * These mirror the joined references returned on a {@link CrosschainMessage}
 * (`message.pool`, `message.token`, `message.toBlockchain`), so the typical call
 * site forwards them straight from the envelope:
 *
 * ```ts
 * describeCrosschainMessage(inner, {
 *   pool: message.pool,
 *   token: message.token,
 *   toBlockchain: message.toBlockchain,
 * })
 * ```
 */
export type CrosschainMessageDescriptionContext = {
  pool?: Partial<CrosschainPoolRef>
  token?: Partial<CrosschainTokenRef>
  toBlockchain?: Partial<CrosschainBlockchainRef>
  /**
   * Decimals used to scale share amounts (e.g. for transfer messages).
   * @defaultValue 18
   */
  tokenDecimals?: number
}

/** Minimal shape needed to describe a message: just its decoded `data` and type. */
export type DescribableCrosschainMessage = Pick<CrosschainInnerMessage, 'messageType' | 'data'>

/**
 * Whether {@link describeCrosschainMessage} produces a fully resolved, user-facing
 * description for a given message type. Types not yet fully implemented return a
 * best-effort placeholder; callers may use this flag to hide or flag those rows.
 */
export const CROSSCHAIN_MESSAGE_DESCRIPTION_COMPLETE: Record<string, boolean> = {
  ScheduleUpgrade: true,
  CancelUpgrade: true,
  RecoverTokens: true,
  RegisterAsset: true,
  NotifyPool: true,
  NotifyShareClass: true,
  NotifyPricePoolPerShare: true,
  NotifyPricePoolPerAsset: true,
  NotifyShareMetadata: true,
  UpdateShareHook: true,
  InitiateTransferShares: true,
  ExecuteTransferShares: true,
  UpdateRestriction: true,
  UpdateContract: true,
  UpdateVault: true,
  UpdateBalanceSheetManager: true,
  UpdateHoldingAmount: false,
  UpdateShares: false,
  MaxAssetPriceAge: false,
  MaxSharePriceAge: false,
  Request: true,
  RequestCallback: true,
  SetRequestManager: true,
}

/**
 * Returns `true` when a fully resolved description is available for `messageType`.
 * @see CROSSCHAIN_MESSAGE_DESCRIPTION_COMPLETE
 */
export function isCrosschainMessageDescriptionComplete(messageType: string): boolean {
  return CROSSCHAIN_MESSAGE_DESCRIPTION_COMPLETE[messageType] ?? false
}

// --- formatting helpers (framework-agnostic ports of the explorer renderers) ---

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

function toSafeString(value: unknown, fallback = '[??]'): string {
  if (value == null) return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  return fallback
}

type ShortenOptions = {
  /** Characters to show on each side of the ellipsis. @defaultValue 4 */
  charsToShow?: number
  /** Leading characters kept verbatim (e.g. `2` for the `0x` prefix). @defaultValue 2 */
  extraPrefix?: number
  /** Keep only the first N bytes (40 hex chars per 20 bytes) before shortening. */
  relevantBytes?: number
}

/** Shortens a hex value to e.g. `0xac4...32c`. Mirrors the explorer's `shortenedString`. */
function shortenHex(value: string, options: ShortenOptions = {}): string {
  if (!value) return value
  const { charsToShow = 4, extraPrefix = 2, relevantBytes } = options

  if (relevantBytes) {
    const relevantLength = extraPrefix + relevantBytes * 2
    if (value.length <= relevantLength) return value
    const relevantValue = value.substring(0, relevantLength)
    if (2 * charsToShow + extraPrefix >= relevantValue.length) return relevantValue
    const startChars = relevantValue.substring(0, charsToShow + extraPrefix)
    const endChars = relevantValue.substring(relevantValue.length - charsToShow)
    return `${startChars}...${endChars}`
  }

  if (2 * charsToShow + extraPrefix >= value.length) return value
  const startChars = value.substring(0, charsToShow + extraPrefix)
  const endChars = value.substring(value.length - charsToShow)
  return `${startChars}...${endChars}`
}

/** Convenience wrapper for shortening 20-byte addresses packed in a 32-byte slot. */
function shortenAddress(value: unknown): string {
  return shortenHex(toSafeString(value), { charsToShow: 3, relevantBytes: 20 })
}

/** Scales an integer string by `10 ** -decimals` into a JS number. */
function scaleDecimals(value: string, decimals = 18): number {
  return Number(value) * 10 ** -decimals
}

const numberFormatters = new Map<number, Intl.NumberFormat>()

/** Cached `Intl.NumberFormat` per fraction-digit count (locale/grouping are constant). */
function numberFormatter(decimals: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      useGrouping: true,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    numberFormatters.set(decimals, formatter)
  }
  return formatter
}

/** Rounds a number to `decimals` places with locale grouping. */
function roundNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞'
  const n = Math.round(value * 10 ** decimals) / 10 ** decimals
  return numberFormatter(decimals).format(n)
}

/** Scales an integer-string value by `decimals` and renders it with 6 fraction digits. */
function formatScaled(value: unknown, decimals: number): string {
  return roundNumber(scaleDecimals(toSafeString(value, '0'), decimals), 6)
}

function capitalizeFirstLetter(value: string | undefined): string {
  if (!value?.length) return value ?? ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** `"ThisIsMyString"` -> `"This is my string"`. */
function unCamelCase(value: string | undefined): string {
  if (!value?.length) return value ?? ''
  return value.replace(/(?<!^)[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
}

/**
 * Investor-facing label for a `Request` / `RequestCallback` payload type, aligned with the
 * app's order vocabulary (see centrifuge/apps-v3#1056):
 * - a deposit/redeem request reads as an investment/redemption,
 * - share issuance/revocation reads as the executed investment/redemption,
 * - a `Fulfilled…` callback reads as `Unlock …` (the funds/shares become claimable).
 *
 * Unmapped types fall back to a de-camel-cased label.
 */
const REQUEST_TYPE_LABELS: Record<string, string> = {
  IssuedShares: 'Executed investment',
  RevokedShares: 'Executed redemption',
}

function requestLabel(type: string | undefined): string {
  if (!type) return unCamelCase(type)
  const mapped = REQUEST_TYPE_LABELS[type]
  if (mapped) return mapped
  const unlocked = type.startsWith('Fulfilled') ? `Unlock${type.slice('Fulfilled'.length)}` : type
  const vocab = unlocked.replace('DepositRequest', 'Investment').replace('RedeemRequest', 'Redemption')
  return unCamelCase(vocab)
}

function tokenLabel(ctx: CrosschainMessageDescriptionContext): string {
  return ctx.token?.name ?? ctx.token?.symbol ?? '[??]'
}

function tokenSymbol(ctx: CrosschainMessageDescriptionContext): string {
  return ctx.token?.symbol ?? '[??]'
}

type DecodedPayload = { type?: string; data?: Record<string, unknown> } | undefined

function decodedPayloadOf(data: unknown): DecodedPayload {
  const value = asRecord(data).decodedPayload
  return value && typeof value === 'object' ? (value as DecodedPayload) : undefined
}

/**
 * Turns a cross-chain message into a short, human-readable description, e.g.
 * `"Update USDC price to 1.000000"` or `"Deploy pool Anemoy"`.
 *
 * The message's `data` is the decoded payload as returned by the indexer
 * (`CrosschainInnerMessage.data`). Pool/token/destination labels come from the
 * optional {@link CrosschainMessageDescriptionContext}.
 *
 * Some message types are not yet fully resolved and return a best-effort
 * placeholder — use {@link isCrosschainMessageDescriptionComplete} to detect them.
 */
export function describeCrosschainMessage(
  message: DescribableCrosschainMessage,
  context: CrosschainMessageDescriptionContext = {}
): string {
  const data = asRecord(message.data)
  const decimals = context.tokenDecimals ?? 18

  // Keyed off the indexer's decoded message name (e.g. 'NotifyPool'), which is distinct
  // from the on-chain `MessageType` enum used for encoding (e.g. `SetMaxAssetPriceAge`).
  switch (message.messageType) {
    case 'ScheduleUpgrade':
      return `Schedule upgrade ${shortenAddress(data.target)}`

    case 'CancelUpgrade':
      return `Cancel upgrade ${shortenAddress(data.target)}`

    case 'RecoverTokens':
      return `Recover tokens from ${shortenAddress(data.target)}`

    case 'RegisterAsset': {
      const assetId = shortenHex(toSafeString(data.assetId), { extraPrefix: 0, charsToShow: 3 })
      return data.tokenId && data.tokenId != 0
        ? `Register asset ID ${assetId} (token ID ${toSafeString(data.tokenId)})`
        : `Register asset ID ${assetId}`
    }

    case 'NotifyPool':
      return `Deploy pool ${tokenLabel(context)}`

    case 'NotifyShareClass':
      return `Deploy share token ${tokenSymbol(context)}`

    case 'NotifyPricePoolPerShare':
      return `Update ${tokenSymbol(context)} price to ${formatScaled(data.price, 18)}`

    case 'NotifyPricePoolPerAsset':
      return `Update asset price to ${formatScaled(data.price, 18)}`

    case 'NotifyShareMetadata':
      return 'Update share metadata'

    case 'UpdateShareHook':
      return `Update share hook to ${shortenAddress(data.hook)}`

    case 'InitiateTransferShares':
      return `Initiate transfer of ${formatScaled(data.amount, decimals)} ${tokenLabel(context)} to ${capitalizeFirstLetter(context.toBlockchain?.network) || '[??]'}`

    case 'ExecuteTransferShares':
      return `Transfer ${formatScaled(data.amount, decimals)} ${tokenLabel(context)} to ${capitalizeFirstLetter(context.toBlockchain?.network) || '[??]'}`

    case 'UpdateRestriction': {
      const payload = decodedPayloadOf(message.data)
      return payload?.type === 'Member'
        ? `Add ${shortenAddress(payload.data?.user)} as investor`
        : 'Freeze/unfreeze investor'
    }

    case 'UpdateContract':
      return `Call to ${shortenAddress(data.target)}`

    case 'UpdateVault':
      return data.kind == 0
        ? `Deploy ${tokenSymbol(context)} vault`
        : data.kind == 1
          ? `Link ${tokenSymbol(context)} vault`
          : `Unlink ${tokenSymbol(context)} vault`

    case 'UpdateBalanceSheetManager':
      return `Add ${shortenAddress(data.who)} as balance sheet manager`

    case 'UpdateHoldingAmount':
      return 'Update holding amount'

    case 'UpdateShares':
      return 'Update shares'

    case 'MaxAssetPriceAge':
      return 'Set asset price expiration'

    case 'MaxSharePriceAge':
      return `Set price expiration of ${tokenSymbol(context)}`

    case 'Request': {
      const payload = decodedPayloadOf(message.data)
      return `${requestLabel(payload?.type)} by ${shortenAddress(payload?.data?.investor)}`
    }

    case 'RequestCallback': {
      const payload = decodedPayloadOf(message.data)
      return requestLabel(payload?.type)
    }

    case 'SetRequestManager':
      return `Set ${shortenAddress(data.manager)} as request manager`

    default:
      return unCamelCase(message.messageType) || message.messageType
  }
}
