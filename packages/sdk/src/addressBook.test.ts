import { expect } from 'chai'
import sinon from 'sinon'
import { firstValueFrom, of } from 'rxjs'
import {
  addressBook,
  bookIdOf,
  DEFAULT_DEPLOYMENT_DATA,
  defaultDeploymentRegistry,
  loadAddressBook,
  ProtocolVersionResolutionError,
  type AddressBook,
} from '@centrifuge/protocol'
import { Centrifuge } from './Centrifuge.js'
import { AddressBookAbiMismatchError, UnsafeMainnetAddressBookError } from './index.js'
import { PoolId } from './utils/types.js'

const REPLACED_HUB = '0x000000000000000000000000000000000000dead'
const STAGING_HEADS = {
  mainnet: 'https://registry.example.invalid/mainnet.json',
  testnet: 'https://registry.example.invalid/testnet.json',
}
const MAINNET_HUB_CHAIN = '1'
const CHAIN_WITHOUT_BOOK_ENTRY = '3'

const UNSAFE_WARNING = /caller-provided address book/
const ABI_WARNING = /no bundled ABI are not checked against the build/
const FOREIGN_DIGEST = `0x${'ab'.repeat(32)}` as const
const DIFFERENCE_WARNING = /against the baked book|now resolves to/
const LOADER_CALL = /not verified against a registry/
const BAKED_HUB = DEFAULT_DEPLOYMENT_DATA.mainnet!['3.2']![1]!.contracts.hub

/** The baked book with `edit` applied to a copy and `bookId` recomputed, as `build-book` would write it. */
function bookWith(edit: (book: AddressBook) => void): AddressBook {
  const book = structuredClone(addressBook)
  edit(book)
  return { ...book, bookId: bookIdOf(book) }
}

/**
 * Mainnet chain 1 resolves `hub` to {@link REPLACED_HUB}, with other registry heads; the old address stays in the
 * book's history. The hub replaced is the `v3.2.0` stack's, which the tests name; `current` (v3.3.0) is set to it too,
 * so the book differs by an added address and a changed current address.
 */
function bookWithReplacedHub(): AddressBook {
  return bookWith((book) => {
    book.networks.mainnet.head = STAGING_HEADS.mainnet
    book.networks.testnet.head = STAGING_HEADS.testnet
    const chain = book.networks.mainnet.chains[MAINNET_HUB_CHAIN]!
    const old = chain.stacks['v3.2.0']!.hub!.toLowerCase()
    chain.addresses[REPLACED_HUB as `0x${string}`] = { ...chain.addresses[old as `0x${string}`]!, blockNumber: null }
    chain.current.hub = REPLACED_HUB
    for (const stack of Object.values(chain.stacks)) {
      if (stack.hub?.toLowerCase() === old) stack.hub = REPLACED_HUB
    }
  })
}

/** `network` chain 1's `v3.2.0` hub record carries `abi` merged over its own. */
function bookWithHubAbi(
  abi: { name?: string; digest?: `0x${string}` },
  network: 'mainnet' | 'testnet' = 'mainnet'
): AddressBook {
  return bookWithStackAbi('hub', abi, network)
}

/** Edits the ABI record of `contract` in the `v3.2.0` stack of `network`'s chain 1. */
function bookWithStackAbi(
  contract: string,
  abi: { name?: string; digest?: `0x${string}` },
  network: 'mainnet' | 'testnet'
): AddressBook {
  return bookWith((book) => {
    const chain = book.networks[network].chains[MAINNET_HUB_CHAIN]!
    const address = chain.stacks['v3.2.0']![contract]!
    const record = chain.addresses[address.toLowerCase() as `0x${string}`]!
    record.abi = { ...record.abi!, ...abi }
  })
}

function bookWithoutChain(): AddressBook {
  return bookWith((book) => {
    delete book.networks.mainnet.chains[CHAIN_WITHOUT_BOOK_ENTRY]
  })
}

function tamperedBook(): AddressBook {
  const book = bookWithReplacedHub()
  return { ...book, bookId: addressBook.bookId }
}

function mentions(spy: sinon.SinonSpy, pattern: RegExp) {
  return spy.getCalls().filter(({ args }) => pattern.test(String(args[0])))
}

