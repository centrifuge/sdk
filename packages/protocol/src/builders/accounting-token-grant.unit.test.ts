import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import { deployVault, registerOnOffRamp, updateVaults } from "./index";

/** Only `registerOnOffRamp` may emit `Hub.updateContract` to the accounting token. */

const POOL_ID = "281474976710657";
const SC_ID = "0x00010000000000010001000000000001";
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const RAMP = "0xA4A7Bb3831958463b3FE3E27A6a160F764341953";
const XLAYER = 13;

function context(centrifugeId?: number): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
    centrifugeId,
  });
}

/** Every `Hub.updateContract` target in a built call, as a lowercase address. */
function updateContractTargets(
  ctx: ProtocolContext,
  calls: readonly { data: `0x${string}` }[],
): string[] {
  return calls
    .map((call) => decodeFunctionData({ abi: ABIS_V3_2.Hub, data: call.data }))
    .filter((decoded) => decoded.functionName === "updateContract")
    .map((decoded) => {
      const target = (decoded.args as readonly unknown[])[3] as string;
      return target.slice(0, 42).toLowerCase();
    });
}

describe("accounting token minter grant", () => {
  const spoke = context(XLAYER);
  const accountingToken = spoke.addresses.accountingToken!.toLowerCase();

  it("is emitted by registerOnOffRamp", () => {
    const built = registerOnOffRamp(
      context(),
      {
        poolId: POOL_ID,
        scId: SC_ID,
        centrifugeId: String(XLAYER),
        address: RAMP,
        refundAddress: REFUND,
      },
      spoke,
    );

    expect(updateContractTargets(context(), built.calls!)).toEqual([
      accountingToken,
    ]);
  });

  it("is not emitted by deployVault or updateVaults, whose updateContract targets the sync manager", () => {
    const hub = context();
    const deployed = deployVault(hub, {
      poolId: POOL_ID,
      scId: SC_ID,
      assetId: ((13n << 112n) + 42n).toString(),
      kind: "syncDeposit",
      refundAddress: REFUND,
      spoke,
    });
    const updated = updateVaults(hub, {
      poolId: POOL_ID,
      refundAddress: REFUND,
      spoke,
      maxReserve: {
        scId: SC_ID,
        assetId: ((13n << 112n) + 42n).toString(),
        amount: "1",
      },
    });

    const targets = [
      ...updateContractTargets(hub, deployed.calls!),
      ...updateContractTargets(hub, updated.calls!),
    ];
    expect(targets).not.toHaveLength(0);
    expect(targets).not.toContain(accountingToken);
    expect(targets).toEqual(
      targets.map(() => spoke.addresses.syncManager!.toLowerCase()),
    );
  });

  it("trips when a builder other than managers.ts mentions accountingToken", () => {
    const sources = readdirSync(__dirname).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    const mentioning = sources.filter((name) =>
      readFileSync(join(__dirname, name), "utf8").includes("accountingToken"),
    );

    expect(mentioning).toEqual(["managers.ts"]);
  });
});
