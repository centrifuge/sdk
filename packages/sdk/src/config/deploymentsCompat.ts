/**
 * The `KNOWN_DEPLOYMENTS` allowlist API of `@centrifuge/sdk` 2.10.0, kept so code written against it
 * keeps compiling and running. The SDK never reads any of it: protocol addresses come from the
 * client's address book, never from the indexer, so there is nothing left to verify an indexer
 * response against.
 */
import { DEPLOYMENTS_V3_2 } from '@centrifuge/protocol'
import type { HexString, ProtocolContracts } from '../types/index.js'

/**
 * A mainnet protocol deployment in the shape the 2.10.0 allowlist listed it.
 *
 * @deprecated Kept for 2.10.0 compatibility. Read a chain's addresses with
 * `centrifuge.protocolContext(centrifugeId)`, or the registry from `await centrifuge._addressBook()`.
 */
export type KnownDeployment = Partial<ProtocolContracts> & {
  chainId: number
  name: string
}

/**
 * Mainnet protocol deployments keyed by `centrifugeId`, in the shape 2.10.0 exported: the bundled
 * address book's v3.2 mainnet stacks, built on first access. It reflects the bundled book only,
 * never a client's `addressBook` option.
 *
 * @deprecated Kept for 2.10.0 compatibility. Read a chain's addresses with
 * `centrifuge.protocolContext(centrifugeId)`, or the registry from `await centrifuge._addressBook()`.
 */
export const KNOWN_DEPLOYMENTS: Record<number, KnownDeployment> = builtOnFirstAccess(() =>
  Object.fromEntries(
    Object.entries(DEPLOYMENTS_V3_2.mainnet).map(([centrifugeId, { chainId, name, contracts }]) => [
      centrifugeId,
      { name, chainId, ...(contracts as Partial<Record<keyof ProtocolContracts, HexString>>) },
    ])
  )
)

/**
 * A deployment row as the indexer reported it to the 2.10.0 allowlist check.
 *
 * @deprecated Kept for 2.10.0 compatibility. Protocol addresses come from the client's address book
 * (`await centrifuge._addressBook()`); `centrifuge.deployments()` is informational only.
 */
export type IndexerDeployment = ProtocolContracts & {
  chainId?: string
  centrifugeId?: string
}

/**
 * The indexer response the 2.10.0 allowlist check took.
 *
 * @deprecated Kept for 2.10.0 compatibility. Protocol addresses come from the client's address book
 * (`await centrifuge._addressBook()`); `centrifuge.deployments()` is informational only.
 */
export type IndexerDeploymentResponse = {
  blockchains: { items: { id: string; centrifugeId: string; name: string; icon?: string }[] }
  deployments: { items: IndexerDeployment[] }
}

/**
 * Raised by the 2.10.0 allowlist check when an indexer-reported address did not match the bundled
 * allowlist.
 *
 * @deprecated Kept for 2.10.0 compatibility; nothing throws it. Protocol addresses come from the
 * client's address book (`await centrifuge._addressBook()`), and a book whose ABI records do not
 * match this build is refused with `AddressBookAbiMismatchError`.
 */
export class DeploymentMismatchError extends Error {
  override name = 'DeploymentMismatchError'
  constructor(
    public centrifugeId: number,
    public field: string,
    public expected: string,
    public actual: string
  ) {
    super(
      `Indexer-returned address for centrifugeId=${centrifugeId} field='${field}' ` +
        `does not match bundled allowlist. Expected ${expected}, got ${actual}. ` +
        `Refusing to use this deployment data.`
    )
  }
}

/**
 * Options of the 2.10.0 allowlist check.
 *
 * @deprecated Kept for 2.10.0 compatibility; nothing reads it. A book other than the bundled one is
 * accepted on mainnet only with `addressBook.allowUnsafeMainnet: true`.
 */
export type VerifyOptions = {
  /**
   * If true, allow indexer-reported deployments for centrifugeIds not present in the bundled
   * allowlist.
   */
  allowUnknownDeployments?: boolean
}

/**
 * A read-only view of `build()`'s result, built on the first read, so importing the SDK does not
 * build the bundled registry data.
 */
function builtOnFirstAccess<T extends object>(build: () => T): T {
  let built: T | undefined
  const target = () => (built ??= build())
  const readOnly = () => false
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(target(), key),
    has: (_, key) => Reflect.has(target(), key),
    ownKeys: () => Reflect.ownKeys(target()),
    // A proxy may not report a property as non-configurable when its own (empty) target lacks it.
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), key)
      return descriptor && { ...descriptor, configurable: true }
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  })
}
