import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { ABIS_V3_2 } from "../abis/v3_2";
import { resolveProtocolContext } from "../context";
import { BuilderArgumentMismatchError } from "../errors";
import { MessageType } from "../messages";
import { PROTOCOL_VERSION_V3_2, type ProtocolContext } from "../types";
import {
  addressToBytes32,
  approveDeposits,
  approveRedeems,
  builders,
  centrifugeIdFromAssetId,
  issueShares,
  issueSharesDirect,
  revokeShares,
  revokeSharesDirect,
} from "./index";

/** Pool 1 on centrifugeId 1 (Ethereum mainnet in the bundled registry). */
const POOL_ID = "281474976710657";
const OTHER_POOL_ID = "281474976710658";
/** Share class 1 of pool 1: `poolId << 64 | 1`. */
const SC_ID = `0x${((BigInt(POOL_ID) << 64n) + 1n).toString(16).padStart(32, "0")}`;
/** An asset on centrifugeId 2 — a REMOTE route from pool 1's hub. */
const REMOTE_ASSET = ((2n << 112n) + 1n).toString();
/** A second remote asset, on centrifugeId 3. */
const OTHER_REMOTE_ASSET = ((3n << 112n) + 5n).toString();
/** An asset on centrifugeId 1 — LOCAL to pool 1's hub, so no bridge fee. */
const LOCAL_ASSET = ((1n << 112n) + 7n).toString();
/** A national currency: `centrifugeId == 0`, which is not a network at all. */
const NATIONAL_CURRENCY_ASSET = "840";

const REFUND = "0x6Bcb240d3e1f1C4321ECAFFDacB45691DC03bE5D";
const INVESTOR = "0x1231231231231231231231231231231231231231";
const OTHER_INVESTOR = "0x4564564564564564564564564564564564564564";
const CUSTODIAN = "0x7897897897897897897897897897897897897897";

/** `D18` 1.0 — a legal, non-zero price. */
const PRICE = "1000000000000000000";

function hubContext(): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
  });
}

function spokeContext(centrifugeId = 2): ProtocolContext {
  return resolveProtocolContext(POOL_ID, PROTOCOL_VERSION_V3_2, {
    environment: "mainnet",
    centrifugeId,
  });
}

/** Decode one inner call against the `BatchRequestManager` ABI. */
function decodeManagerCall(data: `0x${string}`) {
  return decodeFunctionData({
    abi: ABIS_V3_2.BatchRequestManager,
    data,
  });
}

/** Decode one inner call against the `BalanceSheet` ABI. */
function decodeBalanceSheetCall(data: `0x${string}`) {
  return decodeFunctionData({ abi: ABIS_V3_2.BalanceSheet, data });
}

describe("centrifugeIdFromAssetId", () => {
  it("reads the centrifugeId out of the asset id's high 16 bits", () => {
    // The SDK's `AssetId.centrifugeId` is `Number(id >> 112n)`; this mirrors it
    // so the backend never needs a projection read to know which spoke an
    // asset's callback is addressed to.
    expect(centrifugeIdFromAssetId(REMOTE_ASSET)).toBe(2);
    expect(centrifugeIdFromAssetId(OTHER_REMOTE_ASSET)).toBe(3);
    expect(centrifugeIdFromAssetId(LOCAL_ASSET)).toBe(1);
  });

  it("reports a national currency as centrifugeId 0", () => {
    // `AssetId.isNationalCurrency` is exactly this: an ISO code occupies only
    // the low bits, so nothing is in the network field.
    expect(centrifugeIdFromAssetId(NATIONAL_CURRENCY_ASSET)).toBe(0);
  });
});

