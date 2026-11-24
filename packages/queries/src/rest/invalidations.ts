import type { QueryParamsInput } from "../core/entry";
import type { SdkQueryCatalogue, SdkQueryName } from "../core/sdk-catalogue";

/**
 * The push half of the rest adapter: the backend's raw `invalidation` frames,
 * translated into `(name, vars)` invalidations for the catalogue.
 *
 * ## The asymmetry is the design
 *
 * The wire carries `{ v, table, keys, blockNumber, poolId? }` — a Postgres
 * table name and row identity, never a catalogue entry name
 * (`docs/design/chain-invalidation-push.md`). The backend guarantees only that
 * table names and key fields are stable. Everything about the catalogue —
 * which entries read which table, which of an entry's params a key field
 * corresponds to — lives HERE, next to the per-entry route table.
 *
 * That is deliberate rather than incidental: a projection table is a fact about
 * the database, an entry name is a fact about this package's public surface, and
 * the seam between them is the one place where either can change without the
 * other deploying. A backend that knew entry names would have to be redeployed
 * to add one.
 *
 * ## Nothing here is a correctness mechanism
 *
 * Delivery is at-most-once and best-effort: `LISTEN` only takes effect when its
 * transaction commits, `NOTIFY` is delivered only on the instance that emitted
 * it and never replays, so every reconnect is a hole in the stream. An
 * invalidation is a HINT TO REFETCH and never data — the poll timer in
 * `Centrifuge._queryData` and the ingestion polling worker remain the
 * backstop. Which is what licenses the two liberties this module takes: a
 * frame it cannot
 * understand is dropped rather than thrown, and a match is deliberately
 * conservative (see {@link matchesVars}).
 *
 * This module names no transport. It is handed already-parsed JSON and has no
 * opinion on where it came from — which is also what keeps
 * `packages/queries/src` clear of the stream vocabulary its CI purity gate
 * forbids (`packages/sdk/scripts/assert-transport-purity.mjs`).
 */

/** The payload version this seam understands. Frozen by the wire contract. */
export const INVALIDATION_PAYLOAD_VERSION = 1;

/**
 * Schema-qualified table name, e.g. `chain_v1.epoch_invest_order`.
 *
 * The same shape the listener enforces before the frame leaves the backend. It
 * is re-checked here because the backend's guarantee is about the tables it
 * emits, not about what a proxy, a browser extension or a test double can put
 * on a stream the SDK reads.
 */
const TABLE_PATTERN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * Row identity, as it arrives: string values only.
 *
 * Strings are load-bearing twice over. `chain_v1` identifiers are
 * `numeric(78,0)`, and a JSON number above 2^53 is silently rounded by
 * `JSON.parse` — a rounded id would invalidate a cache key that never existed.
 * And a `Record<string, string>` cannot smuggle a nested object, so the hint
 * cannot quietly grow into a row of data.
 *
 * May also be the collapsed form `{ count: "<n>" }`, which the listener
 * substitutes for an oversized key set. That form matches no key field, which
 * degrades to a coarse invalidation of the table's entries — correct for a
 * hint, and the reason the collapse is safe.
 */
export type InvalidationKeys = Record<string, string>;

/**
 * One validated `invalidation` frame.
 *
 * `keys` is OPTIONAL, and that is not defensive typing: the SSE registry drops
 * `keys` from every BROADCAST frame (one with no `poolId`), because those reach
 * every connection and the recipients share no entitlement. A schema that
 * required `keys` would drop every pool-less invalidation — the projections
 * genuinely emit those (gateway messages, rely/deny) — which is the silent loss
 * this seam exists to avoid.
 */
export interface InvalidationFrame {
  v: typeof INVALIDATION_PAYLOAD_VERSION;
  table: string;
  keys?: InvalidationKeys;
  blockNumber: number;
  poolId?: string;
}

/**
 * The outcome of validating one frame. A rejection carries a `reason` rather
 * than throwing: this runs on a stream event, where a throw is an unhandled
 * error in an event handler, and where the correct response to a frame we
 * cannot read is to let the poll timer cover it.
 */
export type ParsedInvalidation =
  { ok: true; frame: InvalidationFrame } | { ok: false; reason: string };

/**
 * Validate one raw frame against the `v: 1` contract.
 *
 * Three properties, each mirroring a decision on the backend half:
 *
 * 1. **`v` is checked, not ignored.** A `v: 2` emitter has changed what the
 *    fields MEAN, and reading a v2 payload under a v1 contract would produce
 *    confident nonsense. An unknown version is dropped and the poller covers
 *    the gap.
 * 2. **Unknown FIELDS are ignored, not rejected.** The emitter, the BFF and
 *    this SDK deploy separately; rejecting an added field would make an older
 *    SDK drop every frame a newer backend sends.
 * 3. **Key values must be strings.** A numeric identifier is a rejection, not
 *    a coercion — see {@link InvalidationKeys}.
 *
 * Hand-written rather than a zod schema on purpose: `packages/queries` depends
 * on zod for CATALOGUE PARAMS, where a schema is the contract; here the
 * contract is five fields and the interesting half is which failures are
 * tolerated, which reads better as named branches than as a schema plus a
 * comment explaining what its error means.
 */
