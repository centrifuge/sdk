import { encodeFunctionData, type Abi } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { ABIS_V3_3 } from "../abis/v3_3";
import {
  BuilderArgumentMismatchError,
  UnknownProtocolVersionError,
} from "../errors";
import {
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  type ProtocolVersion,
} from "../types";

/**
 * The `multicall(bytes[])` ABI fragment, keyed by protocol version.
 *
 * Version-keyed like every other ABI in this package (restructure constraints,
 * rule 1) even though the selector happens to be stable today: the point of the
 * rule is that adding a protocol version touches `registry/` and `abis/` only.
 *
 * Kept out of `ABI_SET_V3_2` and `INSTANCE_ABI_SET_V3_2` on purpose. It is
 * neither a registry contract (it has no address of its own — every batching
 * protocol contract implements it) nor a per-pool instance contract, and
 * `createDeploymentRegistry` rejects an ABI-set key that is not a schema
 * contract name.
 */
export const BATCH_ABIS: Readonly<Record<ProtocolVersion, Abi>> = {
  [PROTOCOL_VERSION_V3_2]: ABIS_V3_2.Multicall,
  [PROTOCOL_VERSION_V3_3]: ABIS_V3_3.Multicall,
};

/**
 * Encode the outer calldata for a set of inner calls, exactly as the SDK's
 * signing path does (`packages/sdk/src/utils/transaction.ts`
 * `encodeBatchCalldata`): a single call is sent VERBATIM with no multicall
 * wrapper, two or more are wrapped in `multicall(bytes[])`.
 *
 * Byte-parity with the SDK is the whole reason this exists as a shared helper
 * rather than as an `if` inside each builder: the same action must produce the
 * same bytes whether the SDK built it locally or the backend built it, or the
 * per-version parity fixtures cannot compare them.
 *
 * @throws BuilderArgumentMismatchError on an empty batch — a transaction with
 * no calls costs a signature and a policy evaluation and does nothing, so it is
 * always a caller bug.
 * @throws UnknownProtocolVersionError when the version has no bundled fragment.
 */
export function encodeBatchCalldata(
  protocolVersion: ProtocolVersion,
  calls: readonly `0x${string}`[],
  options: { readonly alwaysBatch?: boolean } = {},
): `0x${string}` {
  if (calls.length === 0) {
    throw new BuilderArgumentMismatchError(
      "Refusing to encode an empty batch: the transaction would cost a " +
        "signature, a policy evaluation and gas while doing nothing.",
    );
  }
  const [only] = calls;
  if (calls.length === 1 && only !== undefined && !options.alwaysBatch) {
    return only;
  }

  const abi = BATCH_ABIS[protocolVersion];
  if (!abi) {
    throw new UnknownProtocolVersionError(protocolVersion);
  }

  return encodeFunctionData({
    abi,
    functionName: "multicall",
    args: [calls],
  });
}
