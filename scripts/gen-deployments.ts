/**
 * Regenerates src/config/deployments.ts from the protocol repo's deployment
 * artifacts (centrifuge/protocol's env/*.json files), which are the canonical
 * record of what was actually deployed.
 *
 * Usage: pnpm gen:deployments [--protocol-path ../protocol] [--out path]
 *
 * The protocol repo is expected to be checked out as a sibling of this repo.
 * Override with --protocol-path if it lives elsewhere.
 *
 * Run this when the protocol repo's env/*.json files change (new chain, new
 * contract deployment, redeployment). Commit the regenerated file in the
 * same PR as the SDK release that ships the new addresses, and note which
 * protocol commit was used.
 *
 * Why protocol repo and not the indexer? The runtime verifier in
 * Centrifuge.ts checks indexer responses against this file. Sourcing the
 * file from the same indexer would mean a compromised indexer at generation
 * time silently poisons the allowlist. The protocol repo's env files are
 * committed alongside the deploy scripts, signed off by the deployer in PR
 * review, and travel through the same audit trail as the contracts themselves.
 */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { argv } from 'node:process'
import { getAddress } from 'viem'

type EnvFile = {
  network: {
    chainId: number
    centrifugeId: number
    environment: 'mainnet' | 'testnet'
  }
  contracts: Record<string, { address: string } | undefined>
}

// Protocol repo filenames don't always match the conventional chain names used
// elsewhere (indexer, downstream consumers). Map to preserve those names in
// the generated allowlist. The verifier ignores the name field, so this is
// purely cosmetic — but consistent labeling is helpful for code review.
const NAME_OVERRIDES: Record<string, string> = {
  'bnb-smart-chain': 'binance',
  'hyper-evm': 'hyperliquid',
}

function parseArgs() {
  const args = argv.slice(2)
  // assumes sdk repo and protocol repo are siblings by default
  let protocolPath = resolve('../protocol')
  let out = resolve('src/config/deployments.ts')
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--protocol-path') protocolPath = resolve(args[++i]!)
    else if (args[i] === '--out') out = resolve(args[++i]!)
  }
  return { protocolPath, out }
}

function readEnvFiles(envDir: string): { name: string; data: EnvFile }[] {
  const files = readdirSync(envDir).filter((f) => f.endsWith('.json'))
  return files.map((file) => {
    const text = readFileSync(join(envDir, file), 'utf8')
    return { name: file.replace(/\.json$/, ''), data: JSON.parse(text) as EnvFile }
  })
}

function getProtocolCommit(protocolPath: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: protocolPath }).toString().trim()
  } catch {
    return 'unknown'
  }
}

function main() {
  const { protocolPath, out } = parseArgs()
  const envDir = join(protocolPath, 'env')
  console.log(`Reading deployments from ${envDir}...`)

  const envFiles = readEnvFiles(envDir)
  const mainnetFiles = envFiles.filter((f) => f.data.network.environment === 'mainnet')

  // Build one block per centrifugeId. Mainnet uniquely identifies a chain by
  // centrifugeId; testnet reuses the same ids for different chains, which is
  // why this file is mainnet-scoped.
  const blocks = new Map<number, string>()
  for (const { name, data } of mainnetFiles) {
    const { chainId, centrifugeId } = data.network
    const inner: string[] = []
    const displayName = NAME_OVERRIDES[name] ?? name
    inner.push(`    name: ${JSON.stringify(displayName)},`)
    inner.push(`    chainId: ${chainId},`)
    const contractKeys = Object.keys(data.contracts).sort()
    for (const k of contractKeys) {
      const entry = data.contracts[k]
      if (!entry?.address || !entry.address.startsWith('0x')) continue
      inner.push(`    ${k}: '${getAddress(entry.address)}' as HexString,`)
    }
    blocks.set(centrifugeId, inner.join('\n'))
  }

  const generatedAt = new Date().toISOString()
  const protocolCommit = getProtocolCommit(protocolPath)
  const lines: string[] = [
    '// AUTO-GENERATED FILE — do not edit by hand.',
    `// Regenerate with: pnpm gen:deployments`,
    `// Source: protocol repo env/*.json (commit ${protocolCommit})`,
    `// Generated: ${generatedAt}`,
    '//',
    '// SCOPE: Mainnet only. Mainnet and testnet reuse the same centrifugeIds for',
    '// different chains, so a single map keyed by centrifugeId cannot hold both.',
    '// The verifier in Centrifuge.ts no-ops when environment !== "mainnet".',
    '',
    "import type { HexString, ProtocolContracts } from '../types/index.js'",
    '',
    '// All ProtocolContracts fields are optional here: not every chain has every',
    '// contract deployed (e.g. some chains lack globalEscrow or specific adapters).',
    '// The verifier checks fields that ARE present against the indexer response;',
    '// fields absent from the allowlist are not enforced.',
    'export type KnownDeployment = Partial<ProtocolContracts> & {',
    '  chainId: number',
    '  name: string',
    '}',
    '',
    'export const KNOWN_DEPLOYMENTS: Record<number, KnownDeployment> = {',
  ]

  for (const centId of [...blocks.keys()].sort((a, b) => a - b)) {
    lines.push(`  ${centId}: {`)
    lines.push(blocks.get(centId)!)
    lines.push('  },')
  }
  lines.push('}')
  lines.push('')

  writeFileSync(out, lines.join('\n'))
  console.log(`Wrote ${blocks.size} mainnet deployments to ${out} (protocol @ ${protocolCommit.slice(0, 9)})`)
}

main()
