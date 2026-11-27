/**
 * @centrifuge/protocol — version-plural protocol layer (pure viem).
 *
 * Deployment registry, per-version ABI sets, `ProtocolContext` resolution,
 * pure transaction builders, the shared `Reader` interface, and
 * version-namespaced event decoding. Depends on `viem` and
 * `@centrifuge/addressbook` only — no NestJS, no Drizzle, no `@centrifuge/sdk`.
 *
 * Adding a protocol version means adding one version file (`registry/`: a
 * schema plus the address book stack it reads), registering it in
 * `SERVED_VERSIONS` and `DEFAULT_CONTRACT_SCHEMAS`, and adding one ABI
 * set (`abis/`) — no builder or consumer changes.
 */

export * from "./types";
export * from "./errors";
export * from "./abis";
export * from "./registry";
export * from "./context";
export * from "./reader";
export * from "./events";
export * from "./messages";
export * from "./builders";
export * from "./migration";
export * from "./operations";
