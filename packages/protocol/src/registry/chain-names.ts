import type { ChainEnvironment } from "../types";

/**
 * Display name of each chain, keyed by environment and `centrifugeId`. The
 * address book carries no names, so a chain it gains needs a row here; a
 * chain without one fails the registry build rather than getting a made-up
 * name.
 */
export const CHAIN_NAMES: Readonly<
  Record<ChainEnvironment, Readonly<Record<number, string>>>
> = {
  mainnet: {
    1: "ethereum",
    2: "base",
    3: "arbitrum",
    4: "plume",
    5: "avalanche",
    6: "bnb-smart-chain",
    9: "hyper-evm",
    10: "optimism",
    11: "monad",
    12: "pharos",
    13: "x-layer",
    14: "arc",
    15: "robinhood-chain",
    16: "linea",
    17: "adi",
  },
  testnet: {
    1: "sepolia",
    2: "base-sepolia",
    3: "arbitrum-sepolia",
    9: "hyperevm-testnet",
  },
};
