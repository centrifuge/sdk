import { isWhitelistedAt } from "../core/investor-status";
import type { SdkQueryName } from "../core/sdk-catalogue";

/**
 * The legacy api-v3 (Ponder) documents. Keeping them here is what lets
 * `packages/sdk` hold zero GraphQL strings: the documents, their variables and
 * their response shapes are exactly what the entities' `postProcess` functions
 * parse.
 *
 * This adapter is the fallback half of the graphql per-entry routing. It is
 * retired entry by entry as public-api gains the capabilities listed in
 * `capabilities.ts`; the last entry retiring deletes this file.
 *
 * Four entries are unavoidably dynamic — their document depends on the call's
 * arguments — so they are functions rather than constants.
 */

/** Build the response-key -> rows unwrapping the SDK entities expect. */
export type ApiV3Document =
  | { kind: "static"; document: string }
  | { kind: "dynamic"; build: (params: Record<string, any>) => string };

const doc = (document: string): ApiV3Document => ({ kind: "static", document });

/**
 * Placeholder document for an entry api-v3 cannot serve at all.
 *
 * `build` throws, so selecting one of these against `graphqlTarget: 'api-v3'`
 * fails at the point of use with a named reason rather than issuing a
 * malformed query or silently returning nothing. The variables builder
 * refuses first; this is the backstop if a caller reaches the document
 * directly.
 */
export class ApiV3UnsupportedError extends Error {
  override name = "ApiV3UnsupportedError";
  constructor() {
    super(
      "This entry reads chain_v1 Basin projections that api-v3 never had; " +
        "it is only implemented for graphqlTarget: 'public-api'.",
    );
  }
}

const UNSUPPORTED_ON_API_V3: ApiV3Document = {
  kind: "dynamic",
  build: () => {
    throw new ApiV3UnsupportedError();
  },
};

