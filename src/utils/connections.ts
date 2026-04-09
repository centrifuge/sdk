type ChainSelector = string | string[]

interface ConnectionConfig {
  aliases: Record<string, string[]>
  connections: Array<{
    chains: ChainSelector[]
    adapters: string[]
    threshold: number
  }>
}

/**
 * Resolve the adapters and threshold to use for a hub<>spoke connection.
 * Rules are evaluated in order and later rules supersede earlier ones.
 * Returns null if no rule matches (should not happen if config includes ALL<>ALL).
 */
export function resolveAdapters(
  hubChain: string,
  spokeChain: string,
  config: ConnectionConfig
): { adapters: string[]; threshold: number } | null {
  const expand = (selector: ChainSelector): string[] => {
    if (typeof selector === 'string') {
      return config.aliases[selector] ?? [selector]
    }
    return selector.flatMap((s) => config.aliases[s] ?? [s])
  }

  let result: { adapters: string[]; threshold: number } | null = null

  for (const rule of config.connections) {
    const side0 = expand(rule.chains[0] as ChainSelector)
    const side1 = expand(rule.chains[1] as ChainSelector)

    const matches =
      (side0.includes(hubChain) && side1.includes(spokeChain)) ||
      (side0.includes(spokeChain) && side1.includes(hubChain))

    if (matches) {
      result = { adapters: rule.adapters, threshold: rule.threshold }
    }
  }

  return result
}
