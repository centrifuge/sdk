import { expect } from 'chai'
import { of } from 'rxjs'
import { Centrifuge } from '../../Centrifuge.js'
import { PoolId, ShareClassId } from '../../utils/types.js'
import { Pool } from '../Pool.js'
import { PoolReports } from './PoolReports.js'
import { PoolSharePricesReport } from './PoolSharePricesReport.js'
import { PoolShareYieldsReport } from './PoolShareYieldsReport.js'

/**
 * A HARD PREREQUISITE of routing the NAV reads: `_process` must place both
 * transports' spelling of `timestamp` on the same UTC day.
 *
 * api-v3 (the graphql adapter) serves the column as a millisecond-epoch decimal
 * string; the backend's `GET /pools/:poolId/nav/{prices,yields}` serves
 * ISO-8601 UTC, which is also what public-api's PostGraphile returns for the
 * same `timestamptz`. Parsing the ISO form with `Number(...)` gives NaN and
 * `.toISOString()` then throws `RangeError: Invalid time value` — loud rather
 * than misdated, which is the property these cases keep for both spellings:
 * everything `snapshotDay` cannot place on a
 * specific day still throws.
 *
 * ## Why this file exists separately from the two report suites
 *
 * `PoolSharePricesReport.test.ts` and `PoolShareYieldsReport.test.ts` both
 * import `tests/setup.js` and so belong to `pnpm test:fork`, which skips
 * without Tenderly credentials. A property the REST route depends on cannot be
 * proven by a suite that may not run, so these cases live in a file with no
 * fork dependency and run in `pnpm test:unit` — the suite CI gates on.
 *
 * `_process` is pure, so the entities need no network: a bare `Centrifuge` with
 * an inert data source is enough to construct them.
 */

const POOL_ID = PoolId.from(1, 1)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const TOKEN_ID = SC_ID.raw

/** 2026-05-05T00:00:00Z, and the same instant spelled both ways. */
const MS_EPOCH = '1777939200000'
const MS_EPOCH_NOON = '1777982400000'
const ISO = '2026-05-05T00:00:00.000Z'
const ISO_NOON = '2026-05-05T12:00:00.000Z'
const DAY = '2026-05-05T00:00:00.000Z'

/** Ray-encoded (1e27) yields: 5.5% and 7%. */
const YIELD_55 = '55000000000000000000000000'
const YIELD_70 = '70000000000000000000000000'

/** Every yield column `token_snapshot` carries, so a row is realistic. */
const YIELD_FIELDS = [
  'yield1d',
  'yield1d360',
  'yield1d365',
  'yield7d',
  'yield7d360',
  'yield7d365',
  'yield15d',
  'yield15d360',
  'yield15d365',
  'yield30d',
  'yield30d360',
  'yield30d365',
  'yield90d',
  'yield90d360',
  'yield90d365',
  'yield180d',
  'yield180d360',
  'yield180d365',
  'yield30dComp360',
  'yield30dComp365',
  'yieldTtm',
  'yieldSinceInception',
  'yieldYtd',
] as const

function reports() {
  const centrifuge = new Centrifuge({
    environment: 'testnet',
    dataSource: { query: () => of({}) } as any,
  })
  const pool = new Pool(centrifuge, POOL_ID.raw)
  const poolReports = new PoolReports(centrifuge, pool)
  return {
    prices: new PoolSharePricesReport(centrifuge, poolReports),
    yields: new PoolShareYieldsReport(centrifuge, poolReports),
  }
}

/**
 * Two per-network price rows on one day, as BOTH transports serve them apart
 * from the timestamp spelling.
 */
function priceRows(timestamp: string) {
  return {
    tokenInstanceSnapshots: {
      items: [
        { tokenId: TOKEN_ID, timestamp, totalIssuance: '100', tokenPrice: '1000000000000000000', triggerChainId: '1' },
        { tokenId: TOKEN_ID, timestamp, totalIssuance: '200', tokenPrice: '1100000000000000000', triggerChainId: '8453' },
      ],
    },
  }
}

/** One `token_snapshot` row: every yield column null except `yieldYtd`. */
function yieldRow(timestamp: string, yieldYtd: string) {
  const row: Record<string, unknown> = { id: TOKEN_ID, timestamp }
  for (const field of YIELD_FIELDS) {
    row[field] = null
  }
  row.yieldYtd = yieldYtd
  return row as any
}

/**
 * Two yield rows on the same UTC day, newest FIRST — the order both transports
 * promise and the order `_process` depends on.
 */
function yieldRows(early: string, late: string) {
  return { tokenSnapshots: { items: [yieldRow(late, YIELD_70), yieldRow(early, YIELD_55)] } }
}

