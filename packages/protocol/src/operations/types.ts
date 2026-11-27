/** One on-chain call an operation makes: a function of a `contractAbis` key, with the enum member's name where it has one. */
export interface OperationCall {
  /** A key of the version's ABI set, e.g. `Hub`, `BalanceSheet`, `RestrictionManager`. */
  readonly contract: string;
  readonly function: string;
  /** The enum member's name the call carries, e.g. `Member` for `updateRestriction`, `Link` for `updateVault`. */
  readonly kind?: string;
}

/**
 * One operation: a named, stateless thing done in the system (a pool action, a Hub function or an audited event).
 * An on-chain step of a business action is an instance of one. `id` is the backend `PoolActionType` value, else the audit action, else `hub.<function>`
 * (`hub.updateVault.<Kind>` for a vault update kind).
 */
export interface OperationEntry {
  readonly id: string;
  /** What people read: in the app, the activity feed and the audit log. */
  readonly name: string;
  /** What the builders encode for it, across every protocol version; empty for an audit-only operation. */
  readonly calls: readonly OperationCall[];
  readonly poolAction?: string;
  readonly auditActions?: readonly string[];
  readonly hookCallAction?: string;
  readonly eventKinds?: readonly string[];
}
