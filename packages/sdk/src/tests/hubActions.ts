import { of } from 'rxjs'
import sinon from 'sinon'
import { zeroAddress } from 'viem'
import type { Centrifuge } from '../Centrifuge.js'
import { BalanceSheet } from '../entities/BalanceSheet.js'
import { OnchainPM } from '../entities/OnchainPM.js'
import { OnOffRampManager } from '../entities/OnOffRampManager.js'
import { Pool } from '../entities/Pool.js'
import { PoolNetwork } from '../entities/PoolNetwork.js'
import { ShareClass } from '../entities/ShareClass.js'
import { Vault } from '../entities/Vault.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { AssetId } from '../utils/types.js'
import {
  ctx,
  entitiesOf,
  HUB,
  noHook,
  pool33Id,
  scId33,
  scId33b,
  signer,
  SPOKE,
  spokeAssetId,
  thenable,
  who,
} from './hubGroup.js'
import {
  adapter,
  asset,
  deployedClass,
  deployFixture,
  DEPLOY_READS,
  FIRST_DEPLOYMENT,
  registrar,
  sharePriceFixture,
  token,
  vaultAddress,
} from './hubPolicyRig.js'

// The v3.3 writes of the SDK's entities that send Hub calls, each as one runnable scenario: the reads its chain
// answers, and the entity with the write on it. `hubCallMessages.test.ts` derives the messages of every one of them and
// `hubActions.roundTrip.test.ts` schedules and executes every one of them, so a new entity write needs one entry here.
// A write that no v3.3 pool can send (the MerkleProofManager, `setMaxAssetPriceAge`, `_updateContract`: refused on v3.3)
// is not in the table.

export type HubAction = {
  name: string
  /** The Hub functions the write sends. */
  covers: string[]
  /** What the chain answers by function name; a function value receives the arguments of the read. */
  reads?: Record<string, unknown>
  /** Addresses that have contract code. */
  contracts?: readonly HexString[]
  /** Why `hubCallMessages.test.ts` leaves the action out: it is not built or declares no message for what it derives. */
  skipMessages?: string
  /** Builds the entity on `centrifuge`, and the pool to schedule and execute with, and the write. */
  setup: (centrifuge: Centrifuge) => { pool: Pool; write: () => PromiseLike<unknown> }
}

const ramp = '0x5555555555555555555555555555555555555555' as HexString
const candidatePolicy = '0x1010101010101010101010101010101010101010' as HexString
const oracleValuation = '0x6666666666666666666666666666666666666666' as HexString
const transferHook = '0x7777777777777777777777777777777777777777' as HexString
const accountingAssetId = AssetId.from(SPOKE, 7)
const salt = `0x${'ab'.repeat(32)}` as HexString
const members = [
  { address: who, validUntil: 4_000_000_000, centrifugeId: SPOKE },
  { address: ramp, validUntil: 4_000_000_000, centrifugeId: SPOKE },
]

const VAULT_READS = {
  manager: true,
  requestManager: who,
  idToAsset: [asset, 0n],
  shareToken: token,
  getVault: vaultAddress,
}

/** The deployment of a pool's share class that is active on the spoke, with `vaults` on it. */
const deployedOn = (centrifuge: Centrifuge, vaults: readonly { address: HexString }[] = []) => {
  const fixture = deployFixture(centrifuge, deployedClass)
  sinon.stub(fixture.network, 'vaults').returns(thenable(vaults) as any)
  return fixture
}

const pendingDeposit = (shareClass: ShareClass) => {
  sinon.stub(shareClass, 'pendingAmounts').returns(
    thenable({
      byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 3, issueEpoch: 3 }],
    }) as any
  )
  sinon.stub(shareClass, '_investOrders').returns(of({ investOrders: [] }) as any)
}

