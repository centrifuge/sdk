import { sha256, stringToBytes, type Abi, type Hex } from "viem";

export function canonicalAbiJson(abi: Abi): string {
  return JSON.stringify(sortKeys(abi));
}

export function abiDigest(abi: Abi): Hex {
  return sha256(stringToBytes(canonicalAbiJson(abi)));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}
