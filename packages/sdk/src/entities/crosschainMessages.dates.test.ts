import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { queryCrosschainMessage } from './crosschainMessages.js'

/**
 * Timestamp parsing in `toMessage`.
 *
 * The two crosschain-message entries are served by api-v3 in epoch-millisecond
 * strings and by the backend in ISO-8601 UTC, so `toMessage` must accept both.
 * `new Date(Number('2026-02-01T00:00:00.000Z'))` is `Invalid Date`, which is a
 * silent wrong value on every date of every message — so an unparseable value
 * throws instead, and both spellings are pinned here.
 *
 * Stubs `_queryData`, the seam these reads take.
 */
describe('crosschain message timestamps', () => {
  const PAYLOAD = `0x${'ab'.repeat(32)}` as HexString

  afterEach(() => {
    sinon.restore()
  })

  /** A payload as a data source hands it over, with caller-chosen timestamps. */
  function rawPayload(overrides: Record<string, unknown> = {}) {
    return {
      id: PAYLOAD,
      index: 0,
      poolId: '281474976710657',
      tokenId: null,
      fromCentrifugeId: '1',
      toCentrifugeId: '2',
      status: 'InTransit',
      rawData: '0xdead',
      gasLimit: '250000',
      gasPrice: '0',
      createdAt: '2026-02-01T00:00:00.000Z',
      deliveredAt: null,
      completedAt: null,
      createdAtTxHash: `0x${'11'.repeat(32)}`,
      deliveredAtTxHash: null,
      ...overrides,
    }
  }

  function readOne(payload: unknown) {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    sinon.stub(centrifuge as any, '_queryData').returns(of(payload))
    return queryCrosschainMessage(centrifuge, PAYLOAD, 0)
  }

  it('reads the ISO-8601 timestamps the backend serves', async () => {
    // Every nested site too: the bug was one helper used at six call sites, and
    // a fixture carrying only `createdAt` would leave five unproven.
    const message = await readOne(
      rawPayload({
        deliveredAt: '2026-02-02T00:00:00.000Z',
        completedAt: '2026-02-03T00:00:00.000Z',
        crosschainMessages: {
          items: [
            {
              id: `0x${'22'.repeat(32)}`,
              index: 0,
              poolId: null,
              tokenId: null,
              payloadId: PAYLOAD,
              payloadIndex: 0,
              fromCentrifugeId: '1',
              toCentrifugeId: '2',
              messageType: 'UpdateShares',
              status: 'Executed',
              rawData: '0x0e00',
              data: null,
              failReason: null,
              createdAt: '2026-02-01T00:00:00.000Z',
              executedAt: '2026-02-04T00:00:00.000Z',
              executedAtTxHash: null,
            },
          ],
        },
        adapterParticipations: {
          items: [
            {
              centrifugeId: '1',
              fromCentrifugeId: '1',
              toCentrifugeId: '2',
              type: 'PAYLOAD',
              side: 'SEND',
              gasPaid: null,
              timestamp: '2026-02-05T00:00:00.000Z',
              transactionHash: `0x${'33'.repeat(32)}`,
              adapter: null,
            },
          ],
        },
      })
    )

    expect(message!.createdAt.toISOString()).to.equal('2026-02-01T00:00:00.000Z')
    expect(message!.deliveredAt!.toISOString()).to.equal('2026-02-02T00:00:00.000Z')
    expect(message!.completedAt!.toISOString()).to.equal('2026-02-03T00:00:00.000Z')
    expect(message!.innerMessages![0]!.createdAt.toISOString()).to.equal('2026-02-01T00:00:00.000Z')
    expect(message!.innerMessages![0]!.executedAt!.toISOString()).to.equal('2026-02-04T00:00:00.000Z')
    expect(message!.adapterParticipations![0]!.timestamp.toISOString()).to.equal('2026-02-05T00:00:00.000Z')
  })

  it('still reads api-v3 epoch-millisecond strings', async () => {
    // The api-v3 documents are in the tree (`graphql/api-v3.ts`), so this
    // format has to keep working. The two are unambiguous: an epoch-millis
    // string is all digits, an ISO one never is.
    const message = await readOne(rawPayload({ createdAt: '1773411360000' }))

    expect(message!.createdAt.toISOString()).to.equal(new Date(1773411360000).toISOString())
  })

  it('throws on an unreadable timestamp rather than returning Invalid Date', async () => {
    // Loud beats plausible: `Invalid Date` renders as the string "Invalid Date"
    // in a table cell and cannot be told apart from a projection that has no
    // timestamp yet. The message names the field so the fix is findable.
    let error: unknown
    try {
      await readOne(rawPayload({ createdAt: 'yesterday' }))
    } catch (caught) {
      error = caught
    }

    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.contain('createdAt')
    expect((error as Error).message).to.contain('yesterday')
  })

  it('names the nested field when an inner message carries the bad value', async () => {
    let error: unknown
    try {
      await readOne(
        rawPayload({
          crosschainMessages: {
            items: [
              {
                id: `0x${'22'.repeat(32)}`,
                index: 0,
                poolId: null,
                tokenId: null,
                payloadId: PAYLOAD,
                payloadIndex: 0,
                fromCentrifugeId: '1',
                toCentrifugeId: '2',
                messageType: 'UpdateShares',
                status: 'Executed',
                rawData: null,
                data: null,
                failReason: null,
                createdAt: 'not-a-date',
                executedAt: null,
                executedAtTxHash: null,
              },
            ],
          },
        })
      )
    } catch (caught) {
      error = caught
    }

    expect((error as Error).message).to.contain('innerMessages[].createdAt')
  })

  it('leaves a null timestamp undefined instead of parsing it', async () => {
    const message = await readOne(rawPayload())

    expect(message!.deliveredAt).to.equal(undefined)
    expect(message!.completedAt).to.equal(undefined)
  })
})
