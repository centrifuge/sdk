import { addressBook } from "@centrifuge/addressbook";
import { describe, expect, it } from "vitest";
import {
  type Abi,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
  type AbiFunction,
} from "viem";
import {
  ABI_SOURCE_V33_MIGRATION,
  GENERATED_ABIS_V33_MIGRATION,
  V33_MIGRATION_ABI_V3_3,
} from "@centrifuge/addressbook/abis";
import { ABIS_V3_3, ABI_SET_V3_3 } from "./v3_3";
import { decodeMigrationEvent } from "../migration/events";
import { MIGRATION_ABI_KEY } from "../migration/constants";
import { compareMigrationAbi } from "../migration/verify";
import { describeBookAbiMismatch } from "./verify";

const functions = V33_MIGRATION_ABI_V3_3.filter(
  (
    item,
  ): item is Extract<
    (typeof V33_MIGRATION_ABI_V3_3)[number],
    { type: "function" }
  > => item.type === "function",
);
const events = V33_MIGRATION_ABI_V3_3.filter(
  (
    item,
  ): item is Extract<
    (typeof V33_MIGRATION_ABI_V3_3)[number],
    { type: "event" }
  > => item.type === "event",
);

describe("V33Migration facade ABI", () => {
  it("is folded from the testnet head the bundled book pins, a patch over the v3.3.0 layer and the earlier patch", () => {
    expect(ABI_SOURCE_V33_MIGRATION.network).toBe("testnet");
    expect(ABI_SOURCE_V33_MIGRATION.head).toBe(
      addressBook.networks.testnet.head,
    );
    expect(ABI_SOURCE_V33_MIGRATION.layers[0]).toMatchObject({
      version: null,
      effectiveVersion: "v3.3.0",
      ipfsHash: "bafkreicj6yedpygfbs6mctvgj6fxvjjwtjggccyhz6jbvy4bylgnlytjma",
    });
    expect(ABI_SOURCE_V33_MIGRATION.layers[1]).toMatchObject({
      version: "v3.3.0",
      ipfsHash: "bafkreih2et2a3tvh7rxvpjd7jxf6fg2pwrabcy4bsbg7sb3icijwvcwzvu",
    });
    expect(ABI_SOURCE_V33_MIGRATION.layers[2]).toMatchObject({
      version: null,
      effectiveVersion: "v3.3.0",
      ipfsHash: "bafkreifwkz42zr3vxqo3767ifis32nuhsfbm4h7ubd5aei45wthawxdumm",
    });
    expect(Object.keys(GENERATED_ABIS_V33_MIGRATION)).toEqual(["V33Migration"]);
  });

  it("lists the facade's multicall over (bytes,uint256)[] bundles", () => {
    const multicall = functions.find((f) => f.name === "multicall");
    expect(multicall).toBeDefined();
    expect(toFunctionSelector(multicall as AbiFunction)).toBe(
      toFunctionSelector("multicall((bytes,uint256)[])"),
    );
  });

  it("matches the digest of every V33Migration address in the book's v3.3.0 stack", () => {
    const { mismatches, compared } = compareMigrationAbi(addressBook);

    expect(mismatches.map(describeBookAbiMismatch)).toEqual([]);
    expect(compared[MIGRATION_ABI_KEY]).toBeGreaterThan(0);
  });

  it("names every facade address when one byte of the bundled ABI changes", () => {
    const facade = JSON.stringify(V33_MIGRATION_ABI_V3_3);
    const edited = facade.replace('"name":"poolId"', '"name":"poolIe"');
    expect(edited).not.toBe(facade);

    const { mismatches, compared } = compareMigrationAbi(addressBook, {
      V33Migration: JSON.parse(edited) as Abi,
    });

    expect(compared[MIGRATION_ABI_KEY]).toBeGreaterThan(0);
    expect(mismatches).toHaveLength(compared[MIGRATION_ABI_KEY]!);
    expect(mismatches.every((m) => m.abiName === "V33Migration")).toBe(true);
  });

  it("carries the 26 lifecycle events and the manager-signed entry points", () => {
    expect(events).toHaveLength(26);
    const eventNames = events.map((e) => e.name).sort();
    for (const name of [
      "Armed",
      "SpokeArmed",
      "Frozen",
      "Aborted",
      "Offboarded",
      "HubOnboarded",
      "Onboarded",
      "Activated",
      "MaxReservesRestored",
      "ForceReleased",
      "Locked",
      "StepRelayed",
      "EscrowKeySeeded",
      "ShareQueueSeeded",
    ]) {
      expect(eventNames).toContain(name);
    }
    const names = new Set<string>(functions.map((f) => f.name));
    for (const name of [
      "initiateMigration",
      "installPoolAdapters",
      "relayArm",
      "relayFreeze",
      "relayAbort",
      "relayOffboard",
      "onboardHub",
      "relayOnboardSpoke",
      "activate",
      "forceRelease",
      "lock",
      "hubPhase",
      "spokePhase",
      "freezeGeneration",
      "spokeArmed",
      "maxReservesRestored",
      "localCentrifugeId",
      "lockAdmin",
      "locked",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("stays out of the address-keyed v3.3 set and off the v3.3 decode table", () => {
    expect(ABI_SET_V3_3).not.toHaveProperty("v33Migration");
    expect(ABIS_V3_3).not.toHaveProperty("V33Migration");
  });

  it("shares no selector with the v3.3 Hub", () => {
    const hubSelectors = new Set(
      (ABIS_V3_3.Hub as readonly (AbiFunction | AbiEvent | { type: string })[])
        .filter((i): i is AbiFunction => i.type === "function")
        .map((f) => toFunctionSelector(f)),
    );
    for (const f of functions) {
      expect(
        hubSelectors.has(toFunctionSelector(f as AbiFunction)),
        f.name,
      ).toBe(false);
    }
  });

  it("decodes a Locked() and a StepRelayed log", () => {
    const locked = events.find((e) => e.name === "Locked")!;
    expect(
      decodeMigrationEvent({ topics: [toEventSelector(locked)], data: "0x" }),
    ).toEqual({
      eventName: "Locked",
      args: undefined,
    });
    const stepRelayed = events.find((e) => e.name === "StepRelayed")!;
    const decoded = decodeMigrationEvent({
      topics: [
        toEventSelector(stepRelayed),
        "0x0000000000000000000000000000000000000000000000000001000000000009",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
      data: "0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563",
    });
    expect(decoded.eventName).toBe("StepRelayed");
    expect(decoded.args).toEqual({
      poolId: 281474976710665n,
      centrifugeId: 2,
      step: 0,
      payloadHash:
        "0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563",
    });
  });
});