export function parseInvalidationFrame(raw: unknown): ParsedInvalidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `frame is not an object (${typeof raw})` };
  }
  const frame = raw as Record<string, unknown>;

  if (frame.v !== INVALIDATION_PAYLOAD_VERSION) {
    return {
      ok: false,
      reason:
        `unsupported payload version ${JSON.stringify(frame.v)} ` +
        `(this SDK reads v${INVALIDATION_PAYLOAD_VERSION})`,
    };
  }
  if (typeof frame.table !== "string" || !TABLE_PATTERN.test(frame.table)) {
    return {
      ok: false,
      reason: `\`table\` is not a schema-qualified name (${JSON.stringify(frame.table)})`,
    };
  }
  if (
    typeof frame.blockNumber !== "number" ||
    !Number.isInteger(frame.blockNumber) ||
    frame.blockNumber < 0
  ) {
    return {
      ok: false,
      reason: `\`blockNumber\` is not a non-negative integer (${JSON.stringify(frame.blockNumber)})`,
    };
  }

  let keys: InvalidationKeys | undefined;
  if (frame.keys !== undefined && frame.keys !== null) {
    if (typeof frame.keys !== "object" || Array.isArray(frame.keys)) {
      return { ok: false, reason: "`keys` is not an object" };
    }
    const entries = Object.entries(frame.keys as Record<string, unknown>);
    const nonString = entries.find(([, value]) => typeof value !== "string");
    if (nonString) {
      return {
        ok: false,
        reason:
          `key "${nonString[0]}" is not a string ` +
          `(${JSON.stringify(nonString[1])}); \`numeric(78,0)\` ids must arrive ` +
          `as text or they are rounded by JSON.parse`,
      };
    }
    keys = Object.fromEntries(entries) as InvalidationKeys;
  }

  let poolId: string | undefined;
  if (frame.poolId !== undefined && frame.poolId !== null) {
    if (typeof frame.poolId !== "string" || frame.poolId === "") {
      return {
        ok: false,
        reason: `\`poolId\` is not a non-empty string (${JSON.stringify(frame.poolId)})`,
      };
    }
    poolId = frame.poolId;
  }

  return {
    ok: true,
    frame: {
      v: INVALIDATION_PAYLOAD_VERSION,
      table: frame.table,
      blockNumber: frame.blockNumber,
      ...(keys === undefined ? {} : { keys }),
      ...(poolId === undefined ? {} : { poolId }),
    },
  };
}

/**
 * One row of the table-to-entry mapping: a catalogue entry a table's rows feed,
 * and which of the frame's key fields identify it.
 *
 * Typed as a union over the catalogue, which buys two compile-time guarantees:
 *
 * - `entry` must name a real catalogue entry. A row for an entry that was
 *   renamed or removed fails to compile — the same fallback-table-drift
 *   mitigation the route table gets from `RestRouteTable`.
 * - `keyVars` may only name that entry's OWN params. A key field the entry does
 *   not take is a compile error, so a mapping cannot claim to identify a
 *   subscription by a variable that subscription never had.
 *
 * `keyVars` names fields rather than computing them: every key field the
 * emitter sends is named after the column, and the catalogue params are named
 * after the same thing (`tokenId`, `assetId`, `index`). Where they ever diverge,
 * the honest fix is to widen this type, not to bury a rename in a lambda.
 *
 * A key listed here but ABSENT from the frame is simply not matched on, which
 * makes the match coarser and never wrong — see {@link matchesVars}.
 */
export type InvalidationRow = {
  [K in SdkQueryName]: {
    entry: K;
    keyVars: readonly (keyof QueryParamsInput<SdkQueryCatalogue[K]> & string)[];
  };
}[SdkQueryName];

/** Schema-qualified table name -> the entries its rows feed. */
export type InvalidationTableMap = Readonly<
  Record<string, readonly InvalidationRow[]>
>;

