import {
  createDeploymentRegistry,
  DEFAULT_DEPLOYMENT_DATA,
  resolveProtocolContext,
  type ProtocolContext,
} from '@centrifuge/protocol'
import { of } from 'rxjs'
import sinon from 'sinon'
import { bundledAddressBook } from '../addressBook.js'
import { Centrifuge } from '../Centrifuge.js'
import { Pool } from '../entities/Pool.js'
import { PoolNetwork } from '../entities/PoolNetwork.js'
import { ShareClass } from '../entities/ShareClass.js'
import type { HexString } from '../types/index.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { stubChain, stubHubPoolSet, stubLayerZeroGlobalSet, stubMigrationRows } from './utils.js'

// Fixtures for tests that build a v3.3 pool's hub writes with its entities against the bundled testnet registry,
// where the hub is Sepolia (centrifugeId 1) and the spoke Base Sepolia (centrifugeId 2).

export const HUB = 1
export const SPOKE = 2
export const pool33Id = PoolId.from(HUB, 33)
export const pool32Id = PoolId.from(HUB, 32)
export const scId33 = ShareClassId.from(pool33Id, 1)
export const scId33b = ShareClassId.from(pool33Id, 2)
export const spokeAssetId = AssetId.from(SPOKE, 1)
export const hubAssetId = AssetId.from(HUB, 1)
export const signer = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
export const who = '0x19f46d8130e610c6c0f0116ea40fb781defade93' as HexString
export const noHook = '0x0000000000000000000000000000000000000000' as HexString
export const STD_HUB_POLICY_FACTORY = '0x9999999999999999999999999999999999999999' as HexString

export const thenable = <T>(value: T) => makeThenable(of(value))

export function ctx(poolId: PoolId, protocolVersion: string, centrifugeId?: number): ProtocolContext {
  return resolveProtocolContext(poolId.raw.toString(), protocolVersion, {
    environment: 'testnet',
    ...(centrifugeId !== undefined ? { centrifugeId } : {}),
  })
}

/**
 * Resolves `centrifuge` against the bundled testnet registry with `stdHubPolicyFactory` listed on the hub chain's v3.3
 * stack, or left out of it when `factory` is undefined, whatever the pinned address book lists.
 */
export function listStdHubPolicyFactory(centrifuge: Centrifuge, factory: HexString | undefined) {
  const { testnet } = DEFAULT_DEPLOYMENT_DATA
  const stack = testnet['3.3']!
  const { stdHubPolicyFactory: _listed, ...contracts } = stack[HUB]!.contracts
  const registry = createDeploymentRegistry({
    mainnet: DEFAULT_DEPLOYMENT_DATA.mainnet,
    testnet: {
      ...testnet,
      '3.3': {
        ...stack,
        [HUB]: { ...stack[HUB]!, contracts: { ...contracts, ...(factory ? { stdHubPolicyFactory: factory } : {}) } },
      },
    },
  })
  sinon.stub(centrifuge, '_addressBook').resolves({ ...bundledAddressBook(), registry })
}

/**
 * A testnet Centrifuge that knows pool 33 as v3.3 and pool 32 as v3.2, with a scripted chain: `reads` answer a
 * contract read by function name, a function value receives the call's arguments. `contracts` is read on every
 * `getCode`, so a test can add an address once it is deployed. `options.stdHubPolicyFactory` lists that factory on the
 * hub chain's v3.3 stack, and `null` lists none. `options.logs` are the logs a confirmed transaction's receipt holds.
 */
export function setupV33(
  reads: Record<string, unknown> = {},
  contracts: readonly HexString[] = [],
  {
    now = 1n,
    stdHubPolicyFactory,
    logs = [],
  }: { now?: bigint; stdHubPolicyFactory?: HexString | null; logs?: readonly object[] } = {}
) {
  const centrifuge = new Centrifuge({
    environment: 'testnet',
    pinJson: async () => 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
    ])
  )
  stubMigrationRows(centrifuge)
  if (stdHubPolicyFactory !== undefined) listStdHubPolicyFactory(centrifuge, stdHubPolicyFactory ?? undefined)
  stubLayerZeroGlobalSet()
  stubHubPoolSet()
  const readContract = sinon
    .stub()
    .callsFake(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (!(functionName in reads)) throw new Error(`unexpected read ${functionName}`)
      const value = reads[functionName]
      return typeof value === 'function' ? value(args) : value
    })
  const getCode = async ({ address }: { address: HexString }) =>
    contracts.some((contract) => contract.toLowerCase() === address.toLowerCase()) ? '0x60' : undefined
  stubChain(centrifuge, {
    readContract,
    getCode,
    getBlock: async () => ({ number: 1n, timestamp: now }),
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash, logs }),
  })
  const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: signer })
  return { centrifuge, build, readContract }
}

export function entitiesOf(centrifuge: Centrifuge, poolId: PoolId = pool33Id, scId: ShareClassId = scId33) {
  const pool = new Pool(centrifuge, poolId)
  const shareClass = new ShareClass(centrifuge, pool, scId.raw)
  const network = new PoolNetwork(centrifuge, pool, SPOKE)
  return { pool, shareClass, network }
}

/** The indexer reports the pool's LayerZero adapter live on both sides, so a deployment is one hub batch. */
export function stubWiredAdapters(centrifuge: Centrifuge) {
  const row = {
    adapterAddress: `0x${'0'.repeat(40)}`,
    isEnabled: true,
    crosschainInProgress: null,
    adapter: { name: 'layerZero' },
  }
  sinon.stub(centrifuge as any, '_queryDataOnce').resolves([row])
}

/** The indexer reports no adapter of the pool on either side, so a first deployment starts with `setAdapters`. */
export function stubUnwiredAdapters(centrifuge: Centrifuge) {
  sinon.stub(centrifuge as any, '_queryDataOnce').resolves([])
}
