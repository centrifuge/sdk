import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ABIS_V3_2 } from "../abis/v3_2";
import { UnknownProtocolVersionError } from "../errors";
import { decodeContractUpdates } from "./contract-updates";
import rampFixtures from "./__fixtures__/register-on-off-ramp.json";

const V = "3.2";
const SC_ID = "0x00010000000000010001000000000001";
const TARGET = `0x${"11".repeat(20)}${"00".repeat(12)}` as const;
const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";

const updateContract = encodeFunctionData({
  abi: ABIS_V3_2.Hub,
  functionName: "updateContract",
  args: [1n, SC_ID, 13, TARGET, "0xabcd", 0n, REFUND],
});

const multicall = (calls: `0x${string}`[]) =>
  encodeFunctionData({
    abi: ABIS_V3_2.Multicall,
    functionName: "multicall",
    args: [calls],
  });

describe("decodeContractUpdates", () => {
  it("reads a bare updateContract", () => {
    expect(decodeContractUpdates(V, updateContract)).toEqual({
      ok: true,
      updates: [
        {
          callIndex: 0,
          poolId: "1",
          scId: SC_ID,
          centrifugeId: 13,
          target: TARGET,
          payload: "0xabcd",
          extraGasLimit: "0",
          refundAddress: REFUND,
        },
      ],
    });
  });

  it("reports the index among the inner calls, not among the updates", () => {
    const result = decodeContractUpdates(
      V,
      rampFixtures.xLayer.data as `0x${string}`,
    );

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.updates.map((u) => u.callIndex)).toEqual([1]);
  });

  it("finds nothing in a transaction without updateContract", () => {
    expect(
      decodeContractUpdates(V, rampFixtures.legacy.data as `0x${string}`),
    ).toEqual({ ok: true, updates: [] });
  });

  it("reads the calls inside a Hub executeMulticall", () => {
    const wrapped = encodeFunctionData({
      abi: ABIS_V3_2.Hub,
      functionName: "executeMulticall",
      args: [[updateContract]],
    });
    const result = decodeContractUpdates(V, wrapped);
    expect(result.ok && result.updates.map((u) => u.callIndex)).toEqual([0]);
  });

  it("refuses an executeMulticall nested in a multicall", () => {
    const wrapped = encodeFunctionData({
      abi: ABIS_V3_2.Hub,
      functionName: "executeMulticall",
      args: [[updateContract]],
    });
    expect(decodeContractUpdates(V, multicall([wrapped]))).toEqual({
      ok: false,
      reason: "nested_multicall",
    });
  });

  it("refuses a nested multicall", () => {
    const nested = multicall([multicall([updateContract])]);
    expect(decodeContractUpdates(V, nested)).toEqual({
      ok: false,
      reason: "nested_multicall",
    });
  });

  it("refuses a truncated multicall", () => {
    const truncated = multicall([updateContract, updateContract]).slice(0, 90);
    expect(decodeContractUpdates(V, truncated as `0x${string}`)).toEqual({
      ok: false,
      reason: "undecodable_multicall",
    });
  });

  it("refuses an updateContract that does not decode", () => {
    const truncated = updateContract.slice(0, 120) as `0x${string}`;
    expect(decodeContractUpdates(V, truncated)).toEqual({
      ok: false,
      reason: "undecodable_update_contract",
    });
    expect(decodeContractUpdates(V, multicall([truncated]))).toEqual({
      ok: false,
      reason: "undecodable_update_contract",
    });
  });

  it("throws for a version it has no ABI for", () => {
    expect(() => decodeContractUpdates("9.9", updateContract)).toThrow(
      UnknownProtocolVersionError,
    );
  });
});
