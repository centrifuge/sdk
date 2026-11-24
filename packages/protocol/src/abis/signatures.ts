import type { Abi, AbiParameter } from "viem";

function canonicalType(param: AbiParameter): string {
  if (!param.type.startsWith("tuple")) {
    return param.type;
  }
  const components =
    "components" in param ? (param.components as readonly AbiParameter[]) : [];
  return `(${components.map(canonicalType).join(",")})${param.type.slice("tuple".length)}`;
}

/**
 * The externally visible signatures of an ABI, sorted: each function, event
 * and error as `<kind> <name>(<canonical types>)`, with `indexed` marked on
 * event inputs because it moves an argument between topics and data.
 * Parameter names, return types and mutability are left out, so two ABIs
 * that compare equal here encode and decode the same calldata and logs — but
 * a semantic change behind an identical signature (the same slots meaning
 * something else) still compares equal.
 */
export function abiSignatures(abi: Abi): string[] {
  const signatures = new Set<string>();
  for (const item of abi) {
    if (
      item.type !== "function" &&
      item.type !== "event" &&
      item.type !== "error"
    ) {
      continue;
    }
    const inputs = item.inputs.map((input) =>
      item.type === "event" && "indexed" in input && input.indexed
        ? `${canonicalType(input)} indexed`
        : canonicalType(input),
    );
    signatures.add(`${item.type} ${item.name}(${inputs.join(",")})`);
  }
  return [...signatures].sort();
}