export const HUB_ACTIONS: HubAction[] = [
  {
    name: 'Pool.update',
    covers: ['setPoolMetadata', 'addShareClass', 'updateShareClassMetadata', 'notifyShareMetadata', 'createAccount'],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      const shareClass = new ShareClass(centrifuge, pool, scId33.raw)
      const network = new PoolNetwork(centrifuge, pool, SPOKE)
      sinon.stub(network, 'details').returns(thenable(deployedClassOf(shareClass)) as any)
      sinon.stub(centrifuge, 'pool').returns(thenable(pool) as any)
      sinon.stub(pool, 'details').returns(
        thenable({
          id: pool33Id,
          shareClasses: [{ shareClass, details: { id: scId33, symbol: 'OLD', name: 'Old' } }],
        }) as any
      )
      sinon.stub(pool, 'metadata').returns(thenable(undefined) as any)
      sinon.stub(pool, 'activeNetworks').returns(thenable([network]) as any)
      return {
        pool,
        write: () =>
          pool.update(
            { poolName: 'Pool' },
            [{ id: scId33, tokenName: 'New', symbolName: 'NEW', defaultAccounts: { asset: 10, equity: 11 } } as any],
            [{ tokenName: 'Two', symbolName: 'TWO', salt } as any]
          ),
      }
    },
  },
  {
    name: 'Pool.updatePoolManagers',
    covers: ['updateHubManager'],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      sinon.stub(pool, 'poolManagers').returns(thenable([{ address: signer }]) as any)
      return {
        pool,
        write: () =>
          pool.updatePoolManagers([
            { address: ramp, canManage: true },
            { address: oracleValuation, canManage: true },
          ]),
      }
    },
  },
  {
    name: 'Pool.createAccounts',
    covers: ['createAccount'],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return {
        pool,
        write: () =>
          pool.createAccounts([
            { accountId: 5n, isDebitNormal: true },
            { accountId: 6n, isDebitNormal: false },
          ]),
      }
    },
  },
  {
    name: 'Pool.updateBalanceSheetManagers',
    covers: ['updateManager'],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return {
        pool,
        write: () => pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE, address: who, canManage: true }]),
      }
    },
  },
  {
    name: 'Pool.updateOracleValuationFeeder',
    covers: ['managerCall'],
    skipMessages: 'the entity declares no message for a managerCall that stays on the hub chain, which costs nothing',
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return { pool, write: () => pool.updateOracleValuationFeeder(oracleValuation, SPOKE, who, true) }
    },
  },
  {
    name: 'Pool.setAdapters',
    covers: ['setAdapters'],
    reads: { entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter },
    contracts: [adapter],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return {
        pool,
        write: () => pool.setAdapters([{ centrifugeId: SPOKE, localAdapters: [adapter], remoteAdapters: [adapter] }]),
      }
    },
  },
  {
    name: 'Pool.installHubPolicy',
    covers: ['setPolicy'],
    // A policy built for this pool answers its four dependencies with the pool's own, and none is installed yet.
    reads: {
      policy: zeroAddress,
      hub: ctx(pool33Id, '3.3').addresses.hub,
      hubRegistry: ctx(pool33Id, '3.3').addresses.hubRegistry,
      multiAdapter: ctx(pool33Id, '3.3').addresses.multiAdapter,
      shareClassManager: ctx(pool33Id, '3.3').addresses.shareClassManager,
    },
    contracts: [candidatePolicy],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return { pool, write: () => pool.installHubPolicy(candidatePolicy) }
    },
  },
  {
    name: 'Pool.updateMetadata',
    covers: ['setPoolMetadata'],
    setup(centrifuge) {
      const pool = new Pool(centrifuge, pool33Id)
      return { pool, write: () => pool.updateMetadata(POOL_METADATA) }
    },
  },
  {
    name: 'ShareClass.updateSharePrice',
    covers: ['updateSharePrice', 'notifySharePrice'],
    setup(centrifuge) {
      const { pool, shareClasses } = sharePriceFixture(centrifuge)
      return {
        pool,
        write: () => shareClasses[0]!.updateSharePrice(new Price(10n ** 18n), new Date(1_700_000_000_000)),
      }
    },
  },
  {
    name: 'ShareClass.notifySharePrice',
    covers: ['notifySharePrice'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.notifySharePrice(SPOKE) }
    },
  },
  {
    name: 'ShareClass.notifyAssetPrice',
    covers: ['notifyAssetPrice'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.notifyAssetPrice(spokeAssetId) }
    },
  },
  {
    name: 'PoolNetwork.deploy, first deployment on a spoke',
    covers: ['notifyPool', 'updateManager', 'setRequestManager', 'notifyShareClass', 'managerCall'],
    reads: DEPLOY_READS,
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, FIRST_DEPLOYMENT)
      return { pool, write: () => network.deploy([{ id: scId33, hook: who }], []) }
    },
  },
  {
    name: 'PoolNetwork.deploy, two share classes on a first deployment',
    covers: ['notifyPool', 'setRequestManager', 'notifyShareClass', 'managerCall'],
    reads: DEPLOY_READS,
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, FIRST_DEPLOYMENT)
      return {
        pool,
        write: () =>
          network.deploy(
            [
              { id: scId33, hook: who },
              { id: scId33b, hook: noHook },
            ],
            []
          ),
      }
    },
  },
  {
    name: 'PoolNetwork.deploy, a first deployment whose adapters are not wired',
    covers: ['setAdapters', 'notifyPool', 'setRequestManager', 'notifyShareClass', 'managerCall'],
    skipMessages: 'setAdapters cannot be built with the deployment, which is two transactions',
    reads: DEPLOY_READS,
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, FIRST_DEPLOYMENT, { wired: false })
      return { pool, write: () => network.deploy([{ id: scId33, hook: who }], []) }
    },
  },
  {
    name: 'PoolNetwork.deploy, a share class on a network the pool is on',
    covers: ['notifyShareClass', 'managerCall'],
    reads: { ...DEPLOY_READS, manager: true, requestManager: who },
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, deployedClass)
      return { pool, write: () => network.deploy([{ id: scId33b, hook: who }], []) }
    },
  },
  {
    name: 'PoolNetwork.deploy, a sync deposit vault',
    covers: ['managerCall', 'notifyAssetPrice', 'updateVault'],
    reads: VAULT_READS,
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, deployedClass)
      return {
        pool,
        write: () => network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'syncDeposit' }]),
      }
    },
  },
  {
    name: 'PoolNetwork.deploy, an async deposit vault with the balance sheet manager not yet set',
    covers: ['updateManager', 'notifyAssetPrice', 'updateVault', 'managerCall'],
    reads: { ...DEPLOY_READS, ...VAULT_READS, manager: false },
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, deployedClass)
      return {
        pool,
        write: () => network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'async' }]),
      }
    },
  },
  {
    name: 'PoolNetwork.linkVaults',
    covers: ['updateVault', 'managerCall'],
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployedOn(centrifuge, [{ address: vaultAddress }])
      return {
        pool,
        write: () => network.linkVaults([{ shareClassId: scId33, assetId: spokeAssetId, address: vaultAddress }]),
      }
    },
  },
  {
    name: 'PoolNetwork.unlinkVaults',
    covers: ['updateVault', 'managerCall'],
    contracts: [adapter],
    setup(centrifuge) {
      const { pool, network } = deployFixture(centrifuge, {
        isActive: true,
        activeShareClasses: [{ id: scId33, vaults: [{ address: vaultAddress }] }],
      })
      return {
        pool,
        write: () => network.unlinkVaults([{ shareClassId: scId33, assetId: spokeAssetId, address: vaultAddress }]),
      }
    },
  },
  {
    name: 'PoolNetwork.authorizeOnchainPM',
    covers: ['updateManager', 'managerCall'],
    setup(centrifuge) {
      const { pool, network } = entitiesOf(centrifuge)
      return { pool, write: () => network.authorizeOnchainPM(ramp, scId33.raw) }
    },
  },
  {
    name: 'PoolNetwork.registerOnOffRampManagerAsBSManager',
    covers: ['updateManager', 'managerCall'],
    setup(centrifuge) {
      const { pool, network } = entitiesOf(centrifuge)
      return { pool, write: () => network.registerOnOffRampManagerAsBSManager(ramp, scId33) }
    },
  },
  {
    name: 'ShareClass.updateMember',
    covers: ['updateRestriction'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateMember(who, 4_000_000_000, SPOKE) }
    },
  },
  {
    name: 'ShareClass.updateMembers',
    covers: ['updateRestriction'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateMembers(members) }
    },
  },
  {
    name: 'ShareClass.freezeMember',
    covers: ['updateRestriction'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.freezeMember(who, SPOKE) }
    },
  },
  {
    name: 'ShareClass.unfreezeMember',
    covers: ['updateRestriction'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.unfreezeMember(who, SPOKE) }
    },
  },
  {
    name: 'Centrifuge.batchTransactions of a Freeze and Member updates',
    covers: ['updateRestriction'],
    skipMessages: 'a batch of transactions is signed, and a build needs no signer',
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return {
        pool,
        write: () =>
          centrifuge.batchTransactions('Freeze and update members', [
            shareClass.freezeMember(who, SPOKE),
            shareClass.updateMembers(members),
          ]),
      }
    },
  },
  {
    name: 'ShareClass.createHolding',
    covers: ['initializeHolding'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      sinon.stub(pool, 'metadata').returns(thenable(undefined) as any)
      return {
        pool,
        write: () => shareClass.createHolding(spokeAssetId, who, false, { 0: 1, 1: 2, 2: 4, 3: 3 }),
      }
    },
  },
  {
    name: 'ShareClass.approveDepositsAndIssueShares',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      pendingDeposit(shareClass)
      return {
        pool,
        write: () =>
          shareClass.approveDepositsAndIssueShares([
            {
              assetId: spokeAssetId,
              approveAssetAmount: new Balance(500n, 6),
              approvePricePerAsset: new Balance(10n ** 18n, 18),
              issuePricePerShare: new Price(10n ** 18n),
            },
          ] as any),
      }
    },
  },
  {
    name: 'ShareClass.approveRedeemsAndRevokeShares',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingRedeem: new Balance(1_000n, 18), redeemEpoch: 5, revokeEpoch: 4 }],
        }) as any
      )
      sinon.stub(shareClass, '_redeemOrders').returns(of({ redeemOrders: [] }) as any)
      return {
        pool,
        write: () =>
          shareClass.approveRedeemsAndRevokeShares(
            [
              {
                assetId: spokeAssetId,
                approveShareAmount: new Balance(500n, 18),
                approvePricePerAsset: new Balance(10n ** 18n, 18),
                revokePricePerShare: new Price(10n ** 18n),
              },
            ] as any,
            { notify: false }
          ),
      }
    },
  },
  {
    name: 'ShareClass.updateValuation',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateValuation(SPOKE, who) }
    },
  },
  {
    name: 'ShareClass.updateHook on the hub chain',
    covers: ['managerCall'],
    reads: { shareTokenAndRegistrar: [token, registrar] },
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateHook(HUB, who) }
    },
  },
  {
    name: 'ShareClass.updateHookManager',
    covers: ['managerCall'],
    reads: { shareToken: token, hook: transferHook },
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateHookManager(SPOKE, who) }
    },
  },
  {
    name: 'ShareClass.updateHookAndValuation',
    covers: ['managerCall'],
    reads: { shareTokenAndRegistrar: [token, registrar] },
    setup(centrifuge) {
      const { pool, shareClass } = entitiesOf(centrifuge)
      return { pool, write: () => shareClass.updateHookAndValuation(SPOKE, who, ramp) }
    },
  },
  {
    name: 'Vault.updateMaxReserve',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass, network } = entitiesOf(centrifuge)
      const vault = new Vault(centrifuge, network, shareClass, asset, token, spokeAssetId)
      sinon.stub(vault, '_investmentCurrency').returns(thenable({ decimals: 6 }) as any)
      return { pool, write: () => vault.updateMaxReserve(new Balance(1_000n, 6)) }
    },
  },
  {
    name: 'BalanceSheet.revoke on a spoke, which carries extra gas',
    covers: ['managerCall'],
    reads: { manager: true },
    setup(centrifuge) {
      const { pool, shareClass, network } = entitiesOf(centrifuge)
      sinon.stub(pool, 'isPoolManager').returns(thenable(true) as any)
      return {
        pool,
        write: () =>
          new BalanceSheet(centrifuge, network, shareClass).revoke(who, new Balance(7n, 18), Price.fromFloat(0)),
      }
    },
  },
  {
    name: 'OnchainPM.updatePolicy',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, network } = entitiesOf(centrifuge)
      const onchainPM = new OnchainPM(centrifuge, network, ramp)
      return {
        pool,
        write: () =>
          onchainPM.updatePolicy({
            strategist: who,
            scId: scId33.raw,
            scriptHashes: [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`] as HexString[],
          } as any),
      }
    },
  },
  {
    name: 'OnOffRampManager.setRelayer',
    covers: ['managerCall'],
    setup(centrifuge) {
      const { pool, shareClass, network } = entitiesOf(centrifuge)
      return { pool, write: () => new OnOffRampManager(centrifuge, network, shareClass, ramp).setRelayer(who, true) }
    },
  },
  {
    name: 'OnOffRampManager.setAsset, which also prices the accounting token',
    covers: ['managerCall', 'notifyAssetPrice'],
    reads: {
      accountingToken: () => ctx(pool33Id, '3.3', SPOKE).addresses.accountingToken,
      idToAsset: () => [asset, 0n],
      assetToId: () => accountingAssetId.raw,
      isRegistered: () => true,
    },
    setup(centrifuge) {
      const { pool, shareClass, network } = entitiesOf(centrifuge)
      return { pool, write: () => new OnOffRampManager(centrifuge, network, shareClass, ramp).setAsset(spokeAssetId) }
    },
  },
]

function deployedClassOf(shareClass: ShareClass) {
  return { isActive: true, activeShareClasses: [{ id: scId33, shareClass, vaults: [] }] }
}

const POOL_METADATA = {
  version: 2,
  pool: {
    name: 'Pool',
    icon: null,
    asset: { class: 'Private credit', subClass: '' },
    issuer: { name: '', email: '', logo: null },
    poolStructure: '',
    investorType: '',
    links: { executiveSummary: null },
    status: 'upcoming',
    listed: false,
    poolRatings: [],
  },
  shareClasses: {},
} as any
