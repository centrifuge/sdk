import type { HexString, ProtocolContracts } from '../types/index.js'
import { addressesEqual } from '../utils/addresses.js'
import type { KnownDeployment } from './deployments.js'

export type IndexerDeployment = ProtocolContracts & {
  chainId?: string
  centrifugeId?: string
}

export type IndexerDeploymentResponse = {
  blockchains: { items: { id: string; centrifugeId: string; name: string; icon?: string }[] }
  deployments: { items: IndexerDeployment[] }
}

export class DeploymentMismatchError extends Error {
  override name = 'DeploymentMismatchError'
  constructor(
    public centrifugeId: number,
    public field: string,
    public expected: string,
    public actual: string
  ) {
    super(
      `Indexer-returned address for centrifugeId=${centrifugeId} field='${field}' ` +
        `does not match bundled allowlist. Expected ${expected}, got ${actual}. ` +
        `Refusing to use this deployment data.`
    )
  }
}

export class UnknownDeploymentError extends Error {
  override name = 'UnknownDeploymentError'
  constructor(public centrifugeId: number) {
    super(
      `Indexer returned a deployment for centrifugeId=${centrifugeId} that is not in the bundled ` +
        `allowlist. Either upgrade the SDK, or pass { allowUnknownDeployments: true } to opt out of strict mode.`
    )
  }
}

export type VerifyOptions = {
  /**
   * If true, allow indexer-reported deployments for centrifugeIds not present in the
   * bundled allowlist. They will be returned unverified. Default: false (strict).
   *
   * Strict mode is the secure default — an attacker adding a fake centrifugeId to a
   * compromised indexer cannot slip past it. Permissive mode is useful only when the
   * SDK predates a legitimate new chain deployment.
   */
  allowUnknownDeployments?: boolean
}

/**
 * Verifies an indexer deployment response against the bundled KNOWN_DEPLOYMENTS allowlist.
 *
 * For each indexer-returned deployment, looks up the expected record by centrifugeId
 * and asserts every contract address field matches (case-insensitive). Throws on the
 * first mismatch. Returns the response unchanged on success.
 *
 * If the bundled allowlist is empty (e.g. on first commit before `pnpm gen:deployments`
 * has been run), verification is skipped with a warning. This avoids breaking dev/test
 * before the allowlist is populated, but should never happen in a published release —
 * the gen-deployments step is a release prerequisite.
 */
export function verifyDeployments(
  data: IndexerDeploymentResponse,
  allowlist: Record<number, KnownDeployment>,
  options: VerifyOptions = {}
): IndexerDeploymentResponse {
  const allowlistCentIds = Object.keys(allowlist)
  if (allowlistCentIds.length === 0) {
    console.warn(
      '[centrifuge-sdk] KNOWN_DEPLOYMENTS allowlist is empty; skipping deployment verification. ' +
        'Run `pnpm gen:deployments` to populate.'
    )
    return data
  }

  for (const deployment of data.deployments.items) {
    const centId = Number(deployment.centrifugeId)
    if (!Number.isFinite(centId)) {
      throw new Error(`Indexer returned deployment with non-numeric centrifugeId: ${deployment.centrifugeId}`)
    }

    const expected = allowlist[centId]
    if (!expected) {
      if (options.allowUnknownDeployments) continue
      throw new UnknownDeploymentError(centId)
    }

    for (const [field, expectedValue] of Object.entries(expected) as [keyof KnownDeployment, unknown][]) {
      if (field === 'name' || field === 'chainId') continue
      // Optional contract fields (e.g. wormholeAdapter) may be absent from the allowlist.
      if (expectedValue === undefined) continue

      const actualValue = deployment[field as keyof ProtocolContracts] as HexString | undefined
      // Skip fields the indexer didn't return. The allowlist is generated from
      // the protocol repo and includes every deployed contract; the SDK's
      // GraphQL query is a subset of that. We only validate what was actually
      // returned — if the SDK doesn't query a field, it can't verify it, but
      // it also doesn't depend on it. An attacker substituting a poisoned
      // address for a queried field is still caught.
      if (!actualValue) continue
      if (!addressesEqual(actualValue, expectedValue as string)) {
        throw new DeploymentMismatchError(centId, String(field), String(expectedValue), actualValue)
      }
    }
  }

  return data
}
