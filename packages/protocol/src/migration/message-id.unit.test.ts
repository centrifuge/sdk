import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { BuilderArgumentMismatchError } from "../errors";
import fixture from "./__fixtures__/parked-step-665-messages.json";
import { getMessageHash, getMessageId } from "./message-id";

const SOURCE = Number(fixture.sourceCentrifugeId);
const DEST = Number(fixture.destCentrifugeId);

describe("getMessageHash / getMessageId against the parked-step fixture", () => {
  for (const message of fixture.messages) {
    it(`prepare seq ${message.prepareSeq} (${message.parked ? "parked then retried" : "landed on arrival"})`, () => {
      const hash = getMessageHash(message.messageBytes as Hex);
      expect(hash).toBe(message.messageHash);
      expect(getMessageId(SOURCE, DEST, hash)).toBe(message.messageId);
      const events = message.spokeEvents.map((e) => e.event);
      expect(events).toEqual(
        message.parked ? ["FailMessage", "ExecuteMessage"] : ["ExecuteMessage"],
      );
    });
  }

  it("gives two relays of the same bytes one id, which the row index then tells apart", () => {
    const [first] = fixture.messages;
    const hash = getMessageHash(first!.messageBytes as Hex);
    expect(getMessageId(SOURCE, DEST, hash)).toBe(
      getMessageId(SOURCE, DEST, getMessageHash(first!.messageBytes as Hex)),
    );
    expect(getMessageId(DEST, SOURCE, hash)).not.toBe(
      getMessageId(SOURCE, DEST, hash),
    );
  });

  it("refuses a non-hex payload and a centrifuge id outside uint16", () => {
    expect(() => getMessageHash("0x1" as Hex)).toThrow(
      BuilderArgumentMismatchError,
    );
    expect(() =>
      getMessageId(0, DEST, fixture.messages[0]!.messageHash as Hex),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() =>
      getMessageId(SOURCE, 70000, fixture.messages[0]!.messageHash as Hex),
    ).toThrow(BuilderArgumentMismatchError);
    expect(() => getMessageId(SOURCE, DEST, "0x1234")).toThrow(
      BuilderArgumentMismatchError,
    );
  });
});
