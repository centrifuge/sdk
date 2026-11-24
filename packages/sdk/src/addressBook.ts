import {
  addressBook as bundledBook,
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
  deploymentsFromAddressBook,
  isBakedAddressBook,
  loadAddressBook,
  type AddressBook,
  type ChainEnvironment,
  type DeploymentRegistry,
} from '@centrifuge/protocol'

/** The address book a client resolves against, with the registry built from it. */
export type ActiveAddressBook = {
  registry: DeploymentRegistry
  /** The book `registry` was built from, for checks that read its ABI records. */
  book: AddressBook
  addressBookId: string
  /** The pinned registry head of each network. */
  registryHeads: Record<ChainEnvironment, string>
}

export const UNSAFE_BOOK_WARNING =
  '@centrifuge/sdk runs against a caller-provided address book, not the one bundled with it. ' +
  'Use this for staging and testnet only.'

/**
 * A mainnet client was given an address book other than the bundled one
 * without `allowUnsafeMainnet`: its transactions would sign against addresses
 * nothing here verified. Thrown by the `Centrifuge` constructor.
 */
export class UnsafeMainnetAddressBookError extends Error {
  constructor(
    readonly bookId: string,
    readonly bundledBookId: string
  ) {
    super(
      `@centrifuge/sdk refuses the address book ${bookId} on mainnet: it is not the bundled book ` +
        `${bundledBookId}. Pass addressBook.allowUnsafeMainnet: true to run against it anyway.`
    )
    this.name = 'UnsafeMainnetAddressBookError'
  }
}

/** Throws {@link UnsafeMainnetAddressBookError} for a refused mainnet book. */
export function assertProvidedBookAllowed(
  environment: ChainEnvironment,
  { book, allowUnsafeMainnet }: { book: AddressBook; allowUnsafeMainnet?: boolean }
): void {
  if (environment !== 'mainnet' || allowUnsafeMainnet === true || isBakedAddressBook(book)) return
  throw new UnsafeMainnetAddressBookError(book.bookId, bundledBook.bookId)
}

function headsOf(book: AddressBook): Record<ChainEnvironment, string> {
  return { mainnet: book.networks.mainnet.head, testnet: book.networks.testnet.head }
}

let bundled: ActiveAddressBook | undefined

/**
 * The book bundled with the SDK, through a registry of its own built once. Not
 * the process default, which a host may initialise with another book, so the
 * `bookId` and heads reported here describe the registry clients resolve through.
 */
export function bundledAddressBook(): ActiveAddressBook {
  bundled ??= {
    registry: createDeploymentRegistry(DEFAULT_DEPLOYMENT_DATA),
    book: bundledBook,
    addressBookId: bundledBook.bookId,
    registryHeads: headsOf(bundledBook),
  }
  return bundled
}

/**
 * Checks a caller's book against its own `bookId` and builds a registry from
 * it. The loader warns once per difference from the bundled book. Throws on a
 * mismatching `bookId` or a book the registry builder refuses, among them
 * `AddressBookAbiMismatchError` for ABI digests on `environment` that differ
 * from the SDK's, regardless of `allowUnsafeMainnet`. There is no fallback to
 * the bundled book.
 */
export async function loadProvidedAddressBook(
  environment: ChainEnvironment,
  provided: AddressBook
): Promise<ActiveAddressBook> {
  const { book } = await loadAddressBook({ network: environment, book: provided })
  const { registry } = deploymentsFromAddressBook(book, { network: environment })
  return {
    registry,
    book,
    addressBookId: book.bookId,
    registryHeads: headsOf(book),
  }
}
