import { encodePacked, keccak256, type Hex } from "viem";
import { requireBytes32, requireHex } from "../builders/create-holding";
import { requireCentrifugeId } from "../builders/vaults";

export function getMessageHash(messageBytes: Hex): Hex {
  return keccak256(requireHex(messageBytes, "getMessageHash.messageBytes"));
}

export function getMessageId(
  sourceCentrifugeId: number,
  destCentrifugeId: number,
  messageHash: Hex,
): Hex {
  return keccak256(
    encodePacked(
      ["uint16", "uint16", "bytes"],
      [
        requireCentrifugeId(
          sourceCentrifugeId,
          "getMessageId.sourceCentrifugeId",
        ),
        requireCentrifugeId(destCentrifugeId, "getMessageId.destCentrifugeId"),
        requireBytes32(messageHash, "getMessageId.messageHash"),
      ],
    ),
  );
}
