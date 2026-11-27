import { createViews, type AddressBook } from "@centrifuge/addressbook";
import { DeploymentVerificationError } from "../errors";
import type {
  ChainEnvironment,
  ContractSchema,
  DeploymentInput,
} from "../types";
import { CHAIN_NAMES } from "./chain-names";

/** Every chain environment, in registry order. */
export const ENVIRONMENTS: readonly ChainEnvironment[] = ["mainnet", "testnet"];

/** Names a chain `CHAIN_NAMES` has no row for. */
export type UnnamedChainNamer = (
  environment: ChainEnvironment,
  centrifugeId: number,
  chainId: number,
) => string;

/** One version's deployments, keyed by environment then `centrifugeId`. */
export type DeploymentsByEnvironment = Readonly<
  Record<ChainEnvironment, Readonly<Record<number, DeploymentInput>>>
>;

/**
 * One protocol version's deployments, read from the `stackLabel` stack
 * (`v3.2.0`) of `book` for the given environments. Only names in `schema` are
 * kept: the book also lists contracts the version's ABI set has no use for. A
 * chain whose stack is empty has no deployment of the version, and an
 * environment without one is empty.
 *
 * A chain with no entry in `names` is named by `nameUnnamed`; without one,
 * throws {@link DeploymentVerificationError}.
 */
export function stackDeployments(
  book: AddressBook,
  stackLabel: string,
  schema: ContractSchema,
  environments: readonly ChainEnvironment[] = ENVIRONMENTS,
  names: typeof CHAIN_NAMES = CHAIN_NAMES,
  nameUnnamed?: UnnamedChainNamer,
): DeploymentsByEnvironment {
  const known = new Set([...schema.required, ...schema.optional]);
  const { stackAddresses } = createViews(book);
  const built: Record<ChainEnvironment, Record<number, DeploymentInput>> = {
    mainnet: {},
    testnet: {},
  };

  for (const environment of environments) {
    const chains = book.networks[environment].chains;
    for (const [id, chain] of Object.entries(chains)) {
      const stack = stackAddresses(environment, id, stackLabel);
      if (Object.keys(stack).length === 0) {
        continue;
      }

      const centrifugeId = Number(id);
      const name =
        names[environment][centrifugeId] ??
        nameUnnamed?.(environment, centrifugeId, chain.chainId);
      if (name === undefined) {
        throw new DeploymentVerificationError(
          `${environment}.${id}.name`,
          "the address book has this chain but the registry has no name for it; add one to CHAIN_NAMES",
        );
      }
      built[environment][centrifugeId] = {
        chainId: chain.chainId,
        name,
        contracts: Object.fromEntries(
          Object.entries(stack).filter(([contract]) => known.has(contract)),
        ),
      };
    }
  }
  return built;
}