describe('address book option', () => {
  let fetchSpy: sinon.SinonStub
  let warnSpy: sinon.SinonStub
  let infoSpy: sinon.SinonStub

  beforeEach(() => {
    fetchSpy = sinon.stub(globalThis, 'fetch').rejects(new Error('no request expected'))
    warnSpy = sinon.stub(console, 'warn')
    infoSpy = sinon.stub(console, 'info')
  })
  afterEach(() => sinon.restore())

  describe('without the option', () => {
    it('resolves from the bundled registry with no request and no warning', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })

      const ctx = await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })
      await centrifuge._idToChain(1)
      await centrifuge._chains()

      expect(ctx.hub).to.equal(BAKED_HUB)
      expect(fetchSpy.callCount).to.equal(0)
      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(0)
      expect(mentions(infoSpy, LOADER_CALL)).to.have.length(0)
    })

    it('reports the bundled book id and registry heads', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })

      expect(await centrifuge.addressBookId()).to.equal(addressBook.bookId)
      expect(await centrifuge.registryHeads()).to.deep.equal({
        mainnet: addressBook.networks.mainnet.head,
        testnet: addressBook.networks.testnet.head,
      })
    })
    it('resolves through one registry of the bundled book shared by clients, not the replaceable process default', async () => {
      const first = await new Centrifuge({ environment: 'mainnet' })._addressBook()
      const second = await new Centrifuge({ environment: 'testnet' })._addressBook()

      expect(first.registry).to.not.equal(defaultDeploymentRegistry())
      expect(first.registry).to.equal(second.registry)
      expect(first.registry.getDeployment('mainnet', '3.2', 1).contracts.hub).to.equal(BAKED_HUB)
    })
  })

  describe('with a book', () => {
    it('resolves the address of the given book with no request', async () => {
      const book = bookWithReplacedHub()
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })

      const ctx = await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })

      expect(ctx.hub.toLowerCase()).to.equal(REPLACED_HUB)
      expect(ctx.hub).to.not.equal(BAKED_HUB)
      expect(fetchSpy.callCount).to.equal(0)
    })

    it('resolves the pool-scoped context builders sign against from the given book', async () => {
      const centrifuge = new Centrifuge({
        environment: 'mainnet',
        addressBook: { book: bookWithReplacedHub(), allowUnsafeMainnet: true },
      })
      const poolId = PoolId.from(1, 1)
      sinon
        .stub(centrifuge as any, '_queryData')
        .callsFake(() => of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'live' }]))

      const ctx = await centrifuge.protocolContext(poolId)

      expect(ctx.context!.addresses.hub!.toLowerCase()).to.equal(REPLACED_HUB)
      expect(ctx.context!.addresses.hub).to.equal(ctx.hub)
    })

    it('loads the book once per client across every registry lookup', async () => {
      const centrifuge = new Centrifuge({
        environment: 'mainnet',
        addressBook: { book: bookWithReplacedHub(), allowUnsafeMainnet: true },
      })
      sinon.stub(centrifuge as any, '_queryData').callsFake(() => of([]))

      await centrifuge.protocolContext(1)
      await centrifuge.protocolContext({ centrifugeId: 1, protocolVersion: '3.2' })
      await centrifuge.protocolContext(PoolId.from(15, 1))
      await centrifuge._systemAddresses(1)
      await centrifuge._chains()
      await centrifuge._idToChain(1)
      await centrifuge._chainToId(1)
      await centrifuge._reader.chainProtocolVersion(1)
      await centrifuge.addressBookId()
      await centrifuge.registryHeads()

      expect(mentions(infoSpy, LOADER_CALL)).to.have.length(1)
      expect(fetchSpy.callCount).to.equal(0)
    })

    it('follows the book in the chain directory, the reader and the deployed-version check', async () => {
      const centrifuge = new Centrifuge({
        environment: 'mainnet',
        addressBook: { book: bookWithoutChain(), allowUnsafeMainnet: true },
      })
      const poolId = PoolId.from(1, 1)
      sinon
        .stub(centrifuge as any, '_queryData')
        .callsFake(() => of([{ id: poolId.toString(), protocolVersion: '3.2', migrationStatus: 'live' }]))

      expect((await centrifuge._chains()).map((chain) => chain.centrifugeId)).to.not.include(3)
      const chainThree = await centrifuge._idToChain(3).then(
        () => null,
        (error: Error) => error
      )
      expect(chainThree?.message).to.match(/not found/)
      const chainId = addressBook.networks.mainnet.chains[CHAIN_WITHOUT_BOOK_ENTRY]!.chainId
      const byChainId = await centrifuge._chainToId(chainId).then(
        () => null,
        (error: Error) => error
      )
      expect(byChainId?.message).to.match(/not found/)
      const reader = await centrifuge._reader.chainProtocolVersion(3).then(
        () => null,
        (error: unknown) => error
      )
      expect(reader).to.be.instanceOf(ProtocolVersionResolutionError)
      const deployedOn = await firstValueFrom(centrifuge._protocolVersionFor({ centrifugeId: 3, poolId })).then(
        () => null,
        (error: unknown) => error
      )
      expect(deployedOn).to.be.instanceOf(ProtocolVersionResolutionError)
      const systemAddresses = await centrifuge._systemAddresses(3).then(
        () => null,
        (error: unknown) => error
      )
      expect(systemAddresses).to.be.instanceOf(ProtocolVersionResolutionError)
    })

    it('hands the contract-version check the provided book', async () => {
      const book = bookWithReplacedHub()
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })

      const active = await centrifuge._addressBook()

      expect(active.book).to.deep.equal(book)
    })

    it('reports the given book id and registry heads', async () => {
      const book = bookWithReplacedHub()
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })

      expect(await centrifuge.addressBookId()).to.equal(book.bookId)
      expect(book.bookId).to.not.equal(addressBook.bookId)
      expect(await centrifuge.registryHeads()).to.deep.equal(STAGING_HEADS)
      expect(STAGING_HEADS.mainnet).to.not.equal(addressBook.networks.mainnet.head)
    })

    it('matches the loader on what differs from the baked book', async () => {
      const { differences } = await loadAddressBook({
        network: 'mainnet',
        book: bookWithReplacedHub(),
        log: { info() {}, warn() {} },
      })

      expect(differences).to.have.length(2)
    })
  })

  describe('warnings', () => {
    it('warns once at construction that the client runs unsafe', () => {
      new Centrifuge({ environment: 'mainnet', addressBook: { book: bookWithReplacedHub(), allowUnsafeMainnet: true } })

      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(1)
      expect(mentions(warnSpy, DIFFERENCE_WARNING)).to.have.length(0)
    })

    it('warns once per difference from the bundled book on first resolution and never again', async () => {
      const centrifuge = new Centrifuge({
        environment: 'mainnet',
        addressBook: { book: bookWithReplacedHub(), allowUnsafeMainnet: true },
      })

      await centrifuge.protocolContext(1)
      await centrifuge.protocolContext(1)
      await centrifuge._chains()

      expect(mentions(warnSpy, DIFFERENCE_WARNING)).to.have.length(2)
      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(1)
    })

    it('does not warn at construction for a book whose bookId is the bundled one', () => {
      new Centrifuge({ environment: 'testnet', addressBook: { book: addressBook } })

      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(0)
    })

    it('warns once per client', () => {
      const book = bookWithReplacedHub()
      new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })
      new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })

      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(2)
    })

    it('does not warn for the bundled book', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })

      await centrifuge.protocolContext(1)

      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(0)
      expect(mentions(warnSpy, DIFFERENCE_WARNING)).to.have.length(0)
    })
  })

  describe('on mainnet', () => {
    it('refuses a book other than the bundled one at construction', () => {
      const book = bookWithReplacedHub()
      let error: unknown
      try {
        new Centrifuge({ environment: 'mainnet', addressBook: { book } })
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(UnsafeMainnetAddressBookError)
      expect(error).to.include({ bookId: book.bookId, bundledBookId: addressBook.bookId })
      expect((error as Error).message).to.match(/allowUnsafeMainnet/)
    })

    it('accepts a book other than the bundled one with allowUnsafeMainnet, warning once', () => {
      new Centrifuge({ environment: 'mainnet', addressBook: { book: bookWithReplacedHub(), allowUnsafeMainnet: true } })

      expect(mentions(warnSpy, UNSAFE_WARNING)).to.have.length(1)
    })

    it('accepts the bundled book without allowUnsafeMainnet', () => {
      expect(() => new Centrifuge({ environment: 'mainnet', addressBook: { book: addressBook } })).to.not.throw()
    })

    it('accepts a book other than the bundled one on testnet without allowUnsafeMainnet', () => {
      expect(
        () => new Centrifuge({ environment: 'testnet', addressBook: { book: bookWithReplacedHub() } })
      ).to.not.throw()
    })
  })

  describe('a book whose ABI digests differ from the build', () => {
    for (const [label, environment, allowUnsafeMainnet] of [
      ['on mainnet with allowUnsafeMainnet', 'mainnet', true],
      ['on testnet without allowUnsafeMainnet', 'testnet', undefined],
    ] as const) {
      it(`throws on first resolution and on every later one, naming Hub, ${label}`, async () => {
        const book = bookWithHubAbi({ digest: FOREIGN_DIGEST }, environment)
        const centrifuge = new Centrifuge({ environment, addressBook: { book, allowUnsafeMainnet } })

        for (const resolve of [
          () => centrifuge.protocolContext(1),
          () => centrifuge._idToChain(1),
          () => centrifuge.addressBookId(),
        ]) {
          const error = await Promise.resolve(resolve()).then(
            () => null,
            (e: unknown) => e
          )
          expect(error).to.be.instanceOf(AddressBookAbiMismatchError)
          expect((error as Error).message).to.match(/hub \(Hub\) at 0x[0-9a-f]{40}: book 0xabab/)
        }
        expect(fetchSpy.callCount).to.equal(0)
      })
    }
  })

  describe('a book that records the hub under another ABI name', () => {
    it('throws when its digest is not the Hub ABI the SDK encodes with', async () => {
      const book = bookWithHubAbi({ name: 'Hub2', digest: FOREIGN_DIGEST }, 'testnet')
      const centrifuge = new Centrifuge({ environment: 'testnet', addressBook: { book } })

      const error = await centrifuge.addressBookId().then(
        () => null,
        (e: unknown) => e
      )

      expect(error).to.be.instanceOf(AddressBookAbiMismatchError)
      expect((error as Error).message).to.match(/hub \(Hub2\) at 0x[0-9a-f]{40}: book 0xabab/)
    })
  })

  describe('a book whose ABI digests differ only on the other network', () => {
    it('resolves on the network the client serves', async () => {
      const book = bookWithHubAbi({ digest: FOREIGN_DIGEST }, 'testnet')
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book, allowUnsafeMainnet: true } })

      expect(await centrifuge.addressBookId()).to.equal(book.bookId)
    })
  })

  describe('a book with an ABI name no bundled ABI set carries', () => {
    it('loads and warns once per client, listing the name', async () => {
      const book = bookWithStackAbi('root', { name: 'RootFromTheFuture' }, 'testnet')
      const centrifuge = new Centrifuge({ environment: 'testnet', addressBook: { book } })

      await centrifuge._chains()
      await centrifuge.addressBookId()
      await centrifuge.registryHeads()

      const warnings = mentions(warnSpy, ABI_WARNING)
      expect(warnings).to.have.length(1)
      expect(String(warnings[0]!.args[0])).to.match(/v3\.2\.0: .*RootFromTheFuture/)
      expect(fetchSpy.callCount).to.equal(0)
    })

    it('does not warn for the bundled book', async () => {
      const centrifuge = new Centrifuge({ environment: 'testnet', addressBook: { book: addressBook } })

      await centrifuge._chains()

      expect(mentions(warnSpy, ABI_WARNING)).to.have.length(0)
    })
  })

  describe('a book whose bookId does not match its content', () => {
    it('throws on first resolution and on every later one, never resolving the bundled address', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book: tamperedBook() } })

      for (const resolve of [
        () => centrifuge.protocolContext(1),
        () => centrifuge.protocolContext(1),
        () => centrifuge._idToChain(1),
        () => centrifuge.addressBookId(),
      ]) {
        const error = await Promise.resolve(resolve()).then(
          () => null,
          (e: Error) => e
        )
        expect(error?.message).to.match(/carries bookId .* but its content hashes to/)
      }
    })

    it('does not fall back for the reader or the system addresses', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet', addressBook: { book: tamperedBook() } })

      const reader = await centrifuge._reader.chainProtocolVersion(1).then(
        () => null,
        (e: Error) => e
      )
      const system = await centrifuge._systemAddresses(1).then(
        () => null,
        (e: Error) => e
      )

      expect(reader?.message).to.match(/carries bookId/)
      expect(system?.message).to.match(/carries bookId/)
    })
  })
})