/**
 * The table-to-catalogue-entry mapping.
 *
 * ## Why only Orders
 *
 * Orders is the vertical where push matters most: order state is what changes
 * while an operator watches the screen (approve, issue, revoke, claim), so it
 * is where a two-minute poll is most visible as staleness — and all seven of its
 * entries have REST routes, so an invalidation has somewhere to land.
 *
 * An unmapped table is IGNORED, which is what makes adding a trigger to a new
 * table a backend-only change: it costs a client nothing until a row appears
 * here. That is also why the emitter's own rollout (the trigger-per-table
 * migration in `docs/design/chain-invalidation-push.md`) cannot break a
 * subscriber.
 *
 * ## Each entry gets its own source table, and nothing else
 *
 * The four order tables split cleanly, so the mapping states the source of each
 * entry rather than a superset:
 *
 * - `epoch_invest_order` / `epoch_redeem_order` are the CLOSED-EPOCH aggregates
 *   `epochInvestOrders` / `epochRedeemOrders` read.
 * - `invest_order` / `redeem_order` are the PER-INVESTOR rows
 *   `redeemOrdersByEpoch` and the per-share-class
 *   `closedInvestOrders` / `closedRedeemOrders` read.
 * - `investOrderState` / `redeemOrderState` are four-collection composites, so
 *   they take both tables of their side.
 *
 * ## `account` is deliberately not a key variable
 *
 * `invest_order` and `redeem_order` are keyed by `(token_id, asset_id, account,
 * index)`, so a frame for them carries an `account`. It is not matched on, for
 * two independent reasons: no order entry takes an account param (so it could
 * not be, without widening the entry), and `chain_v1`'s `account` currently
 * carries Embrio's wrong bytes32 decode — which is why the route table has
 * those entries refusing with `NOT_YET_PROJECTED`. Matching on a corrupted
 * value would drop the invalidation for the row that actually changed.
 */
export const INVALIDATION_TABLES: InvalidationTableMap = {
  "chain_v1.epoch_invest_order": [
    { entry: "epochInvestOrders", keyVars: ["tokenId"] },
    { entry: "investOrderState", keyVars: ["tokenId"] },
  ],
  "chain_v1.epoch_redeem_order": [
    { entry: "epochRedeemOrders", keyVars: ["tokenId", "assetId", "index"] },
    { entry: "redeemOrderState", keyVars: ["tokenId"] },
  ],
  "chain_v1.invest_order": [
    { entry: "closedInvestOrders", keyVars: ["tokenId"] },
    { entry: "investOrderState", keyVars: ["tokenId"] },
  ],
  "chain_v1.redeem_order": [
    { entry: "redeemOrdersByEpoch", keyVars: ["tokenId", "assetId", "index"] },
    { entry: "closedRedeemOrders", keyVars: ["tokenId"] },
    { entry: "redeemOrderState", keyVars: ["tokenId"] },
  ],
};

/**
 * One `(name, vars)` invalidation: the entry to refetch, and the variable
 * values that identify WHICH of its subscriptions are affected.
 *
 * `vars` is a partial constraint, never a full variable set — see
 * {@link matchesVars}.
 */
export interface InvalidationTarget {
  name: SdkQueryName;
  vars: Readonly<Record<string, string>>;
}

/**
 * Translate one validated frame into catalogue invalidations.
 *
 * An unmapped table yields `[]` — never a throw. A new projection table showing
 * up on the stream, which the emitter's per-table rollout does by design, must
 * not be able to take down a subscriber.
 */
export function invalidationTargets(
  frame: InvalidationFrame,
  tables: InvalidationTableMap = INVALIDATION_TABLES,
): InvalidationTarget[] {
  const rows = tables[frame.table];
  if (!rows) {
    return [];
  }
  const keys = frame.keys ?? {};
  return rows.map((row) => {
    const vars: Record<string, string> = {};
    for (const key of row.keyVars) {
      const value = keys[key];
      if (typeof value === "string") {
        vars[key] = value;
      }
    }
    return { name: row.entry, vars };
  });
}

/**
 * Does a subscription's variables intersect a target's without disagreeing?
 *
 * The rule is "no field disagrees", NOT "the target's fields are all present".
 * Which direction this goes is the whole correctness question of the mapping,
 * and it is worth being explicit about:
 *
 * - A frame for `(tokenId: T, assetId: A, index: 3)` must invalidate a
 *   subscription on `{ tokenId: T, limit: 1000 }` — that list CONTAINS the row
 *   that changed. Requiring the target's fields to be present would miss it,
 *   and a missed invalidation is a stale screen that only the poll timer
 *   eventually fixes.
 * - The same frame must NOT invalidate `{ tokenId: T, assetId: B }`, whose
 *   result cannot have changed. A disagreement is the one thing that excludes.
 * - A variable the frame says nothing about (`limit`, `onlyUnclaimed`,
 *   `approvedAtTxHash`) cannot disagree, so it does not exclude. The cost is an
 *   occasional unnecessary refetch; the alternative cost is a missed one.
 *
 * Values are compared as strings because the wire carries strings and the
 * catalogue does not: `index` is a `number` in the entry's params and `"3"` on
 * the wire, and the two mean the same row.
 */
