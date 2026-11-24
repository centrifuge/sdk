// AUTO-GENERATED FILE — do not edit by hand.
// Regenerate with (then run prettier; only the Generated line differs):
//   node packages/protocol/scripts/gen-migration-deployments.mjs --layer bafkreicj6yedpygfbs6mctvgj6fxvjjwtjggccyhz6jbvy4bylgnlytjma
//   pnpm exec prettier --write packages/protocol/src/migration/deployments.ts
// Sources: mainnet none, testnet bafkreicj6yedpygfbs6mctvgj6fxvjjwtjggccyhz6jbvy4bylgnlytjma
// Generated: 2026-11-16T16:56:44.357Z

import type { ChainEnvironment } from "../types";
import type { MigrationDeploymentInput } from "./types";

export const V33_MIGRATION_DEPLOYMENTS_SOURCE: Readonly<
  Record<ChainEnvironment, string | null>
> = {
  mainnet: null,
  testnet: "bafkreicj6yedpygfbs6mctvgj6fxvjjwtjggccyhz6jbvy4bylgnlytjma",
};

export const V33_MIGRATION_DEPLOYMENTS: Readonly<
  Record<ChainEnvironment, Readonly<Record<number, MigrationDeploymentInput>>>
> = {
  mainnet: {},
  testnet: {
    "1": {
      chainId: 11155111,
      address: "0x25f4dA387f8154E78763Cac7e545a776c4D245C6",
      deployBlock: 12146984,
    },
    "2": {
      chainId: 84532,
      address: "0x25f4dA387f8154E78763Cac7e545a776c4D245C6",
      deployBlock: 59531765,
    },
    "3": {
      chainId: 421614,
      address: "0x25f4dA387f8154E78763Cac7e545a776c4D245C6",
      deployBlock: 329764170,
    },
    "9": {
      chainId: 998,
      address: "0x25f4dA387f8154E78763Cac7e545a776c4D245C6",
      deployBlock: 69771116,
    },
  },
};