describe("addressToBytes32", () => {
  it("RIGHT-pads, matching CastLib.toBytes32 and not the EVM word convention", () => {
    // Pinned as a literal rather than computed, and pinned against the
    // CONTRACT's convention rather than against this function's own output —
    // a fixture generated from the encoder would agree with a wrong encoder.
    // `CastLib.toBytes32(address)` is `bytes32(bytes20(addr))`, which puts the
    // address in the LEADING 20 bytes and zero-fills the TRAILING 12.
    expect(addressToBytes32(INVESTOR, "test")).toBe(
      "0x1231231231231231231231231231231231231231000000000000000000000000",
    );
  });

  it("satisfies the property CastLib.toAddress asserts on chain", () => {
    const encoded = addressToBytes32(INVESTOR, "test");

    // `CastLib.toAddress` is `address(bytes20(addr))` guarded by
    // `require(uint96(uint256(addr)) == 0, PrefixNotZero())` — i.e. the LOW 12
    // bytes must be zero and the address is the LEADING 20. Both halves are
    // asserted here, because getting the direction backwards produces a
    // bytes32 that is still well-formed and still 32 bytes: the failure is a
    // silent `NoOrderFound()` revert, not a type error.
    expect(BigInt(encoded) & ((1n << 96n) - 1n)).toBe(0n);
    expect(`0x${encoded.slice(2, 42)}`).toBe(INVESTOR.toLowerCase());

    // And the left-padded spelling is a DIFFERENT word — the thing that would
    // key an empty UserOrder.
    const leftPadded = `0x${INVESTOR.slice(2).padStart(64, "0")}`;
    expect(encoded).not.toBe(leftPadded);
  });

  it("lowercases so one investor cannot produce two spellings of one call", () => {
    expect(
      addressToBytes32(INVESTOR.toUpperCase().replace("0X", "0x"), "t"),
    ).toBe(addressToBytes32(INVESTOR.toLowerCase(), "t"));
  });

  it("refuses anything that is not an address rather than padding it", () => {
    expect(() => addressToBytes32("0x1234", "test")).toThrow(
      BuilderArgumentMismatchError,
    );
  });
});

describe("approveDeposits", () => {
  it("encodes one BatchRequestManager.approveDeposits per asset", () => {
    const ctx = hubContext();

    const built = approveDeposits(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "3",
          approvedAssetAmount: "1000000",
          pricePoolPerAsset: PRICE,
        },
      ],
      refundAddress: REFUND,
    });

    // The target is BatchRequestManager, NOT the Hub: these four functions
    // moved there in centrifuge-v3 `2add77913`.
    expect(built.to).toBe(ctx.addresses.batchRequestManager);
    expect(built.calls).toHaveLength(1);

    const decoded = decodeManagerCall(built.calls![0]!.data);
    expect(decoded.functionName).toBe("approveDeposits");
    expect(decoded.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      BigInt(REMOTE_ASSET),
      3,
      1000000n,
      BigInt(PRICE),
      REFUND,
    ]);
  });

  it("declares one RequestCallback per asset, keyed by the ASSET's network", () => {
    const built = approveDeposits(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "1",
          approvedAssetAmount: "1",
          pricePoolPerAsset: PRICE,
        },
        {
          assetId: OTHER_REMOTE_ASSET,
          epochId: "1",
          approvedAssetAmount: "2",
          pricePoolPerAsset: PRICE,
        },
      ],
      refundAddress: REFUND,
    });

    // Keyed by DESTINATION because the fee is charged per route: two assets on
    // two spokes are two estimates, not one doubled.
    expect(built.messages).toEqual({
      2: [{ type: MessageType.RequestCallback, poolId: POOL_ID }],
      3: [{ type: MessageType.RequestCallback, poolId: POOL_ID }],
    });
    expect(built.value).toBe(0n);
  });

  it("declares NO message for an asset on the sending chain", () => {
    // `MessageDispatcher.sendRequestCallback` short-circuits a local asset by
    // calling `spoke.requestCallback` directly — no bridge, no fee. Declaring
    // the destination anyway would send `private-api` to `estimateBridgeFee`
    // for a route to itself, which estimates to zero and is REFUSED as
    // `ZeroBridgeFeeError` → 422. That would turn a correct free transaction
    // into a client error.
    const built = approveDeposits(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: LOCAL_ASSET,
          epochId: "1",
          approvedAssetAmount: "1",
          pricePoolPerAsset: PRICE,
        },
      ],
    });

    expect(built.messages).toEqual({});
    expect(built.value).toBe(0n);
  });

  it("declares NO message for a national currency", () => {
    const built = approveDeposits(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: NATIONAL_CURRENCY_ASSET,
          epochId: "1",
          approvedAssetAmount: "1",
          pricePoolPerAsset: PRICE,
        },
      ],
    });

    expect(built.messages).toEqual({});
  });

  it("requires a refundAddress iff a message leaves this chain", () => {
    const remote = {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "1",
          approvedAssetAmount: "1",
          pricePoolPerAsset: PRICE,
        },
      ],
    };
    expect(() => approveDeposits(hubContext(), remote)).toThrow(
      /refundAddress is required/,
    );

    // ...and refuses one when nothing is dispatched, so the argument never
    // suggests there is unspent gas to return when there is not.
    expect(() =>
      approveDeposits(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        approvals: [
          {
            assetId: LOCAL_ASSET,
            epochId: "1",
            approvedAssetAmount: "1",
            pricePoolPerAsset: PRICE,
          },
        ],
        refundAddress: REFUND,
      }),
    ).toThrow(/every named asset lives on the sending chain/);
  });

  it("refuses a repeated asset, an empty list and a foreign pool", () => {
    const approval = {
      assetId: REMOTE_ASSET,
      epochId: "1",
      approvedAssetAmount: "1",
      pricePoolPerAsset: PRICE,
    };

    expect(() =>
      approveDeposits(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        approvals: [approval, { ...approval, epochId: "2" }],
        refundAddress: REFUND,
      }),
    ).toThrow(/names asset .* twice/);

    expect(() =>
      approveDeposits(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        approvals: [],
      }),
    ).toThrow(/is empty/);

    expect(() =>
      approveDeposits(hubContext(), {
        poolId: OTHER_POOL_ID,
        scId: SC_ID,
        approvals: [approval],
        refundAddress: REFUND,
      }),
    ).toThrow(/pool id mismatch/);
  });

  it("refuses a zero amount, a zero price and epoch 0", () => {
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      refundAddress: REFUND,
    };

    expect(() =>
      approveDeposits(hubContext(), {
        ...base,
        approvals: [
          {
            assetId: REMOTE_ASSET,
            epochId: "1",
            approvedAssetAmount: "0",
            pricePoolPerAsset: PRICE,
          },
        ],
      }),
    ).toThrow(/is zero/);

    // A zero `pricePoolPerAsset` makes `_claimDeposit` pay out nothing for a
    // real deposit, and the calldata looks valid either way.
    expect(() =>
      approveDeposits(hubContext(), {
        ...base,
        approvals: [
          {
            assetId: REMOTE_ASSET,
            epochId: "1",
            approvedAssetAmount: "1",
            pricePoolPerAsset: "0",
          },
        ],
      }),
    ).toThrow(/is zero/);

    // Epochs are 1-based (`nowDepositEpoch` is `maxIndex + 1`), so 0 is
    // `EpochNotFound()` on chain — after the signature.
    expect(() =>
      approveDeposits(hubContext(), {
        ...base,
        approvals: [
          {
            assetId: REMOTE_ASSET,
            epochId: "0",
            approvedAssetAmount: "1",
            pricePoolPerAsset: PRICE,
          },
        ],
      }),
    ).toThrow(/epochs are 1-based/);
  });
});