export function matchesVars(
  subscriptionVars: Readonly<Record<string, unknown>>,
  targetVars: Readonly<Record<string, string>>,
): boolean {
  for (const [key, value] of Object.entries(targetVars)) {
    const subscribed = subscriptionVars[key];
    if (subscribed === undefined || subscribed === null) {
      continue;
    }
    if (String(subscribed) !== value) {
      return false;
    }
  }
  return true;
}

/** What one {@link InvalidationHub.dispatch} call did, for logs and tests. */
export interface InvalidationDispatchResult {
  /** Why the frame was dropped, when it was. */
  ignored?: string;
  /** The `(name, vars)` invalidations the frame produced. */
  targets: InvalidationTarget[];
  /** Distinct subscriptions notified. One notification each, never more. */
  notified: number;
  /** Listeners that threw. Counted, never rethrown. */
  failed: number;
}

/**
 * Fan one raw frame out to the subscriptions it affects.
 *
 * The registry of `(name, vars)` subscribers, and the only place a raw frame
 * becomes a set of refetches. Two properties it exists to guarantee:
 *
 * 1. **Exactly one notification per distinct subscription.** A subscription is
 *    notified once per frame no matter how many mapping rows or key
 *    combinations select it — the affected set is collected before anything is
 *    called. Ten subscribers over three keys therefore refetch three times, not
 *    thirty.
 * 2. **A frame can never take a subscriber down.** An unreadable payload, an
 *    unknown table and a throwing listener are all counted and returned, never
 *    propagated: the caller is a stream event handler.
 */
export interface InvalidationHub {
  /**
   * Register interest in `(name, vars)`. Returns the unsubscribe.
   *
   * `vars` is the caller's PRE-validation variable object, exactly as it was
   * passed to the query — matching is textual and needs no catalogue parse.
   */
  subscribe(
    name: SdkQueryName,
    vars: Readonly<Record<string, unknown>> | undefined,
    listener: () => void,
  ): () => void;
  /** Validate, translate and fan out one raw frame. */
  dispatch(raw: unknown): InvalidationDispatchResult;
  /** Live subscription count, across all entries. */
  readonly size: number;
}

interface Registration {
  vars: Readonly<Record<string, unknown>>;
  listener: () => void;
}

/**
 * Build an {@link InvalidationHub}.
 *
 * @param tables - Table-to-entry mapping. Defaults to
 *   {@link INVALIDATION_TABLES}; overridable so a test can drive the mechanism
 *   without depending on which vertical happens to be mapped today.
 */
export function createInvalidationHub(
  tables: InvalidationTableMap = INVALIDATION_TABLES,
): InvalidationHub {
  const byEntry = new Map<SdkQueryName, Set<Registration>>();
  let size = 0;

  return {
    get size() {
      return size;
    },

    subscribe(name, vars, listener) {
      const registration: Registration = { vars: vars ?? {}, listener };
      let registrations = byEntry.get(name);
      if (!registrations) {
        registrations = new Set();
        byEntry.set(name, registrations);
      }
      registrations.add(registration);
      size++;

      let released = false;
      return () => {
        // Idempotent: rxjs teardown can run more than once, and a second call
        // must not make `size` drift below the live count.
        if (released) {
          return;
        }
        released = true;
        registrations.delete(registration);
        size--;
        if (registrations.size === 0) {
          byEntry.delete(name);
        }
      };
    },

    dispatch(raw) {
      const parsed = parseInvalidationFrame(raw);
      if (!parsed.ok) {
        return { ignored: parsed.reason, targets: [], notified: 0, failed: 0 };
      }

      const targets = invalidationTargets(parsed.frame, tables);
      if (targets.length === 0) {
        return {
          ignored: `no catalogue entry is mapped to table "${parsed.frame.table}"`,
          targets,
          notified: 0,
          failed: 0,
        };
      }

      // Collected first, called second. The set is what makes "exactly one
      // refetch per distinct subscription" a property of the code rather than
      // an accident of how many mapping rows a table happens to have.
      const affected = new Set<Registration>();
      for (const target of targets) {
        const registrations = byEntry.get(target.name);
        if (!registrations) {
          continue;
        }
        for (const registration of registrations) {
          if (matchesVars(registration.vars, target.vars)) {
            affected.add(registration);
          }
        }
      }

      let failed = 0;
      for (const registration of affected) {
        try {
          registration.listener();
        } catch {
          // A hint must not become an exception in a stream handler. The
          // refetch this listener would have triggered is covered by the poll
          // timer, which is the same guarantee a dropped frame gets.
          failed++;
        }
      }

      return { targets, notified: affected.size - failed, failed };
    },
  };
}