describe('snapshot timestamp spellings', () => {
  describe('sharePricesReport', () => {
    it('produces the same report from a millisecond epoch and from ISO-8601', () => {
      const { prices } = reports()

      const fromEpoch = prices._process(priceRows(MS_EPOCH), {}, 18)
      const fromIso = prices._process(priceRows(ISO), {}, 18)

      // The property that lets either transport serve this entry, at the one
      // place they disagree: same day, same summed issuance, same price
      // source.
      expect(fromIso).to.have.length(1)
      expect(fromIso[0]!.timestamp).to.equal(fromEpoch[0]!.timestamp)
      expect(fromIso[0]!.timestamp).to.equal(DAY)
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.totalIssuance.toBigInt()).to.equal(300n)
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.totalIssuance.toBigInt()).to.equal(
        fromEpoch[0]!.shareClasses[TOKEN_ID]!.totalIssuance.toBigInt()
      )
      // The price comes from the larger-issuance chain in both spellings.
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.price.toBigInt()).to.equal(1100000000000000000n)
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.price.toBigInt()).to.equal(
        fromEpoch[0]!.shareClasses[TOKEN_ID]!.price.toBigInt()
      )
    })

    it('still reads a millisecond epoch as MILLISECONDS, so public mode is unchanged', () => {
      // The other half of the widening, and the value it protects: the digits
      // branch is untouched, so a row api-v3 served before this task lands on
      // exactly the day it always did. Read as SECONDS the same number would be
      // some time in the year 58285, which would silently reorder the series
      // and put every figure on the wrong date.
      const { prices } = reports()

      expect(prices._process(priceRows(MS_EPOCH), {}, 18)[0]!.timestamp).to.equal(DAY)
    })

    it('accepts the +00:00 offset PostGraphile serialises a timestamptz as', () => {
      // Not hypothetical: public-api returns `…+00:00` where the sql adapter's
      // `Date.toISOString()` returns `…Z`, and this entry is expected to reach
      // the graphql adapter too once `sharePricesReport` is unblocked.
      const { prices } = reports()

      expect(prices._process(priceRows('2026-05-05T00:00:00+00:00'), {}, 18)[0]!.timestamp).to.equal(DAY)
    })

    it('keeps rows on separate days separate, in both spellings', () => {
      // A widening that collapsed everything onto one bucket would pass every
      // equality above. This is the control that says the day is really read
      // out of the value.
      const { prices } = reports()
      const twoDays = (first: string, second: string) => ({
        tokenInstanceSnapshots: {
          items: [
            ...priceRows(first).tokenInstanceSnapshots.items,
            ...priceRows(second).tokenInstanceSnapshots.items,
          ],
        },
      })

      const fromEpoch = prices._process(twoDays(MS_EPOCH, '1778025600000'), {}, 18)
      const fromIso = prices._process(twoDays(ISO, '2026-05-06T00:00:00.000Z'), {}, 18)

      expect(fromEpoch.map((item) => item.timestamp)).to.deep.equal([DAY, '2026-05-06T00:00:00.000Z'])
      expect(fromIso.map((item) => item.timestamp)).to.deep.equal(fromEpoch.map((item) => item.timestamp))
    })

    it('refuses a datetime with no offset rather than reading it in local time', () => {
      // `new Date('2026-05-05T00:30:00')` is parsed in the RUNTIME's zone, so
      // the same row would bucket on 2026-05-04 west of UTC and on 2026-05-05
      // east of it. A day that depends on where the process runs is exactly the
      // plausible wrong value this widening must not introduce, and it is the
      // one spelling that would otherwise pass silently.
      const { prices } = reports()

      expect(() => prices._process(priceRows('2026-05-05T00:30:00'), {}, 18)).to.throw(/explicit\s+UTC offset/)
    })

    it('refuses a timestamp it cannot place on a day at all, naming the entry', () => {
      const { prices } = reports()
      let error: any
      try {
        prices._process(priceRows('last tuesday'), {}, 18)
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(Error)
      expect(error.message).to.contain('sharePricesReport')
      expect(error.message).to.contain('last tuesday')
    })
  })

  describe('shareYieldsReport', () => {
    it('produces the same report from a millisecond epoch and from ISO-8601', () => {
      // It matters more here than on the price side: this `_process` keeps the
      // FIRST row it sees for a `(date, id)` pair, so a day boundary read
      // wrongly would not just mislabel a row — it would report a different
      // day's yields as this day's figure.
      const { yields } = reports()

      const fromEpoch = yields._process(yieldRows(MS_EPOCH, MS_EPOCH_NOON), {})
      const fromIso = yields._process(yieldRows(ISO, ISO_NOON), {})

      expect(fromIso).to.have.length(1)
      expect(fromIso[0]!.timestamp).to.equal(fromEpoch[0]!.timestamp)
      expect(fromIso[0]!.timestamp).to.equal(DAY)
      // The noon row (7%) is first in the input and must win in both.
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.yieldYtd!.toNumber()).to.equal(7)
      expect(fromIso[0]!.shareClasses[TOKEN_ID]!.yieldYtd!.toNumber()).to.equal(
        fromEpoch[0]!.shareClasses[TOKEN_ID]!.yieldYtd!.toNumber()
      )
    })

    it('still reads a millisecond epoch as MILLISECONDS, so public mode is unchanged', () => {
      const { yields } = reports()

      expect(yields._process(yieldRows(MS_EPOCH, MS_EPOCH_NOON), {})[0]!.timestamp).to.equal(DAY)
    })

    it('refuses a datetime with no offset, naming this entry', () => {
      const { yields } = reports()
      let error: any
      try {
        yields._process({ tokenSnapshots: { items: [yieldRow('2026-05-05T00:30:00', YIELD_55)] } }, {})
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(Error)
      expect(error.message).to.contain('shareYieldsReport')
      expect(error.message).to.contain('explicit')
    })
  })
})