export const API_V3_DOCUMENTS: Record<SdkQueryName, ApiV3Document> = {
  blockchains: doc(`{
        blockchains(limit: 1000) {
          items {
            explorer
            chainId
            centrifugeId
            icon
            name
            network
          }
        }
      }`),

  pools: doc(`{
        pools(limit: 1000) {
          items {
            id
            blockchain {
              id
            }
          }
        }
      }`),

  assetRegistrations: doc(`query ($hubCentId: String!) {
              assetRegistrations(where: { centrifugeId: $hubCentId }, limit: 1000) {
                items {
                  assetId
                  asset {
                    centrifugeId
                    address
                    name
                    symbol
                    decimals
                    assetTokenId
                  }
                }
              }
            }`),

  deployments: doc(`{
            blockchains(limit: 1000) {
              items {
                centrifugeId
                id
              }
            }
            deployments(limit: 1000) {
              items {
                centrifugeId
                chainId
              }
            }
          }`),

  tokenInstances: doc(`query ($scId: String!) {
              tokenInstances(where: { tokenId: $scId }) {
                items {
                  totalIssuance
                  tokenPrice
                  address
                  blockchain {
                    centrifugeId
                  }
                }
              }
            }`),

  epochInvestOrders: doc(`query ($scId: String!) {
            epochInvestOrders(where: {tokenId: $scId}, limit: 1000) {
              items {
                assetId
                index
                issuedAt
                issuedAtTxHash
                approvedAt
                approvedAtTxHash
                issuedSharesAmount
                approvedAssetsAmount
                issuedWithNavPoolPerShare
                issuedWithNavAssetPerShare
                asset {
                  decimals
                  symbol
                  name
                  centrifugeId
                }
                token {
                  decimals
                }
              }
            }
          }`),

  // Joined to its epoch by approvedAtTxHash, NOT index: investOrders.index and
  // epochInvestOrders.index use different numbering (instant/sync investments
  // all carry investOrders.index 0 regardless of epoch), so joining on index
  // collapses distinct epochs together.
  closedInvestOrders: doc(`query ($scId: String!, $after: String) {
                    investOrders(where: {
                      tokenId: $scId,
                      issuedAt_not: null
                    }, limit: 1000, after: $after) {
                      pageInfo { hasNextPage endCursor }
                      items {
                        account
                        index
                        assetId
                        approvedAssetsAmount
                        approvedAt
                        approvedAtTxHash
                        issuedSharesAmount
                        issuedAt
                        issuedAtTxHash
                        issuedWithNavAssetPerShare
                        issuedWithNavPoolPerShare
                        claimedAt
                        claimedAtBlock
                        createdAtTxHash
                        asset {
                          id
                          decimals
                          symbol
                          name
                          centrifugeId
                        }
                        token {
                          decimals
                        }
                      }
                    }
                  }`),

  epochRedeemOrders: doc(`query ($filter: EpochRedeemOrderFilter) {
            epochRedeemOrders(where: $filter, limit: 1000) {
              items {
                assetId
                index
                revokedAt
                approvedAt
                approvedSharesAmount
                revokedSharesAmount
                revokedAssetsAmount
                revokedWithNavPoolPerShare
                revokedWithNavAssetPerShare
                asset {
                  decimals
                  symbol
                  name
                  centrifugeId
                }
                token {
                  decimals
                }
              }
            }
          }`),

  closedRedeemOrders: doc(`query ($filter: RedeemOrderFilter, $after: String) {
                    redeemOrders(where: $filter, limit: 1000, after: $after) {
                      pageInfo { hasNextPage endCursor }
                      items {
                        account
                        index
                        assetId
                        approvedSharesAmount
                        approvedAt
                        revokedAssetsAmount
                        revokedAt
                        revokedWithNavAssetPerShare
                        revokedWithNavPoolPerShare
                        claimedAt
                        claimedAtBlock
                        asset {
                          id
                          decimals
                          symbol
                          name
                          centrifugeId
                        }
                        token {
                          decimals
                        }
                      }
                    }
                  }`),

  redeemOrdersByEpoch: doc(`query ($filter: RedeemOrderFilter) {
                    redeemOrders(where: $filter, limit: 1000) {
                      items {
                        account
                        index
                        assetId
                        approvedSharesAmount
                        approvedAt
                        revokedAssetsAmount
                        revokedAt
                        revokedWithNavAssetPerShare
                        revokedWithNavPoolPerShare
                        claimedAt
                        claimedAtBlock
                        asset {
                          id
                          decimals
                          symbol
                          name
                          centrifugeId
                        }
                        token {
                          decimals
                        }
                      }
                    }
                  }`),

  holdingEscrows: doc(`query ($scId: String!) {
        holdingEscrows(where: { tokenId: $scId }) {
          items {
            holding {
              createdAt
            }
            assetAmount
            assetPrice
            assetId
            centrifugeId
            escrowAddress
            asset {
              decimals
              assetTokenId
              address
              name
              symbol
              blockchain {
                id
                centrifugeId
              }
            }
          }
        }
      }`),

  investOrderState: doc(`query ($scId: String!) {
                epochOutstandingInvests(where: { tokenId: $scId }, limit: 1000) {
                  items {
                    assetId
                    poolId
                    tokenId
                    pendingAssetsAmount
                    createdAtTxHash
                    updatedAtTxHash
                    asset { decimals centrifugeId }
                  }
                }
                epochInvestOrders(where: { tokenId: $scId }, limit: 1000) {
                  items {
                    poolId
                    tokenId
                    assetId
                    index
                    approvedAt
                    approvedAtTxHash
                    approvedAssetsAmount
                    issuedAt
                    issuedAtTxHash
                    issuedSharesAmount
                    token { decimals }
                    asset { decimals centrifugeId }
                  }
                }
                pendingInvestOrders(where: { tokenId: $scId }, limit: 1000) {
                  items {
                    account
                    assetId
                    tokenId
                    queuedAssetsAmount
                    pendingAssetsAmount
                  }
                }
                investOrders(where: { tokenId: $scId, issuedAt: null }, limit: 1000) {
                  items {
                    account
                    assetId
                    tokenId
                    index
                    approvedAt
                    approvedAtTxHash
                    approvedAssetsAmount
                    issuedAt
                    issuedSharesAmount
                    claimedAt
                    claimedSharesAmount
                    createdAtTxHash
                    asset { decimals centrifugeId }
                  }
                }
              }`),

  redeemOrderState: doc(`query ($scId: String!) {
          epochOutstandingRedeems(where: { tokenId: $scId }, limit: 1000) {
            items {
              assetId
              poolId
              tokenId
              pendingSharesAmount
              createdAtTxHash
              updatedAtTxHash
              asset { decimals centrifugeId }
              token { decimals centrifugeId }
            }
          }
          epochRedeemOrders(where: { tokenId: $scId }, limit: 1000) {
            items {
              poolId
              tokenId
              assetId
              index
              approvedAt
              approvedAtTxHash
              approvedSharesAmount
              revokedAt
              revokedAtTxHash
              revokedSharesAmount
              revokedAssetsAmount
              createdAtTxHash
              token { decimals }
              asset { decimals centrifugeId }
            }
          }
          pendingRedeemOrders(where: { tokenId: $scId }, limit: 1000) {
            items {
              account
              assetId
              tokenId
              queuedSharesAmount
              pendingSharesAmount
              createdAtTxHash
              updatedAtTxHash
            }
          }
          redeemOrders(where: { tokenId: $scId, revokedAt: null }, limit: 1000) {
            items {
              account
              assetId
              tokenId
              index
              approvedAt
              approvedSharesAmount
              revokedAt
              revokedSharesAmount
              revokedAssetsAmount
              claimedAt
              claimedAssetsAmount
              asset { decimals centrifugeId }
              token { decimals }
            }
          }
        }`),

  allVaults: doc(`query ($scId: String!) {
          vaults(where: { tokenId: $scId }) {
            items {
              asset {
                id
              }
              address: id
              poolId
              assetAddress
              status
              blockchain {
                centrifugeId
              }
            }
          }
        }`),

  tokenInstancePositions: {
    kind: "dynamic",
    // The holders list builds its `where` from whichever filters the caller
    // supplied; api-v3's operator suffixes make the document itself variable.
    build: (params) => {
      const whereConditions = [
        "tokenId: $scId",
        "accountAddress_not_in: $excludedAddresses",
      ];
      const queryParams = [
        "$scId: String!",
        "$limit: Int!",
        "$offset: Int!",
        "$orderBy: String!",
        "$orderDirection: String!",
        "$excludedAddresses: [String!]!",
      ];
      if (params.balanceGt !== undefined) {
        whereConditions.push("balance_gt: $balance_gt");
        queryParams.push("$balance_gt: BigInt");
      }
      if (params.holderAddress) {
        whereConditions.push("accountAddress_contains: $holderAddress");
        queryParams.push("$holderAddress: String");
      }
      if (params.centrifugeIds) {
        whereConditions.push("centrifugeId_in: $centrifugeIds");
        queryParams.push("$centrifugeIds: [String!]");
      }
      return `query (${queryParams.join(", ")}) {
                tokenInstancePositions(
                  where: { ${whereConditions.join(", ")} }
                  orderBy: $orderBy
                  orderDirection: $orderDirection
                  limit: $limit
                  offset: $offset
                ) {
                  items {
                    accountAddress
                    centrifugeId
                    balance
                    isFrozen
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                  totalCount
                }
                assets(limit: 1000) {
                  items {
                    decimals
                    id
                  }
                }
              }`;
    },
  },

  whitelistedInvestors:
    doc(`query ($tokenId: String!, $limit: Int!, $offset: Int!) {
            whitelistedInvestors(
            where: { tokenId: $tokenId }
              limit: $limit
              offset: $offset
            ) {
              items {
                accountAddress
                centrifugeId
                createdAt
                isFrozen
                validUntil
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
              totalCount
            }
            assets(limit: 1000) {
              items {
                id
                decimals
              }
            }
          }`),

  whitelistedInvestor:
    doc(`query ($accountAddress: String!, $centrifugeId: String!, $tokenId: String!) {
          whitelistedInvestor(
            accountAddress: $accountAddress
            centrifugeId: $centrifugeId
            tokenId: $tokenId
          ) {
            accountAddress
            centrifugeId
            createdAt
            isFrozen
            validUntil
          }
        }`),

  tokenInstancePosition:
    doc(`query ($accountAddress: String!, $centrifugeId: String!, $tokenId: String!) {
            tokenInstancePosition(
              accountAddress: $accountAddress
              centrifugeId: $centrifugeId
              tokenId: $tokenId
            ) {
              accountAddress
              balance
              centrifugeId
              createdAt
              isFrozen
              tokenId
              updatedAt
            }
          }`),

  offRampAddresses: doc(`query ($scId: String!, $centrifugeId: String!) {
              offRampAddresss(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  assetAddress
                  receiverAddress
                  asset {
                    id
                  }
                }
              }
            }`),

  onOffRampRelayers: doc(`query ($scId: String!, $centrifugeId: String!) {
              offrampRelayers(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  address
                  isEnabled
                }
              }
            }`),

  onRampAssets: doc(`query ($scId: String!, $centrifugeId: String!) {
              onRampAssets(where: { centrifugeId: $centrifugeId, tokenId: $scId }) {
                items {
                  assetAddress
                  asset {
                    id
                  }
                }
              }
            }`),

  investorPortfolioSources: doc(`{
            vaults(limit: 1000) {
              items {
                assetAddress
                centrifugeId
              }
            }
            tokenInstances(limit: 1000) {
              items {
                address
                centrifugeId
              }
            }
          }`),

  // `$filter` is one `InvestorTransactionFilter` variable (the naming Ponder
  // already uses for this shape elsewhere in this file — `RedeemOrderFilter`,
  // `EpochRedeemOrderFilter`, `TokenSnapshotFilter`), not per-field scalar
  // variables: `API_V3_VARIABLES` below only puts `tokenId`/`type` on it when
  // the caller passed one, and an object key that is simply ABSENT from the
  // built filter is not the same thing as passing `null` for it — which is
  // the only way an optional equality field can be added here without
  // guessing at whatever a `null`-valued field means on the live api-v3.
  investorTransactions:
    doc(`query ($filter: InvestorTransactionFilter!, $limit: Int!, $offset: Int!) {
            investorTransactions(
              where: $filter
              orderBy: "createdAt"
              orderDirection: "desc"
              limit: $limit
              offset: $offset
            ) {
              items {
                account
                createdAt
                type
                txHash
                currencyAmount
                currencyAsset {
                  decimals
                  symbol
                  id
                  address
                }
                token { name symbol decimals }
                tokenAmount
                tokenPrice
                centrifugeId
                poolId
              }
              totalCount
            }
          }`),

  poolAdapters:
    doc(`query ($poolId: BigInt!, $local: String!, $remote: String!) {
            poolAdapters(where: { poolId: $poolId, localCentrifugeId: $local, remoteCentrifugeId: $remote }) {
              items {
                adapterAddress
                isEnabled
                crosschainInProgress
                adapter {
                  name
                }
              }
            }
          }`),

  poolManagers: doc(`query ($poolId: BigInt!) {
            poolManagers(where: { poolId: $poolId }) {
              items {
                isHubManager
                isBalancesheetManager
                crosschainInProgress
                address
                centrifugeId
                poolId
              }
            }
          }`),

  merkleProofManagers: doc(`query ($poolId: BigInt!, $centrifugeId: String!) {
        merkleProofManagers(where: {poolId: $poolId, centrifugeId: $centrifugeId}) {
          items {
            address
          }
        }
      }`),

  onOffRampManagers: doc(`query ($scId: String!, $centrifugeId: String!) {
        onOffRampManagers(where: {tokenId: $scId, centrifugeId: $centrifugeId}) {
          items {
            address
            createdAtBlock
          }
        }
      }`),

  crosschainMessages: {
    kind: "dynamic",
    build: (params) => buildCrosschainPayloadsDocument(params.include ?? {}),
  },

  crosschainMessage: {
    kind: "dynamic",
    build: (params) => buildCrosschainPayloadDocument(params.include ?? {}),
  },

  sharePricesReport: doc(`query ($filter: TokenInstanceSnapshotFilter) {
									tokenInstanceSnapshots(
										where: $filter
										orderBy: "timestamp"
										orderDirection: "desc"
										limit: 1000
									) {
										items {
											tokenId
											timestamp
											totalIssuance
											tokenPrice
											triggerChainId
										}
									}
								}`),

  hubSharePricesReport:
    doc(`query ($filter: TokenSnapshotFilter, $limit: Int!) {
									tokenSnapshots(
										where: $filter
										orderBy: "timestamp"
										orderDirection: "desc"
										limit: $limit
									) {
										items {
											id
											timestamp
											tokenPrice
											totalIssuance
											trigger
										}
									}
								}`),

  shareYieldsReport: {
    kind: "dynamic",
    build: (params) => buildShareYieldsDocument(params.yieldFields ?? []),
  },

  // Basin (backend#629). These five are `public-api`-only: the Grove/Basin
  // tables are a `chain_v1` projection that api-v3 never had, so there is no
  // document to port and no shape to guess. The variables builder below
  // refuses them; these placeholders exist only because every catalogue entry
  // needs a map slot.
  basinDebt: UNSUPPORTED_ON_API_V3,
  basinDebtChanges: UNSUPPORTED_ON_API_V3,
  basinFees: UNSUPPORTED_ON_API_V3,
  basinSwaps: UNSUPPORTED_ON_API_V3,
  basinRedeemRequests: UNSUPPORTED_ON_API_V3,
  // Migration (backend#600): the v3.3 migration tables are a `chain_v1`
  // projection api-v3 never had.
  poolMigration: UNSUPPORTED_ON_API_V3,
  poolMigrationSteps: UNSUPPORTED_ON_API_V3,
  shareManagerCalls: UNSUPPORTED_ON_API_V3,
  crosschainMessageRows: UNSUPPORTED_ON_API_V3,
  poolAuthorizationEvents: UNSUPPORTED_ON_API_V3,
  hubPolicies: UNSUPPORTED_ON_API_V3,
};

