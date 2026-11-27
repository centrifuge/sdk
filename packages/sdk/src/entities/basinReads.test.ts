import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { PoolId } from '../utils/types.js'
import { Basin } from './Basin.js'
import { Pool } from './Pool.js'

/**
 * The `Basin` entity's read surface.
 *
 * What is worth pinning here is the PARAMS each method sends, not the rows it
 * gets back: the catalogue's zod schemas are `.strict()`, so a misspelled or
 * surplus key is a runtime rejection against a real backend, and the shapes
 * themselves are proved against the live schema in
 * `packages/queries/src/graphql/public-api.integration.test.ts`.
 *
 * No chain, no network: the data source is a stub that records what it was
 * asked for.
 */

const ENVIRONMENT = 'mainnet'
const POOL_ID = PoolId.from(1, 13)
/** The real mainnet basin, from `src/config/basin.ts` in `centrifuge/api-v4`. */
const CHAIN_ID = 1
const BASIN = '0xf08943f817e1f902debc884c7b19ea5764594ac9' as HexString
const TOKEN_ID = '0x00010000000000060000000000000001'
const REDEEMER = '0x7c5ce1a1d50a6cb3da97c9e202b3e7cd8e5b5b6c' as HexString

/** Every `(entry, params)` pair the stubbed data source was asked for. */
let asked: { name: string; params: any }[] = []

function basin(): Basin {
  asked = []
  const centrifuge = new Centrifuge({
    environment: ENVIRONMENT,
    dataSource: {
      query: (name: string, params: any) => {
        asked.push({ name, params })
        return of(name === 'basinDebt' || name === 'basinFees' ? null : [])
      },
    } as any,
  })
  const pool = new Pool(centrifuge, POOL_ID.raw)
  return pool.basin(CHAIN_ID, BASIN, TOKEN_ID)
}

describe('Basin reads', () => {
  it('is reached from its pool and keeps the pool on the entity', () => {
    const b = basin()
    expect(b).to.be.instanceOf(Basin)
    expect(b.pool.id.equals(POOL_ID)).to.equal(true)
    expect(b.chainId).to.equal(CHAIN_ID)
    expect(b.basinAddress).to.equal(BASIN)
    expect(b.tokenId).to.equal(TOKEN_ID)
  })

  it('sends the full basin key on the three keyed reads', async () => {
    const b = basin()
    await firstValueFrom(b.debt())
    await firstValueFrom(b.fees())
    await firstValueFrom(b.debtChanges())

    for (const name of ['basinDebt', 'basinFees', 'basinDebtChanges']) {
      const call = asked.find((a) => a.name === name)
      expect(call, `${name} was not asked for`).to.not.equal(undefined)
      expect(call!.params.poolId).to.equal(POOL_ID.toString())
      expect(call!.params.chainId).to.equal(CHAIN_ID)
      expect(call!.params.basinAddress).to.equal(BASIN)
      expect(call!.params.tokenId).to.equal(TOKEN_ID)
    }
  })

  it('omits an unset limit rather than sending undefined', async () => {
    const b = basin()
    await firstValueFrom(b.swaps())
    const call = asked.find((a) => a.name === 'basinSwaps')!
    // `.strict()` would reject a surplus key, and an explicit `undefined`
    // would defeat the catalogue's `.default(1000)`.
    expect('limit' in call.params).to.equal(false)
  })

  it('forwards a set limit', async () => {
    const b = basin()
    await firstValueFrom(b.swaps(25))
    expect(asked.find((a) => a.name === 'basinSwaps')!.params.limit).to.equal(25)
  })

  it('sends the pool and the full basin key for redeem requests, plus set narrowing', async () => {
    const b = basin()
    await firstValueFrom(b.redeemRequests())
    const key = { poolId: POOL_ID.toString(), chainId: CHAIN_ID, basinAddress: BASIN, tokenId: TOKEN_ID }
    const bare = asked.find((a) => a.name === 'basinRedeemRequests')!
    expect(bare.params).to.deep.equal(key)

    asked = []
    await firstValueFrom(b.redeemRequests({ redeemer: REDEEMER, limit: 5 }))
    const narrowed = asked.find((a) => a.name === 'basinRedeemRequests')!
    expect(narrowed.params).to.deep.equal({ ...key, redeemer: REDEEMER, limit: 5 })
  })

  it('caches per argument, so a different limit is a different query', async () => {
    const b = basin()
    await firstValueFrom(b.swaps(10))
    await firstValueFrom(b.swaps(10))
    await firstValueFrom(b.swaps(20))
    const limits = asked.filter((a) => a.name === 'basinSwaps').map((a) => a.params.limit)
    // The repeat is served from cache; the different limit is not.
    expect(limits).to.deep.equal([10, 20])
  })
})
