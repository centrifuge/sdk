import { describe, expect, it } from "vitest";
import { BuilderArgumentMismatchError } from "../errors";
import {
  allowedActionsIn,
  gateVerdict,
  isAllowed,
  isBridgeAllowed,
  MIGRATION_ACTION,
  MIGRATION_ACTIONS,
  POOL_MIGRATING,
} from "./gate";
import { SPOKE_GATE_STATE, SPOKE_GATE_STATES } from "./gate-state";

const TABLE_FROM_APP_GATE_MODEL_12 = `
investorRequest      A R C C R A
investorCancel       A R C C R A
syncDeposit          A R C C C A
investorClaim        A A R C C A
bridgeOut            A A C C C A
bridgeOut@hub        A R R R R A
bridgeToward         A A R R R A
settlement           A A R C R A
notify               A A R R R A
hubPrice             A A A C A A
investorRestriction  A A A C A A
spokeConfiguration   R R R C R A
bridgerGrant         - - - - R A
poolConfiguration    - - - - A A
shareTransfer        A A A A A A
`;

describe("isAllowed follows app-gate-model section 12", () => {
  const rows = TABLE_FROM_APP_GATE_MODEL_12.trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));

  it("covers every action once, plus the hub-chain bridge row", () => {
    const names = rows.map(([name]) => name!.replace("@hub", ""));
    expect([...new Set(names)].sort()).toEqual([...MIGRATION_ACTIONS].sort());
    expect(rows).toHaveLength(MIGRATION_ACTIONS.length + 1);
  });

  for (const [name, ...cells] of rows) {
    it(`row ${name}`, () => {
      const action = name!.replace(
        "@hub",
        "",
      ) as (typeof MIGRATION_ACTIONS)[number];
      const options = { spokeIsHubChain: name!.endsWith("@hub") };
      SPOKE_GATE_STATES.forEach((state, i) => {
        expect(gateVerdict(state, action, options), `${name} ${state}`).toBe(
          cells[i],
        );
        const answer = isAllowed(state, action, options);
        expect(answer.allowed, `${name} ${state}`).toBe(cells[i] === "A");
      });
    });
  }

  it("answers allowed for a pool with no migration", () => {
    expect(isAllowed(null, MIGRATION_ACTION.investorRequest)).toEqual({
      allowed: true,
    });
  });

  it("names the state, the verdict and what is still allowed on a refusal", () => {
    const answer = isAllowed(
      SPOKE_GATE_STATE.freezeSent,
      MIGRATION_ACTION.investorRequest,
    );
    expect(answer).toMatchObject({
      allowed: false,
      code: POOL_MIGRATING,
      state: "P2",
      action: "investorRequest",
      verdict: "R",
    });
    expect(allowedActionsIn(SPOKE_GATE_STATE.freezeSent)).toEqual([
      "investorClaim",
      "bridgeToward",
      "settlement",
      "notify",
      "hubPrice",
      "investorRestriction",
      "shareTransfer",
    ]);
    expect(
      allowedActionsIn(SPOKE_GATE_STATE.freezeSent, { spokeIsHubChain: false }),
    ).toContain("bridgeOut");
    expect(
      allowedActionsIn(SPOKE_GATE_STATE.freezeSent, { spokeIsHubChain: true }),
    ).not.toContain("bridgeOut");
    expect(() =>
      isAllowed(SPOKE_GATE_STATE.freezeSent, MIGRATION_ACTION.bridgeOut),
    ).toThrow(BuilderArgumentMismatchError);
    for (const notAnAction of ["approveDeposits", "bridgeOutHubChain", ""]) {
      expect(() =>
        isAllowed(
          SPOKE_GATE_STATE.freezeSent,
          notAnAction as (typeof MIGRATION_ACTIONS)[number],
        ),
      ).toThrow(BuilderArgumentMismatchError);
    }
    expect(allowedActionsIn(SPOKE_GATE_STATE.offboardSent)).toEqual([
      "hubPrice",
      "investorRestriction",
      "shareTransfer",
    ]);
    expect(allowedActionsIn(SPOKE_GATE_STATE.hubOnboarded)).toEqual([
      "shareTransfer",
    ]);
    expect(allowedActionsIn(SPOKE_GATE_STATE.live)).toEqual(
      MIGRATION_ACTIONS.filter((a) => a !== "bridgeOut"),
    );
    expect(
      allowedActionsIn(SPOKE_GATE_STATE.live, { spokeIsHubChain: true }),
    ).toEqual(MIGRATION_ACTIONS);
  });

  it("gates a bridge on both ends", () => {
    expect(
      isBridgeAllowed(
        { state: SPOKE_GATE_STATE.freezeSent, isHubChain: false },
        { state: SPOKE_GATE_STATE.started },
      ),
    ).toEqual({ allowed: true });
    expect(
      isBridgeAllowed(
        { state: SPOKE_GATE_STATE.freezeSent, isHubChain: true },
        { state: SPOKE_GATE_STATE.started },
      ),
    ).toMatchObject({ allowed: false, action: "bridgeOut", state: "P2" });
    expect(
      isBridgeAllowed(
        { state: SPOKE_GATE_STATE.started, isHubChain: false },
        { state: SPOKE_GATE_STATE.offboardSent },
      ),
    ).toMatchObject({ allowed: false, action: "bridgeToward", state: "P3" });
    expect(
      isBridgeAllowed({ state: null }, { state: SPOKE_GATE_STATE.live }),
    ).toEqual({ allowed: true });
  });
});