describe("approveRedeems", () => {
  it("encodes the SIX-argument approveRedeems, with no refund argument", () => {
    const ctx = hubContext();

    const built = approveRedeems(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "4",
          approvedShareAmount: "500",
          pricePoolPerAsset: PRICE,
        },
      ],
    });

    const decoded = decodeManagerCall(built.calls![0]!.data);
    expect(decoded.functionName).toBe("approveRedeems");
    // Six args, not seven: `approveRedeems` is the only one of the four with
    // no `refund` parameter, because it dispatches nothing.
    expect(decoded.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      BigInt(REMOTE_ASSET),
      4,
      500n,
      BigInt(PRICE),
    ]);
    expect(decoded.args).toHaveLength(6);
  });

  it("declares an EMPTY manifest even for a REMOTE asset, and zero value", () => {
    // This is the assertion that distinguishes `approveRedeems` from every
    // other order action, and it is a statement about the contract:
    // `BatchRequestManager.approveRedeems` ends at `emit ApproveRedeems(...)`
    // with no `hub.requestCallback` anywhere in its body, and correspondingly
    // has no `refund` parameter. The function IS `payable`, but the contract
    // has no `receive` and no recovery path, so wei sent here is STRANDED.
    // An empty manifest also means `private-api` never calls the estimator for
    // this action, so it can never be refused as `ZeroBridgeFeeError`.
    const built = approveRedeems(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "1",
          approvedShareAmount: "1",
          pricePoolPerAsset: PRICE,
        },
      ],
    });

    expect(built.messages).toEqual({});
    expect(built.value).toBe(0n);
  });

  it("batches several assets through multicall", () => {
    const ctx = hubContext();
    const built = approveRedeems(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      approvals: [
        {
          assetId: REMOTE_ASSET,
          epochId: "1",
          approvedShareAmount: "1",
          pricePoolPerAsset: PRICE,
        },
        {
          assetId: OTHER_REMOTE_ASSET,
          epochId: "2",
          approvedShareAmount: "2",
          pricePoolPerAsset: PRICE,
        },
      ],
    });

    expect(built.calls).toHaveLength(2);
    expect(
      decodeFunctionData({ abi: ABIS_V3_2.Multicall, data: built.data })
        .functionName,
    ).toBe("multicall");
  });
});

