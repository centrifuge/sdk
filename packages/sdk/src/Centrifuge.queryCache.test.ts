import { expect } from 'chai'
import { of } from 'rxjs'
import { Centrifuge } from './Centrifuge.js'
import type { QueryInvalidation } from './types/query.js'

describe('Centrifuge query cache invalidation', () => {
  let centrifuge: Centrifuge
  let signals: QueryInvalidation[]
  let builds: Record<string, number>

  const read = (keys: any[]) =>
    centrifuge._query(keys, () => {
      builds[keys.join('/')] = (builds[keys.join('/')] ?? 0) + 1
      return of(keys.join('/'))
    })

  beforeEach(() => {
    centrifuge = new Centrifuge({ environment: 'testnet' })
    signals = []
    builds = {}
    centrifuge.queryInvalidations$.subscribe((s) => signals.push(s))
  })

  it('memoizes by key until the cache is cleared', () => {
    expect(read(['pool', '1'])).to.equal(read(['pool', '1']))
    expect(builds['pool/1']).to.equal(1)
  })

  it('clears everything and signals null keys when called without a prefix', () => {
    const first = read(['pool', '1'])
    read(['currency', 'a'])
    centrifuge.clearQueryCache()
    expect(read(['pool', '1'])).to.not.equal(first)
    expect(builds['currency/a'] ?? 0).to.equal(1)
    read(['currency', 'a'])
    expect(builds['currency/a']).to.equal(2)
    expect(signals).to.deep.equal([{ keys: null }])
  })

  it('drops only entries under the key prefix', () => {
    const pool1 = read(['pool', '1'])
    const pool2 = read(['pool', '2'])
    const currency = read(['currency', 'a'])
    centrifuge.clearQueryCache(['pool', '1'])
    expect(read(['pool', '1'])).to.not.equal(pool1)
    expect(read(['pool', '2'])).to.equal(pool2)
    expect(read(['currency', 'a'])).to.equal(currency)
    expect(signals).to.deep.equal([{ keys: ['pool', '1'] }])
  })

  it('matches a one-element prefix against longer keys and not against longer prefixes', () => {
    const short = read(['pool'])
    const long = read(['pool', '1'])
    centrifuge.clearQueryCache(['pool', '1', 'extra'])
    expect(read(['pool'])).to.equal(short)
    expect(read(['pool', '1'])).to.equal(long)
    centrifuge.clearQueryCache(['pool'])
    expect(read(['pool'])).to.not.equal(short)
    expect(read(['pool', '1'])).to.not.equal(long)
  })

  it('does not replay past signals to late subscribers', () => {
    centrifuge.clearQueryCache()
    const late: QueryInvalidation[] = []
    centrifuge.queryInvalidations$.subscribe((s) => late.push(s))
    expect(late).to.deep.equal([])
  })
})
