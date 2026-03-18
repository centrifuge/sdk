import { PoolId } from '../utils/types.js'
import type {
  SafeAdminAction,
  SafeAdminResolution,
  SafeAdminResolutionInput,
} from '../types/safe.js'

export type SafeAdminResolutionConfig = Partial<Record<SafeAdminAction, Record<string, SafeAdminResolution>>>

function getPoolKey(poolId: PoolId) {
  return poolId.toString()
}

export function findSafeAdminResolution(
  config: SafeAdminResolutionConfig,
  input: SafeAdminResolutionInput
): SafeAdminResolution | null {
  return config[input.action]?.[getPoolKey(input.poolId)] ?? null
}

export function resolveSafeAdminResolution(
  config: SafeAdminResolutionConfig,
  input: SafeAdminResolutionInput
): SafeAdminResolution {
  const resolution = findSafeAdminResolution(config, input)
  if (resolution) return resolution

  const poolKey = getPoolKey(input.poolId)
  const actionMappings = config[input.action]
  if (!actionMappings) {
    throw new Error(`No admin Safe mappings configured for action "${input.action}"`)
  }

  throw new Error(`No admin Safe configured for action "${input.action}" on pool "${poolKey}"`)
}

export function createSafeAdminConfigResolver(config: SafeAdminResolutionConfig) {
  return (input: SafeAdminResolutionInput) => resolveSafeAdminResolution(config, input)
}