describe("issueShares", () => {
  it("encodes one issueShares per epoch of the page, in epoch order", () => {
    const ctx = hubContext();

    const built = issueShares(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      issuances: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "5",
          pricesPoolPerShare: [PRICE, "2000000000000000000"],
        },
      ],
      refundAddress: REFUND,
    });

    expect(built.calls).toHaveLength(2);
    const first = decodeManagerCall(built.calls![0]!.data);
    const second = decodeManagerCall(built.calls![1]!.data);
    expect(first.functionName).toBe("issueShares");
    expect(first.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      BigInt(REMOTE_ASSET),
      5,
      BigInt(PRICE),
      // `extraGasLimit`, hardcoded zero to stay byte-identical to the SDK.
      0n,
      REFUND,
    ]);
    // Epoch 6 gets the SECOND price: each epoch settled against its own NAV.
    expect(second.args?.[3]).toBe(6);
    expect(second.args?.[4]).toBe(2000000000000000000n);
  });

  it("declares one message PER EPOCH, not per asset", () => {
    // This is the whole reason the epoch page is explicit: message count
    // scales with the page size, and a measured live route carries six.
    const built = issueShares(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      issuances: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "1",
          pricesPoolPerShare: [PRICE, PRICE, PRICE],
        },
      ],
      refundAddress: REFUND,
    });

    expect(built.messages?.[2]).toHaveLength(3);
  });

  it("refuses an empty page rather than treating it as 'all epochs'", () => {
    // There is deliberately no "issue everything outstanding" form: that shape
    // would make the message count a function of mutable projection state, so
    // preview and prepare could encode different `data` — which DOES reach
    // dual-channel verification.
    expect(() =>
      issueShares(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        issuances: [
          { assetId: REMOTE_ASSET, fromEpochId: "1", pricesPoolPerShare: [] },
        ],
        refundAddress: REFUND,
      }),
    ).toThrow(/pricesPoolPerShare is empty/);
  });

  it("appends notifyDeposit AFTER every issuance", () => {
    const built = issueShares(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      issuances: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "1",
          pricesPoolPerShare: [PRICE, PRICE],
        },
      ],
      notify: [
        {
          assetId: REMOTE_ASSET,
          notifications: [{ investor: INVESTOR, maxClaims: 3 }],
        },
      ],
      refundAddress: REFUND,
    });

    // Order is load-bearing: a notification settles the epochs this
    // transaction issues, so emitting it first reverts `IssuanceRequired()`.
    const names = built.calls!.map(
      (call) => decodeManagerCall(call.data).functionName,
    );
    expect(names).toEqual(["issueShares", "issueShares", "notifyDeposit"]);

    const notify = decodeManagerCall(built.calls![2]!.data);
    expect(notify.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      BigInt(REMOTE_ASSET),
      addressToBytes32(INVESTOR, "t"),
      3,
      REFUND,
    ]);
    // Two issuances plus one notification is three messages on one route.
    expect(built.messages?.[2]).toHaveLength(3);
  });

  it("refuses a notification for an asset it is not issuing", () => {
    expect(() =>
      issueShares(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        issuances: [
          {
            assetId: REMOTE_ASSET,
            fromEpochId: "1",
            pricesPoolPerShare: [PRICE],
          },
        ],
        notify: [
          {
            assetId: OTHER_REMOTE_ASSET,
            notifications: [{ investor: INVESTOR, maxClaims: 1 }],
          },
        ],
        refundAddress: REFUND,
      }),
    ).toThrow(/is not among the assets/);
  });

  it("refuses maxClaims of zero and a repeated investor", () => {
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      issuances: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "1",
          pricesPoolPerShare: [PRICE],
        },
      ],
      refundAddress: REFUND,
    };

    // A zero `maxClaims` is exactly what a filter on the corrupted `account`
    // column would produce: it settles nothing while paying for a message, and
    // it does not fail — it ships.
    expect(() =>
      issueShares(hubContext(), {
        ...base,
        notify: [
          {
            assetId: REMOTE_ASSET,
            notifications: [{ investor: INVESTOR, maxClaims: 0 }],
          },
        ],
      }),
    ).toThrow(/is not a positive uint32/);

    expect(() =>
      issueShares(hubContext(), {
        ...base,
        notify: [
          {
            assetId: REMOTE_ASSET,
            notifications: [
              { investor: INVESTOR, maxClaims: 1 },
              {
                investor: INVESTOR.toUpperCase().replace("0X", "0x"),
                maxClaims: 2,
              },
            ],
          },
        ],
      }),
    ).toThrow(/names investor .* twice/);
  });
});

