import { poolIdFromShareClassId, REST_ROUTES } from '@centrifuge/queries/rest'
import { expect } from 'chai'
import { PoolId, ShareClassId } from '../utils/types.js'
import { backendRoutingTable } from './routing.js'

/**
 * The one thing `packages/queries` cannot check about its own route table.
 *
 * `REST_ROUTES.tokenInstances` serves a pool-scoped endpoint from an entry
 * whose only param is the share class id, by deriving the pool id from the id's
 * high 8 bytes. The authority for that layout is `ShareClassId` here in the
 * SDK, and `packages/queries` cannot import it (the dependency runs
 * queries -> sdk, never back). So the derivation is restated there and pinned
 * against the real class here: if `ShareClassId.from` / `.poolId` ever change
 * shift width, this fails rather than the route quietly addressing the wrong
 * pool — which the backend would answer with a 403 or a 404, not a wrong body,
 * but only after the caller had lost the read.
 */
describe('rest routes', () => {
  it('derives the same pool id ShareClassId does, across the id space', () => {
    const poolIds = ['1', '281474976710657', '562949953421319', '18446744073709551615']
    const counters = [0, 1, 2, 42, 65535]

    for (const raw of poolIds) {
      for (const counter of counters) {
        const scId = ShareClassId.from(new PoolId(raw), counter)
        expect(poolIdFromShareClassId(scId.raw), `${scId.raw}`).to.equal(scId.poolId.toString())
        expect(poolIdFromShareClassId(scId.raw)).to.equal(raw)
      }
    }
  })

  it('builds the token-instances path under the derived pool', () => {
    const scId = ShareClassId.from(new PoolId('281474976710657'), 1)
    const route = REST_ROUTES.tokenInstances

    expect(route, 'tokenInstances must be routed to REST').to.not.equal(undefined)
    expect(route!.path({ tokenId: scId.raw })).to.equal(
      `pools/${scId.poolId.toString()}/share-classes/${scId.raw}/token-instances`
    )
  })

  it('reports the routed reads and the still-fallback owners in one table', () => {
    const table = backendRoutingTable()

    expect(Object.keys(table.reads).sort()).to.deep.equal([
      // The vaults vertical has ONE catalogue-consuming read. Everything else
      // on its read list is contract reads composed entity-side, and
      // `vault.investment()` consumes no catalogue entry in either mode — so
      // the backend's permanent 503 for it has nothing to bind to here, and
      // the invest app's most-used per-address read stays on RPC.
      'allVaults',
      // Both holdings reads that consume a catalogue entry. The rest of that
      // read list consumes none in either mode: `_holding()` / `_assetPrice()` /
      // `_escrow()` are RPC contract reads and `centrifuge.valuations()` reads
      // the bundled `@centrifuge/protocol` registry, so none of them is a
      // missing row.
      'assetRegistrations',
      'basinDebt',
      'basinDebtChanges',
      'basinFees',
      'basinRedeemRequests',
      'basinSwaps',
      'blockchains',
      // All seven orders reads, here and below. Two SERVE (the epoch-level
      // lists) and five land on a route that answers 503 NOT_YET_PROJECTED,
      // which is the point and not a compromise: the graphql alternative
      // serves the CORRUPTED investor address (measured: 323/323 redeem rows
      // and 463/499 invest rows), and that value is who a `notifyRedeem`
      // would credit. An entry an app consumes needs a backend route; graphql
      // is a fallback, not a home.
      'closedInvestOrders',
      'closedRedeemOrders',
      // The cross-chain message reads, with their nested payload joins.
      'crosschainMessage',
      'crosschainMessages',
      // Orders, continued (see the two per-share-class rows above).
      //
      // The cost, stated rather than buried: `closedInvestments()` and
      // `closedRedemptions()` return no data in backend mode until the Embrio
      // decode lands, because both join per-investor rows onto their epochs. A
      // refusal in place of a plausible lie.
      'epochInvestOrders',
      'epochRedeemOrders',
      'holdingEscrows',
      'investOrderState',
      // Five of the six investors reads. The sixth,
      // `investorPortfolioSources`, is the one entry with no endpoint to route
      // ONTO: it is the GLOBAL, pool-less catalogue of vault asset addresses
      // and share token addresses that `Investor.portfolio()` pairs with an
      // on-chain `balanceOf`, and every private-api route that could serve
      // those addresses is pool-scoped because `PoolRolesGuard` reads the pool
      // out of the path. That makes the backend short an endpoint, not this a
      // decision.
      'investorTransactions',
      // All five on/off-ramp and merkle-proof-manager reads that consume a
      // catalogue entry. A subset would leave an entry an app consumes on
      // graphql, which is a fallback and not a home.
      'merkleProofManagers',
      'offRampAddresses',
      'onOffRampManagers',
      'onOffRampRelayers',
      'onRampAssets',
      'poolAdapters',
      // The fourth and last pool-access read. The rest of that read list
      // consumes no catalogue entry in either mode: `Pool.adapters()` and
      // `Centrifuge.adapters()`/`globalAdapters()` are `MultiAdapter` contract
      // reads, and `isPoolManager()` / `isBalanceSheetManager()` /
      // `balanceSheetManagers()` / `balanceSheetManagerStatus()` are
      // entity-side filters over `poolManagers` itself.
      'poolManagers',
      'pools',
      'redeemOrderState',
      'redeemOrdersByEpoch',
      // Both NAV reads that consume a catalogue entry. Both are `blocked` on
      // public-api — the SDK's default graphql target — so the REST route is
      // the only one that answers them at all; there is no "leave them on
      // graphql" option. The rest of the NAV read list consumes no entry of its
      // own: `_metrics()`, `valuation()`, `pool.currency()` and
      // `pool.decimals()` are contract reads, and `navPerNetwork()` consumes
      // `tokenInstances`.
      'sharePricesReport',
      'shareYieldsReport',
      'tokenInstancePosition',
      'tokenInstancePositions',
      'tokenInstances',
      'whitelistedInvestor',
      'whitelistedInvestors',
    ])
    // Every investors entry an app consumes has a backend route, with its one
    // documented exception named rather than skipped over.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'investors' && name !== 'investorPortfolioSources') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    expect(table.reads.investorPortfolioSources, 'the backend is short this endpoint').to.equal(undefined)
    // Not vacuous: five entries to check plus the exception.
    expect(Object.values(table.readOwners).filter((owner) => owner === 'investors')).to.have.length(6)
    // No orders entry is left on the fallback either.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'orders') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    // No on/off-ramp entry is left on the fallback. The other eleven reads in
    // that vertical consume no catalogue entry in either mode — RPC contract
    // reads and IPFS-composed workflow metadata — so they are not missing
    // rows; see `docs/api/basin-reads.md` in the backend repo.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'on-off-ramp') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'basin') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    expect(Object.values(table.readOwners).filter((owner) => owner === 'basin')).to.have.length(5)
    // No pool-access entry is left on the fallback. `pool.details()` — the
    // other tokenizations method with no row — still has none, and correctly:
    // it consumes no catalogue entry at all, in either mode.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'pool-access') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    // Not vacuous: the loop above has four entries to check.
    expect(Object.values(table.readOwners).filter((owner) => owner === 'pool-access')).to.have.length(4)
    // No holdings entry is left on the fallback either.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'holdings') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    // Nor any vaults entry.
    for (const [name, owner] of Object.entries(table.readOwners)) {
      if (owner === 'vaults') {
        expect(table.reads[name as keyof typeof table.reads], `${name} falls back`).to.not.equal(undefined)
      }
    }
    // The shipped write rows, by vertical. Holdings: five, all reached from an
    // entity method — `shareClass.createHolding()` and the four `balanceSheet`
    // movements. Vaults: two — `deployVault` (one vault per action) and the
    // batched `updateVaults`, which link, unlink and the max-reserve change
    // each fill one part of. NAV: ONE — `updateSharePrice` is the only NAV
    // write the backend ships a builder for; the other six have no
    // `PoolAction` at all (see `ACTION_ROUTES`' docstring for each by name)
    // and stay LocalBuild. Pool access: the two manager writes. Investors:
    // four.
    //
    // Orders: four, the epoch actions behind two dual-shape methods. Each
    // method routes to ONE of the two, and a mixed call is refused rather than
    // falling back to the local build — see `ACTION_ROUTES`. On/off-ramp: one,
    // `registerOnOffRamp`.
    expect(table.writes).to.deep.equal({
      createHolding: 'backend',
      depositHolding: 'backend',
      withdrawHolding: 'backend',
      issueSharesDirect: 'backend',
      revokeSharesDirect: 'backend',
      deployVault: 'backend',
      updateVaults: 'backend',
      updateSharePrice: 'backend',
      updatePoolManagers: 'backend',
      updateBalanceSheetManagers: 'backend',
      registerOnOffRamp: 'backend',
      updateMember: 'backend',
      freezeMember: 'backend',
      unfreezeMember: 'backend',
      crosschainTransferShares: 'backend',
      approveDeposits: 'backend',
      issueShares: 'backend',
      approveRedeems: 'backend',
      revokeShares: 'backend',
    })
    // The six NAV methods with no action are "not migrated", not "never":
    // unlike the investor-side vault flows they are pool-operator writes a
    // policy engine could legitimately gate, so they must not drift into the
    // permanent list.
    for (const method of [
      'ShareClass.notifySharePrice',
      'ShareClass.notifyAssetPrice',
      'ShareClass.setMaxSharePriceAge',
      'ShareClass.setMaxAssetPriceAge',
      'ShareClass.updateValuation',
      'Pool.updateOracleValuationFeeder',
    ]) {
      expect(table.permanentlyLocalMethods, method).to.not.include(method)
    }
    // Untouched, and permanently so: the investor-side vault flows never reach
    // a backend endpoint in any mode.
    expect(table.permanentlyLocalMethods).to.include('Vault.claim')
  })

  it('routes the two holdings reads at the paths the backend serves', () => {
    const scId = ShareClassId.from(new PoolId('281474976710657'), 1)

    expect(REST_ROUTES.holdingEscrows!.path({ tokenId: scId.raw })).to.equal(
      `pools/${scId.poolId.toString()}/holdings?scId=${scId.raw}`
    )
    // The hub chain, and no `spokeId`: `Centrifuge.assets()` applies the spoke
    // filter entity-side in both modes, so sending it would make the REST
    // answer a strict subset of the graphql answer for the same entry.
    expect(REST_ROUTES.assetRegistrations!.path({ centrifugeId: '2' })).to.equal('assets?hubId=2')
  })

  it('routes the two NAV reads under the pool derived from the share class', () => {
    // Same derivation, same authority: `packages/queries` restates the shift
    // and `ShareClassId` here is what it must agree with. The NAV routes make
    // the agreement load-bearing in a second way — they carry the pool in the
    // path AND the share class in `?scId=`, so a wrong shift would address one
    // pool while narrowing to another pool's share class.
    const poolId = new PoolId('281474976710657')
    const scId = ShareClassId.from(poolId, 1)
    const other = ShareClassId.from(poolId, 2)

    expect(REST_ROUTES.sharePricesReport!.path({ tokenIds: [scId.raw], limit: 1000 })).to.equal(
      `pools/${poolId.raw}/nav/prices?limit=1000&scId=${scId.raw}`
    )
    expect(
      REST_ROUTES.shareYieldsReport!.path({ tokenIds: [scId.raw], yieldFields: [], limit: 1000 })
    ).to.equal(`pools/${poolId.raw}/nav/yields?limit=1000&scId=${scId.raw}`)
    // Two share classes of the same pool: the whole pool, no `scId`.
    expect(
      REST_ROUTES.sharePricesReport!.path({ tokenIds: [scId.raw, other.raw], limit: 1000 })
    ).to.equal(`pools/${poolId.raw}/nav/prices?limit=1000`)
    // Two pools: refused rather than silently dropping one pool's rows.
    const foreign = ShareClassId.from(new PoolId('562949953421319'), 1)
    expect(() =>
      REST_ROUTES.sharePricesReport!.path({ tokenIds: [scId.raw, foreign.raw], limit: 1000 })
    ).to.throw(/more than one pool/)
  })
})
