import type * as AddressBookModule from "@centrifuge/addressbook";
import { describe, expect, it, vi } from "vitest";

/** A mainnet chain the baked book gains here and `CHAIN_NAMES` has no row for. */
const UNNAMED_CHAIN = "999";

vi.mock("@centrifuge/addressbook", async (importOriginal) => {
  const real = await importOriginal<typeof AddressBookModule>();
  const book = structuredClone(real.addressBook);
  book.networks.mainnet.chains[UNNAMED_CHAIN] = {
    ...structuredClone(book.networks.mainnet.chains["1"]!),
    chainId: 999_999,
  };
  return { ...real, addressBook: book };
});

describe("the baked registry data of a book the registry cannot build", () => {
  it("does not fail the import of the package's ABIs, builders and errors", async () => {
    const protocol = await import("../index");

    expect(protocol.ABIS_V3_2.Hub).toBeDefined();
    expect(protocol.DeploymentVerificationError).toBeDefined();
  });

  it("fails on the first lookup, naming the chain", async () => {
    const protocol = await import("../index");

    expect(() => protocol.DEFAULT_DEPLOYMENT_DATA.mainnet).toThrow(
      protocol.DeploymentVerificationError,
    );
    expect(() => protocol.DEPLOYMENTS_V3_2.mainnet).toThrow(
      `mainnet.${UNNAMED_CHAIN}.name`,
    );
    expect(() =>
      protocol.defaultDeploymentRegistry().chains("mainnet"),
    ).toThrow(protocol.DeploymentVerificationError);
  });
});