describe("revokeShares", () => {
  it("encodes one revokeShares per epoch and carries NO amount", () => {
    const built = revokeShares(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      revocations: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "2",
          pricesPoolPerShare: [PRICE],
        },
      ],
      refundAddress: REFUND,
    });

    const decoded = decodeManagerCall(built.calls![0]!.data);
    expect(decoded.functionName).toBe("revokeShares");
    // Seven args and none of them is an amount: the revoked share amount is
    // read back out of epoch state (`revokedShareAmount =
    // epochAmounts.approvedShareAmount`), so the price is the only economic
    // input and an approve/revoke pair must name the same epochs.
    expect(decoded.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      BigInt(REMOTE_ASSET),
      2,
      BigInt(PRICE),
      0n,
      REFUND,
    ]);
  });

  it("appends notifyRedeem after every revocation", () => {
    const built = revokeShares(hubContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      revocations: [
        {
          assetId: REMOTE_ASSET,
          fromEpochId: "1",
          pricesPoolPerShare: [PRICE],
        },
      ],
      notify: [
        {
          assetId: REMOTE_ASSET,
          notifications: [
            { investor: INVESTOR, maxClaims: 1 },
            { investor: OTHER_INVESTOR, maxClaims: 2 },
          ],
        },
      ],
      refundAddress: REFUND,
    });

    const names = built.calls!.map(
      (call) => decodeManagerCall(call.data).functionName,
    );
    expect(names).toEqual(["revokeShares", "notifyRedeem", "notifyRedeem"]);
    // Investor order is the caller's order, which is why the caller's list has
    // to come from a query with an explicit total ORDER BY: a
    // reordering changes `data`, and a `data` mismatch fails verification.
    expect(decodeManagerCall(built.calls![1]!.data).args?.[3]).toBe(
      addressToBytes32(INVESTOR, "t"),
    );
    expect(decodeManagerCall(built.calls![2]!.data).args?.[3]).toBe(
      addressToBytes32(OTHER_INVESTOR, "t"),
    );
    expect(built.messages?.[2]).toHaveLength(3);
  });

  it("refuses an epoch page that would wrap the chain's uint32", () => {
    expect(() =>
      revokeShares(hubContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        revocations: [
          {
            assetId: REMOTE_ASSET,
            fromEpochId: ((1n << 32n) - 1n).toString(),
            pricesPoolPerShare: [PRICE, PRICE],
          },
        ],
        refundAddress: REFUND,
      }),
    ).toThrow(/exceeds uint32/);
  });
});

describe("issueSharesDirect", () => {
  it("encodes override, issue and reset as ONE spoke-side multicall", () => {
    const ctx = spokeContext();

    const built = issueSharesDirect(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
      shares: "1000",
      pricePoolPerShare: PRICE,
    });

    expect(built.to).toBe(ctx.addresses.balanceSheet);
    expect(built.calls).toHaveLength(3);
    const names = built.calls!.map(
      (call) => decodeBalanceSheetCall(call.data).functionName,
    );
    // All three in one transaction is mandatory, not tidy:
    // `overridePricePoolPerShare` writes TRANSIENT storage, so the price it
    // sets exists only for the remainder of this transaction.
    expect(names).toEqual([
      "overridePricePoolPerShare",
      "issue",
      "resetPricePoolPerShare",
    ]);

    const issue = decodeBalanceSheetCall(built.calls![1]!.data);
    // A plain address, not a bytes32 — unlike the batch path's `investor`.
    expect(issue.args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      INVESTOR,
      1000n,
    ]);
  });

  it("declares an EMPTY manifest, because issue only QUEUES the delta", () => {
    // Verified against the contract rather than assumed: `BalanceSheet.issue`
    // mutates `queuedShares[poolId][scId]` and mints locally; the spoke→hub
    // `UpdateShares` message leaves later, from a SEPARATE
    // `submitQueuedShares` call. So the zero is right rather than a
    // placeholder — the `updatePoolManagers` case.
    const built = issueSharesDirect(spokeContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
      shares: "1",
      pricePoolPerShare: PRICE,
    });

    expect(built.messages).toEqual({});
    expect(built.value).toBe(0n);
  });

  it("refuses zero shares and a zero price", () => {
    const base = {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
    };
    expect(() =>
      issueSharesDirect(spokeContext(), {
        ...base,
        shares: "0",
        pricePoolPerShare: PRICE,
      }),
    ).toThrow(/is zero/);
    expect(() =>
      issueSharesDirect(spokeContext(), {
        ...base,
        shares: "1",
        pricePoolPerShare: "0",
      }),
    ).toThrow(/is zero/);
  });
});

