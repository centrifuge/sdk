import { describe, expect, it } from "vitest";
import { PUBLIC_API_RESOLVERS } from "./public-api";

const CTX = { entry: "tokenInstancePositions", dimensionCap: 1000 };
const TOKEN_ID = "0x00010000000000070000000000000001";

function params(overrides: Record<string, unknown> = {}) {
  return {
    tokenId: TOKEN_ID,
    excludedAddresses: [],
    orderBy: "balance",
    orderDirection: "desc",
    limit: 10,
    offset: 0,
    ...overrides,
  };
}

/** An executor that records each call's variables and answers with no positions. */
function recordingExec(calls: Array<Record<string, any>>) {
  return async (_document: string, variables?: Record<string, any>) => {
    calls.push(variables ?? {});
    return { tokenInstancePositions: { totalCount: 0, nodes: [] } };
  };
}

describe("public-api tokenInstancePositions", () => {
  it("asks for investor positions only, so escrows and vaults stay out of holders lists and the migration pre-check", async () => {
    const calls: Array<Record<string, any>> = [];

    await PUBLIC_API_RESOLVERS.tokenInstancePositions!(
      recordingExec(calls),
      params(),
      CTX,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.filter).toMatchObject({
      tokenId: { equalTo: TOKEN_ID },
      holderKind: { equalTo: "INVESTOR" },
    });
  });
});