/**
 * Catalogue params -> api-v3 document variables.
 *
 * The catalogue names params after the domain (`tokenId`, `centrifugeId`);
 * the api-v3 documents use their historical variable names (`$scId`,
 * `$hubCentId`, `$filter`). This is the only place that mapping lives.
 */
export const API_V3_VARIABLES: Record<
  SdkQueryName,
  (params: any) => Record<string, unknown>
> = {
  blockchains: () => ({}),
  pools: () => ({}),
  assetRegistrations: (p) => ({ hubCentId: p.centrifugeId }),
  deployments: () => ({}),
  tokenInstances: (p) => ({ scId: p.tokenId }),
  epochInvestOrders: (p) => ({ scId: p.tokenId }),
  closedInvestOrders: (p) => ({ scId: p.tokenId }),
  epochRedeemOrders: (p) => ({
    filter: {
      tokenId: p.tokenId,
      ...(p.assetId !== undefined ? { assetId: p.assetId } : {}),
      ...(p.index !== undefined ? { index: p.index } : {}),
    },
  }),
  closedRedeemOrders: (p) => ({
    filter: { tokenId: p.tokenId, revokedAt_not: null },
  }),
  redeemOrdersByEpoch: (p) => ({
    filter: {
      tokenId: p.tokenId,
      assetId: p.assetId,
      index: p.index,
      revokedAt_not: null,
      ...(p.onlyUnclaimed ? { claimedAt: null } : {}),
    },
  }),
  holdingEscrows: (p) => ({ scId: p.tokenId }),
  investOrderState: (p) => ({ scId: p.tokenId }),
  redeemOrderState: (p) => ({ scId: p.tokenId }),
  allVaults: (p) => ({ scId: p.tokenId }),
  tokenInstancePositions: (p) => ({
    scId: p.tokenId,
    limit: p.limit,
    offset: p.offset,
    orderBy: p.orderBy,
    orderDirection: p.orderDirection,
    excludedAddresses: p.excludedAddresses,
    ...(p.balanceGt !== undefined ? { balance_gt: p.balanceGt } : {}),
    ...(p.holderAddress ? { holderAddress: p.holderAddress } : {}),
    ...(p.centrifugeIds ? { centrifugeIds: p.centrifugeIds } : {}),
  }),
  whitelistedInvestors: (p) => ({
    tokenId: p.tokenId,
    limit: p.limit,
    offset: p.offset,
  }),
  whitelistedInvestor: (p) => ({
    accountAddress: p.accountAddress,
    centrifugeId: p.centrifugeId,
    tokenId: p.tokenId,
  }),
  tokenInstancePosition: (p) => ({
    accountAddress: p.accountAddress,
    centrifugeId: p.centrifugeId,
    tokenId: p.tokenId,
  }),
  offRampAddresses: (p) => ({ scId: p.tokenId, centrifugeId: p.centrifugeId }),
  onOffRampRelayers: (p) => ({ scId: p.tokenId, centrifugeId: p.centrifugeId }),
  onRampAssets: (p) => ({ scId: p.tokenId, centrifugeId: p.centrifugeId }),
  investorPortfolioSources: () => ({}),
  investorTransactions: (p) => {
    if (p.createdAtAfter !== undefined || p.createdAtBefore !== undefined) {
      // `public-api`-only, deliberately: see the catalogue entry's doc
      // comment. Guessing api-v3's comparison-operator suffix for this
      // column (`createdAt_gt`?) and its inclusive/exclusive semantics would
      // risk silently returning the wrong rows, which this adapter throws
      // rather than does.
      throw new Error(
        "investorTransactions' createdAtAfter/createdAtBefore filter is " +
          "only implemented for graphqlTarget: 'public-api'. api-v3's " +
          "Ponder comparison-operator support for investor_transaction." +
          "created_at is not verified from this repo, so it is refused " +
          "here rather than guessed at.",
      );
    }
    return {
      filter: {
        account: p.account,
        poolId: p.poolId,
        ...(p.tokenId !== undefined ? { tokenId: p.tokenId } : {}),
        ...(p.type !== undefined ? { type: p.type } : {}),
      },
      limit: p.limit,
      offset: p.offset,
    };
  },
  poolAdapters: (p) => ({
    poolId: p.poolId,
    local: p.localCentrifugeId,
    remote: p.remoteCentrifugeId,
  }),
  poolManagers: (p) => ({ poolId: p.poolId }),
  merkleProofManagers: (p) => ({
    poolId: p.poolId,
    centrifugeId: p.centrifugeId,
  }),
  onOffRampManagers: (p) => ({ scId: p.tokenId, centrifugeId: p.centrifugeId }),
  crosschainMessages: (p) => ({
    filter: p.filter,
    limit: p.limit,
    before: p.before,
    after: p.after,
  }),
  crosschainMessage: (p) => ({ id: p.id, index: p.index }),
  sharePricesReport: (p) => ({
    filter: { tokenId_in: p.tokenIds, trigger_ends_with: "NewPeriod" },
  }),
  hubSharePricesReport: (p) => {
    if (p.from !== undefined || p.to !== undefined) {
      throw new Error(
        "hubSharePricesReport's from/to filter is only implemented for " +
          "graphqlTarget: 'public-api'; api-v3's inclusive-bound spelling on " +
          "token_snapshot.timestamp is not verified against the live deployment.",
      );
    }
    return {
      filter: { id_in: p.tokenIds, trigger_ends_with: "NewPeriod" },
      limit: p.limit,
    };
  },
  shareYieldsReport: (p) => {
    if (p.from !== undefined || p.to !== undefined) {
      // `public-api`-only, deliberately: see the catalogue entry's doc
      // comment. `sharePriceSnapshots`/`shareYieldSnapshots` on the sibling
      // backend catalogue bound `timestamp` the same inclusive way, but that
      // is a direct SQL read (`queries/sql`), not evidence of api-v3's
      // Ponder operator spelling for this column.
      throw new Error(
        "shareYieldsReport's from/to filter is only implemented for " +
          "graphqlTarget: 'public-api'. api-v3's Ponder comparison-operator " +
          "support for token_snapshot.timestamp is not verified from this " +
          "repo, so it is refused here rather than guessed at.",
      );
    }
    return { filter: { id_in: p.tokenIds } };
  },
  poolMigration: () => {
    throw new Error(
      "poolMigration reads the chain_v1 v3.3 migration projection that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  poolMigrationSteps: () => {
    throw new Error(
      "poolMigrationSteps reads the chain_v1 v3.3 migration projection that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  poolAuthorizationEvents: () => {
    throw new Error(
      "poolAuthorizationEvents reads the chain_v1 v3.3 policy and authorization log that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  hubPolicies: () => {
    throw new Error(
      "hubPolicies reads the chain_v1 v3.3 hub policy projection that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  shareManagerCalls: () => {
    throw new Error(
      "shareManagerCalls reads the chain_v1 manager_call projection that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  crosschainMessageRows: () => {
    throw new Error(
      "crosschainMessageRows reads chain_v1 crosschain_message rows by message id, " +
        "which api-v3 cannot filter on. It is only implemented for graphqlTarget: " +
        "'public-api'; there is no api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  basinDebt: () => {
    throw new Error(
      "basinDebt reads chain_v1 Basin projections that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  basinDebtChanges: () => {
    throw new Error(
      "basinDebtChanges reads chain_v1 Basin projections that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  basinFees: () => {
    throw new Error(
      "basinFees reads chain_v1 Basin projections that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  basinSwaps: () => {
    throw new Error(
      "basinSwaps reads chain_v1 Basin projections that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
  basinRedeemRequests: () => {
    throw new Error(
      "basinRedeemRequests reads chain_v1 Basin projections that api-v3 never had. " +
        "It is only implemented for graphqlTarget: 'public-api'; there is no " +
        "api-v3 shape to fall back to, so it is refused rather than guessed.",
    );
  },
};

/**
 * api-v3 response envelope -> catalogue result.
 *
 * The catalogue contract is the plain domain shape (an array, a page, a
 * single row); api-v3 wraps collections in `{ items }`. Unwrapping here keeps
 * that envelope out of the contract so the public-api adapter does not have
 * to fabricate it.
 */
export const API_V3_UNWRAP: Record<SdkQueryName, (data: any) => unknown> = {
  blockchains: (d) => d.blockchains.items,
  pools: (d) =>
    d.pools.items.map((item: any) => ({
      id: item.id,
      protocolVersion: null,
      migrationStatus: null,
    })),
  assetRegistrations: (d) => d.assetRegistrations.items,
  deployments: (d) =>
    d.deployments.items.map((item: any) => ({
      centrifugeId: String(item.centrifugeId),
      chainId: String(item.chainId),
      protocolVersion: null,
    })),
  tokenInstances: (d) =>
    d.tokenInstances.items.map((item: any) => ({
      totalIssuance: item.totalIssuance,
      tokenPrice: item.tokenPrice,
      address: item.address,
      centrifugeId: item.blockchain.centrifugeId,
    })),
  epochInvestOrders: (d) => d.epochInvestOrders.items,
  closedInvestOrders: (d) => d.investOrders.items,
  epochRedeemOrders: (d) => d.epochRedeemOrders.items,
  closedRedeemOrders: (d) => d.redeemOrders.items,
  redeemOrdersByEpoch: (d) => d.redeemOrders.items,
  holdingEscrows: (d) => d.holdingEscrows.items,
  investOrderState: (d) => ({
    epochOutstandingInvests: d.epochOutstandingInvests.items,
    epochInvestOrders: d.epochInvestOrders.items,
    pendingInvestOrders: d.pendingInvestOrders.items,
    investOrders: d.investOrders.items,
  }),
  redeemOrderState: (d) => ({
    epochOutstandingRedeems: d.epochOutstandingRedeems.items,
    epochRedeemOrders: d.epochRedeemOrders.items,
    pendingRedeemOrders: d.pendingRedeemOrders.items,
    redeemOrders: d.redeemOrders.items,
  }),
  allVaults: (d) =>
    d.vaults.items.map((item: any) => ({
      address: item.address,
      poolId: item.poolId,
      assetAddress: item.assetAddress,
      status: item.status,
      asset: item.asset,
      centrifugeId: item.blockchain.centrifugeId,
    })),
  // Neither page shape declares `pageInfo` or the piggy-backed `assets`
  // lookup (see `WhitelistedInvestorsPage`), so the extra selections in the
  // documents above are simply not read. They stay in the documents because
  // this adapter's contract is that its DOCUMENTS match what api-v3 answers;
  // it is the entry's result type that narrows, and both
  // adapters must now agree on.
  tokenInstancePositions: (d) => ({
    items: d.tokenInstancePositions.items,
    totalCount: d.tokenInstancePositions.totalCount,
  }),
  // Narrowed to LIVE entries, as public-api's resolver is and as the
  // backend's `?status=whitelisted` is. api-v3 has no `validUntil_gt` either
  // (its `where` is built in `apiV3Document` from a fixed set of keys), so the
  // filter runs here over the requested page — which is the one difference
  // from the public-api path, where the whole bounded set is read first. It is
  // stated rather than hidden: on this target a page can come back short.
  whitelistedInvestors: (d) => {
    const live = d.whitelistedInvestors.items
      .map((item: any) => ({
        ...item,
        isWhitelisted: isWhitelistedAt(item.validUntil),
      }))
      .filter((item: any) => item.isWhitelisted);
    return { items: live, totalCount: live.length };
  },
  whitelistedInvestor: (d) =>
    d.whitelistedInvestor
      ? {
          ...d.whitelistedInvestor,
          isWhitelisted: isWhitelistedAt(d.whitelistedInvestor.validUntil),
        }
      : d.whitelistedInvestor,
  tokenInstancePosition: (d) => d.tokenInstancePosition,
  offRampAddresses: (d) => d.offRampAddresss.items,
  onOffRampRelayers: (d) => d.offrampRelayers.items,
  onRampAssets: (d) => d.onRampAssets.items,
  investorPortfolioSources: (d) => ({
    vaults: d.vaults.items,
    tokenInstances: d.tokenInstances.items,
  }),
  investorTransactions: (d) => ({
    items: d.investorTransactions.items,
    totalCount: d.investorTransactions.totalCount,
  }),
  poolAdapters: (d) => d.poolAdapters.items,
  poolManagers: (d) => d.poolManagers.items,
  merkleProofManagers: (d) => d.merkleProofManagers.items,
  onOffRampManagers: (d) => d.onOffRampManagers.items,
  // Payload reads keep their envelope: the SDK's mapper consumes the page
  // (items/totalCount/pageInfo) and the single-payload shapes directly.
  crosschainMessages: (d) => d.crosschainPayloads,
  crosschainMessage: (d) => d.crosschainPayload,
  sharePricesReport: (d) => d,
  hubSharePricesReport: (d) => d,
  shareYieldsReport: (d) => d,
  basinDebt: (d) => d,
  basinDebtChanges: (d) => d,
  basinFees: (d) => d,
  basinSwaps: (d) => d,
  basinRedeemRequests: (d) => d,
  poolMigration: (d) => d,
  poolMigrationSteps: (d) => d,
  shareManagerCalls: (d) => d,
  crosschainMessageRows: (d) => d,
  poolAuthorizationEvents: (d) => d,
  hubPolicies: (d) => d,
};

/** Resolve an entry's document for a call's params. */
export function apiV3Document(
  name: SdkQueryName,
  params: Record<string, any>,
): string {
  const entry = API_V3_DOCUMENTS[name];
  return entry.kind === "static" ? entry.document : entry.build(params);
}

/**
 * Entries whose document asks for a whole set, keyed to the collection the
 * adapter pages through `after` until `pageInfo.hasNextPage` is false.
 */
export const API_V3_PAGED: Partial<Record<SdkQueryName, string>> = {
  closedInvestOrders: "investOrders",
  closedRedeemOrders: "redeemOrders",
};

// Selection fragments, moved verbatim from `entities/crosschainMessages.ts`.
const BLOCKCHAIN_FRAGMENT = `{ id centrifugeId network }`;
const POOL_FRAGMENT = `{ id name }`;
const TOKEN_FRAGMENT = `{ name symbol }`;
const INNER_MESSAGE_FRAGMENT = `{
  items {
    id
    index
    poolId
    tokenId
    payloadId
    payloadIndex
    fromCentrifugeId
    toCentrifugeId
    messageType
    status
    rawData
    data
    failReason
    createdAt
    executedAt
    executedAtTxHash
  }
}`;
const ADAPTER_PARTICIPATIONS_FRAGMENT = `(orderBy: "timestamp", orderDirection: "asc") {
  items {
    centrifugeId
    fromCentrifugeId
    toCentrifugeId
    type
    side
    gasPaid
    timestamp
    transactionHash
    adapter { address name centrifugeId }
  }
}`;

const PAYLOAD_BASE_FIELDS = `
  id
  index
  poolId
  tokenId
  fromCentrifugeId
  toCentrifugeId
  status
  rawData
  gasLimit
  gasPrice
  createdAt
  deliveredAt
  completedAt
  createdAtTxHash
  deliveredAtTxHash
`;

/** Payload field selection, widened by whichever `include` flags are set. */
function payloadSelection(include: Record<string, boolean>): string {
  const parts = [PAYLOAD_BASE_FIELDS];
  if (include.pool) {
    parts.push(`pool ${POOL_FRAGMENT}`);
  }
  if (include.token) {
    parts.push(`token ${TOKEN_FRAGMENT}`);
  }
  if (include.blockchains) {
    parts.push(
      `fromBlockchain ${BLOCKCHAIN_FRAGMENT}`,
      `toBlockchain ${BLOCKCHAIN_FRAGMENT}`,
    );
  }
  if (include.innerMessages) {
    parts.push(`crosschainMessages ${INNER_MESSAGE_FRAGMENT}`);
  }
  if (include.adapterParticipations) {
    parts.push(`adapterParticipations${ADAPTER_PARTICIPATIONS_FRAGMENT}`);
  }
  return parts.join("\n      ");
}

/**
 * The crosschain payload page document. The caller opts into nested sub-trees
 * (`include`), so the selection set is assembled per call. The shape is what
 * `entities/crosschainMessages.ts` parses.
 */
function buildCrosschainPayloadsDocument(
  include: Record<string, boolean>,
): string {
  return `query ($filter: CrosschainPayloadFilter, $limit: Int!, $before: String, $after: String) {
          crosschainPayloads(
            where: $filter
            orderBy: "createdAt"
            orderDirection: "desc"
            limit: $limit
            before: $before
            after: $after
          ) {
            totalCount
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            items {
              ${payloadSelection(include)}
            }
          }
        }`;
}

function buildCrosschainPayloadDocument(
  include: Record<string, boolean>,
): string {
  return `query ($id: String!, $index: Float!) {
          crosschainPayload(id: $id, index: $index) {
            ${payloadSelection(include)}
          }
        }`;
}

/**
 * The share-yields document interpolates the caller's yield-field list into
 * the selection set.
 */
function buildShareYieldsDocument(yieldFields: readonly string[]): string {
  return `query ($filter: TokenSnapshotFilter) {
                  tokenSnapshots(
                    where: $filter
                    orderBy: "timestamp"
                    orderDirection: "desc"
                    limit: 1000
                  ) {
                    items {
                      id
                      timestamp
                      ${yieldFields.join("\n                      ")}
                    }
                  }
                }`;
}