describe("revokeSharesDirect", () => {
  it("moves the shares to the custodian BEFORE burning them", () => {
    const ctx = spokeContext();

    const built = revokeSharesDirect(ctx, {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
      custodianAddress: CUSTODIAN,
      shares: "250",
      pricePoolPerShare: PRICE,
    });

    expect(built.calls).toHaveLength(4);
    const names = built.calls!.map(
      (call) => decodeBalanceSheetCall(call.data).functionName,
    );
    expect(names).toEqual([
      "transferSharesFrom",
      "overridePricePoolPerShare",
      "revoke",
      "resetPricePoolPerShare",
    ]);

    // `BalanceSheet.revoke` burns from `msgSender()` and takes NO holder
    // argument, so revoking somebody else's position means moving the shares
    // to the signer first — which is what `custodianAddress` names.
    expect(decodeBalanceSheetCall(built.calls![0]!.data).args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      INVESTOR,
      INVESTOR,
      CUSTODIAN,
      250n,
    ]);
    expect(decodeBalanceSheetCall(built.calls![2]!.data).args).toEqual([
      BigInt(POOL_ID),
      SC_ID.toLowerCase(),
      250n,
    ]);
  });

  it("refuses a malformed custodian rather than defaulting it", () => {
    expect(() =>
      revokeSharesDirect(spokeContext(), {
        poolId: POOL_ID,
        scId: SC_ID,
        address: INVESTOR,
        custodianAddress: "0x00",
        shares: "1",
        pricePoolPerShare: PRICE,
      }),
    ).toThrow(/custodianAddress/);
  });

  it("declares an EMPTY manifest, because revoke only QUEUES the delta", () => {
    const built = revokeSharesDirect(spokeContext(), {
      poolId: POOL_ID,
      scId: SC_ID,
      address: INVESTOR,
      custodianAddress: CUSTODIAN,
      shares: "1",
      pricePoolPerShare: PRICE,
    });

    expect(built.messages).toEqual({});
    expect(built.value).toBe(0n);
  });
});

describe("the builders barrel", () => {
  it("exposes all six order actions", () => {
    // The dual argument shapes of the SDK's two combined methods become SIX
    // distinct builders, deliberately not mirroring the v3.2 entrypoint. The
    // SDK discriminates its legs by which KEYS an entry carries, a shape in
    // which "both" and "neither" are both expressible.
    expect(builders.approveDeposits).toBe(approveDeposits);
    expect(builders.issueShares).toBe(issueShares);
    expect(builders.approveRedeems).toBe(approveRedeems);
    expect(builders.revokeShares).toBe(revokeShares);
    expect(builders.issueSharesDirect).toBe(issueSharesDirect);
    expect(builders.revokeSharesDirect).toBe(revokeSharesDirect);
  });

  it("refuses a contract name the deployment does not carry, by name", () => {
    // `AddressSet` is `Record<string, Address>`, so a missing name reads as
    // `undefined` and `encodeFunctionData` would happily produce calldata
    // addressed nowhere. Asserted with the name stripped from a real context
    // rather than with a hand-built one, so the test would still catch it if
    // the registry key were renamed.
    const ctx = hubContext();
    const withoutManager: ProtocolContext = {
      ...ctx,
      addresses: Object.fromEntries(
        Object.entries(ctx.addresses).filter(
          ([name]) => name !== "batchRequestManager",
        ),
      ),
    };

    expect(() =>
      approveRedeems(withoutManager, {
        poolId: POOL_ID,
        scId: SC_ID,
        approvals: [
          {
            assetId: REMOTE_ASSET,
            epochId: "1",
            approvedShareAmount: "1",
            pricePoolPerAsset: PRICE,
          },
        ],
      }),
    ).toThrow(/no "batchRequestManager" address is registered/);
  });
});
