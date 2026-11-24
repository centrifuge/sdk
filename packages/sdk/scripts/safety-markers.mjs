/**
 * Markers shared by the two gates that decide what leaves this repository:
 * `assert-publish-safety.mjs` over the npm artifact, and
 * `mirror/assert-mirror-safety.mjs` over the source tree mirrored to
 * `centrifuge/sdk`. One list, so the two gates cannot drift apart.
 */

/**
 * Markers for code that must never reach a public artifact. Each names WHAT
 * it is protecting, because a bare regex list rots into noise nobody trusts.
 */
export const BACKEND_ONLY_MARKERS = [
  // The Drizzle SQL layer and the schema package it reads. `queries/src/sql`
  // is the backend's adapter over `chain_v1`; `public-db` is the schema
  // itself. Either one in the bundle means the export graph changed.
  //
  // These match CODE, not prose. The bundle is built from TypeScript source
  // and keeps its comments, and those comments legitimately discuss the SQL
  // adapter and the `chain_v1` columns the GraphQL adapter mirrors -- naming
  // a thing is not importing it. Matching bare mentions made this check fire
  // on a doc comment, which is how a check earns a mute rather than a fix.
  {
    pattern: /(?:from|require\()\s*["'](?:drizzle-orm|@centrifuge\/public-db|pg)(?:\/[^"']*)?["']/,
    what: 'a runtime import of the backend SQL layer (drizzle-orm / public-db / pg)',
  },
  // Drizzle table builders, which only appear if schema code was pulled in.
  { pattern: /\bpgTable\s*\(/, what: 'Drizzle pg table definitions' },
  // The SQL adapter's own entry point.
  { pattern: /@centrifuge\/queries\/sql/, what: 'the backend-only queries/sql subpath' },
]

/**
 * Credential and internal-host shapes. Deliberately narrow: this is a
 * backstop for an obvious mistake, and a broad pattern here would fire on
 * legitimate protocol vocabulary (the SDK talks about tokens and signing
 * constantly) and get muted, which is worse than not checking.
 */
export const SECRET_MARKERS = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key id' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key' },
  // Classic, OAuth, user-to-server, server-to-server (Actions and App) and refresh tokens share one shape.
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, what: 'a GitHub token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, what: 'a fine-grained GitHub token' },
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/, what: 'an npm token' },
  { pattern: /\balchemy\.com\/v2\/[A-Za-z0-9_-]{20,}/, what: 'an Alchemy API key' },
  { pattern: /\binfura\.io\/v3\/[0-9a-f]{32}\b/, what: 'an Infura project id' },
  // A `[.]` class rather than an escaped dot: this file travels to centrifuge/sdk and the mirror gate
  // scans it, so its own source must not match. Written with the escape, the pattern's text does.
  { pattern: /[.]internal\b/, what: 'an internal hostname' },
  { pattern: /\b[A-Za-z0-9._%+-]+@centrifuge\.io\b/, what: 'an internal email address' },
]
