import type { WorkflowManifest } from '../types/workflow.js'

// Update both entries when centrifuge/workflows cuts a new release.
// CIDs are in the GitHub release notes: https://github.com/centrifuge/workflows/releases
const DEFAULT_CID: Record<'mainnet' | 'testnet', string> = {
  mainnet: '',
  testnet: '',
}

const DEFAULT_GATEWAY = 'https://ipfs.centrifuge.io/'

/**
 * Fetches the centrifuge/workflows manifest from IPFS and returns all
 * non-callback workflows for the given environment.
 *
 * The CID falls back to the SDK's hardcoded defaults when not provided.
 * Pass an explicit `cid` to pin to a specific release without an SDK bump
 * (e.g. from `VITE_WORKFLOWS_MANIFEST_CID_TESTNET` in apps-v3).
 *
 * @throws if no CID is available for the environment (neither passed nor defaulted)
 * @throws if the IPFS gateway returns a non-OK response
 */
export async function fetchWorkflowManifest(
  environment: 'mainnet' | 'testnet' = 'mainnet',
  cid?: string,
  gateway = DEFAULT_GATEWAY
): Promise<WorkflowManifest[]> {
  const resolvedCid = cid ?? DEFAULT_CID[environment]
  if (!resolvedCid) {
    throw new Error(
      `fetchWorkflowManifest: no CID configured for environment "${environment}". ` +
        `Pass a CID explicitly or update DEFAULT_CID in sdk/src/utils/workflowManifest.ts.`
    )
  }

  const url = `${gateway}${resolvedCid}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetchWorkflowManifest: IPFS fetch failed — ${res.status} ${res.statusText} (${url})`)
  }

  const data = (await res.json()) as WorkflowManifest[]
  return data.filter((w) => !w.useTemplate)
}
