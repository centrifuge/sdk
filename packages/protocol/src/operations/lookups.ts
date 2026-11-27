import { OPERATION_CATALOGUE } from "./catalogue";
import type { OperationEntry } from "./types";

const BY_ID = new Map(OPERATION_CATALOGUE.map((entry) => [entry.id, entry]));

// Only the Hub function entries answer a call: a pool action lists calls too (`updateMember`,
// `freezeMember` and `unfreezeMember` all encode `Hub.updateRestriction`), so equal calls never tie.
const HUB_FUNCTION_ENTRIES = OPERATION_CATALOGUE.filter((entry) =>
  entry.id.startsWith("hub."),
);

/** The entry with this id, or null. */
export function operationById(id: string): OperationEntry | null {
  return BY_ID.get(id) ?? null;
}

/** The entry of a backend `PoolActionType` value, or null. */
export function operationByPoolAction(
  poolAction: string,
): OperationEntry | null {
  return (
    OPERATION_CATALOGUE.find((entry) => entry.poolAction === poolAction) ?? null
  );
}

/** The entry that names this audit action, or null. */
export function operationByAuditAction(
  auditAction: string,
): OperationEntry | null {
  return (
    OPERATION_CATALOGUE.find((entry) =>
      entry.auditActions?.includes(auditAction),
    ) ?? null
  );
}

/** The entry of a `hook_calls.action` value, or null. */
export function operationByHookCall(
  hookCallAction: string,
): OperationEntry | null {
  return (
    OPERATION_CATALOGUE.find(
      (entry) => entry.hookCallAction === hookCallAction,
    ) ?? null
  );
}

/** The entry of an investor event kind, or null. */
export function operationByEventKind(eventKind: string): OperationEntry | null {
  return (
    OPERATION_CATALOGUE.find((entry) =>
      entry.eventKinds?.includes(eventKind),
    ) ?? null
  );
}

/**
 * The Hub function entry of a call: the kind's entry, else the function's kind-less one, else null.
 * `updateRestriction` of any kind is `Restriction update`; `updateVault` without a known kind is `Vault update`.
 */
export function operationByCall(
  contract: string,
  fn: string,
  kind?: string,
): OperationEntry | null {
  const matches = (entry: OperationEntry, wantKind: string | undefined) =>
    entry.calls.some(
      (c) =>
        c.contract === contract && c.function === fn && c.kind === wantKind,
    );
  if (kind !== undefined) {
    const ofKind = HUB_FUNCTION_ENTRIES.find((entry) => matches(entry, kind));
    if (ofKind) {
      return ofKind;
    }
  }
  return (
    HUB_FUNCTION_ENTRIES.find((entry) => matches(entry, undefined)) ?? null
  );
}
