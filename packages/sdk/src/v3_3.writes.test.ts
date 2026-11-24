import { expect } from 'chai'
import { firstValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  zeroAddress,
} from 'viem'
import {
  ABIS_V3_2,
  ABIS_V3_3,
  builders,
  defaultDeploymentRegistry,
  emptyMessage as protocolEmptyMessage,
  emptyMessageV3_3,
  encodeAccountingTokenMinterPayload,
  encodeAdapterFailoverStewardPayload,
  encodeOnchainPMPolicyPayload,
  encodeOnOffRampPayload,
  encodeOracleValuationFeederPayload,
  encodeShareTokenRegistrarPayload,
  encodeSyncManagerPayload,
  MessageArgumentError,
  resolveProtocolContext,
  UnsupportedForProtocolVersionError,
  type ProtocolContext,
  SHARE_REVOKE_EXTRA_GAS,
} from '@centrifuge/protocol'
import { Centrifuge } from './Centrifuge.js'
import { AdapterFailoverStewardMissingError } from './errors.js'
import { BalanceSheet } from './entities/BalanceSheet.js'
import { buildPolicyUpdate } from './entities/OnchainPM.js'
import { OnOffRampManager } from './entities/OnOffRampManager.js'
import { Pool } from './entities/Pool.js'
import { PoolNetwork } from './entities/PoolNetwork.js'
import { ShareClass } from './entities/ShareClass.js'
import { Vault } from './entities/Vault.js'
import { stubChain, stubMigrationRows, stubProjectedPools } from './tests/utils.js'
import { AccountType } from './types/holdings.js'
import type { HexString } from './types/index.js'
import {
  emptyMessage,
  MessageType,
  MessageTypeV3_3,
  messageV3_3,
  type OperationOutOfPolicyStatus,
  type OutOfPolicyCall,
} from './types/transaction.js'
import { Balance, Price } from './utils/BigInt.js'
import { toAccountingTokenId } from './utils/accountingToken.js'
import { addressToBytes32 } from './utils/index.js'
import { makeThenable } from './utils/rx.js'
import { encodeBatchCalldata } from './utils/transaction.js'
import { AssetId, PoolId, ShareClassId } from './utils/types.js'

// Every SDK write on a v3.3 pool either builds the calldata the #482 builders
// produce or refuses with UnsupportedForProtocolVersionError, and a v3.2 pool
// in the same process keeps its v3.2 calldata. Built against the bundled
// testnet registry, where both versions are deployed on Sepolia (hub) and
// Base Sepolia (spoke).

const HUB = 1
const SPOKE = 2
const pool33Id = PoolId.from(HUB, 33)
const pool32Id = PoolId.from(HUB, 32)
const scId33 = ShareClassId.from(pool33Id, 1)
const scId32 = ShareClassId.from(pool32Id, 1)
const spokeAssetId = AssetId.from(SPOKE, 1)
const signer = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const who = '0x19f46d8130e610c6c0f0116ea40fb781defade93' as HexString
const valuation = '0xa4a7bb3831958463b3fe3e27a6a160f764341953' as HexString
const token = '0x2222222222222222222222222222222222222222' as HexString
const registrar = '0x3333333333333333333333333333333333333333' as HexString
const asset = '0x4444444444444444444444444444444444444444' as HexString
const ramp = '0x5555555555555555555555555555555555555555' as HexString

const thenable = <T>(value: T) => makeThenable(of(value))

function ctx(poolId: PoolId, protocolVersion: string, centrifugeId?: number): ProtocolContext {
  return resolveProtocolContext(poolId.raw.toString(), protocolVersion, {
    environment: 'testnet',
    ...(centrifugeId !== undefined ? { centrifugeId } : {}),
  })
}

/**
 * A testnet Centrifuge that knows pool 33 as v3.3 and pool 32 as v3.2, with a scripted chain. `contracts` are the
 * addresses that have code; every other address reads as an account.
 */
function setup(
  reads: Record<string, unknown> = {},
  config: { disableRepeatOnEvents?: boolean } = {},
  contracts: readonly HexString[] = []
) {
  const centrifuge = new Centrifuge({ environment: 'testnet', ...config })
  sinon.stub(centrifuge as any, '_poolRows').returns(
    of([
      { id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' },
      { id: pool32Id.toString(), protocolVersion: '3.2', migrationStatus: 'live' },
    ])
  )
  stubMigrationRows(centrifuge)
  const readContract = sinon
    .stub()
    .callsFake(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (!(functionName in reads)) throw new Error(`unexpected read ${functionName}`)
      const value = reads[functionName]
      return typeof value === 'function' ? value(args) : value
    })
  const getCode = async ({ address }: { address: HexString }) =>
    contracts.some((contract) => contract.toLowerCase() === address.toLowerCase()) ? '0x60' : undefined
  stubChain(centrifuge, { readContract, getCode, getBlock: async () => ({ number: 1n, timestamp: 1n }) })
  const build = (tx: any) => centrifuge.buildOnly(tx, { fromAddress: signer })
  return { centrifuge, build, readContract }
}

/** A ramp without `accountingToken()`: its read reverts, so the update carries no price. */
function legacyRamp(): never {
  throw new ContractFunctionRevertedError({ abi: [], functionName: 'accountingToken' })
}

function entities(centrifuge: Centrifuge, poolId: PoolId, scId: ShareClassId) {
  const pool = new Pool(centrifuge, poolId)
  const shareClass = new ShareClass(centrifuge, pool, scId.raw)
  const network = new PoolNetwork(centrifuge, pool, SPOKE)
  return { pool, shareClass, network }
}

async function expectRefusal(promise: Promise<unknown>) {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  expect(error, 'expected the typed v3.3 refusal').to.be.instanceOf(UnsupportedForProtocolVersionError)
}

const managerCallMessage = (poolId: PoolId) => messageV3_3(MessageTypeV3_3.ManagerCallFromHub, poolId)

/**
 * Runs writes as a wallet signs them and records every transaction sent, as
 * `{ to, calls }` with a multicall unwrapped. Fees are stubbed to zero.
 */
function collectSigned(centrifuge: Centrifuge, statuses: unknown[] = []) {
  const sent: { to: string; calls: HexString[] }[] = []
  sinon.stub(centrifuge, '_estimate').returns(thenable(0n) as any)
  sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
    (async () => {
      const generator = callback({
        isBatching: false,
        signingAddress: signer,
        centrifugeId,
        walletClient: {
          getChainId: async () => 11155111,
          sendTransaction: async ({ to, data }: { to: string; data: HexString }) => {
            const calls = data.startsWith('0xac9650d8')
              ? (decodeFunctionData({ abi: ABIS_V3_3.Hub, data }).args![0] as HexString[])
              : [data]
            sent.push({ to: to.toLowerCase(), calls })
            return `0x${'11'.repeat(32)}`
          },
        },
        publicClient: {
          getCode: async () => undefined,
          waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
        },
        root: centrifuge,
      })
      for (let step = await generator.next(); !step.done; step = await generator.next()) statuses.push(step.value)
    })()) as any)
  return sent
}

/** A call the pool's hub policy does not let through. */
const refusal = ({ data }: { data: HexString }): OutOfPolicyCall => ({
  data,
  functionName: null,
  args: null,
  status: 'needs-authorization',
  reason: null,
  delay: 100n,
  validAfter: null,
  expiresAt: null,
})

/** Makes the pre-send check refuse every call it is asked about. */
function refuseEveryCall(centrifuge: Centrifuge) {
  return sinon.stub(centrifuge, '_classifyHubCalls').callsFake(async (_signer, calls) => calls.map(refusal))
}

/**
 * Runs a write to completion in batching mode and returns every batch it
 * yields, for writes that send more than one transaction (buildOnly keeps only
 * the first). Stubs `_transact` before any entity binds it.
 */
function collectBatches(centrifuge: Centrifuge) {
  const batches: { contract: string; data: HexString[]; messages?: unknown; alwaysBatch?: boolean }[] = []
  sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
    (async () => {
      const client = await centrifuge.getClient(centrifugeId)
      const generator = callback({
        isBatching: true,
        signingAddress: signer,
        centrifugeId,
        publicClient: client,
        root: centrifuge,
      })
      for await (const item of generator) batches.push(item)
      return batches
    })()) as any)
  return batches
}

describe('v3.3 writes', () => {
  afterEach(() => sinon.restore())

  describe('fees', () => {
    it('renumbers a v3.2 message priced for a v3.3 pool', () => {
      const descriptor = { type: MessageType.NotifyPool, poolId: pool33Id } as const
      expect(emptyMessage(descriptor, '3.3')).to.equal(
        emptyMessageV3_3(MessageTypeV3_3.NotifyPool, pool33Id.raw.toString())
      )
      expect(emptyMessage(descriptor, '3.2')).to.equal(
        protocolEmptyMessage(MessageType.NotifyPool, pool33Id.raw.toString())
      )
    })

    it('refuses to price a removed v3.2 message on v3.3, and a v3.3 message on v3.2', () => {
      expect(() => emptyMessage({ type: MessageType.TrustedContractUpdate, poolId: pool33Id }, '3.3')).to.throw(
        MessageArgumentError
      )
      expect(() => emptyMessage(managerCallMessage(pool33Id), '3.2')).to.throw(/v3.3 only/)
      expect(emptyMessage(managerCallMessage(pool33Id), '3.3')).to.equal(
        emptyMessageV3_3(MessageTypeV3_3.ManagerCallFromHub, pool33Id.raw.toString())
      )
    })
  })

  describe('vault orders', () => {
    async function routerBatch(protocolVersion: string) {
      const { centrifuge } = setup()
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      const vault = new Vault(centrifuge, network, shareClass, asset, token, spokeAssetId)
      const generator = vault._sendRouterFeeTransaction(
        'Invest',
        { isBatching: true } as any,
        ramp,
        ['0x12345678'],
        protocolVersion
      )
      return (await generator.next()).value as { messages?: unknown; alwaysBatch?: boolean }
    }

    it('a 3.3 request declares no message, so it sends zero value', async () => {
      const batch = await routerBatch('3.3')
      expect(batch.messages).to.equal(undefined)
      expect(batch.alwaysBatch).to.equal(undefined)
    })

    it('a 3.2 request still pays the Request estimate through the router multicall', async () => {
      const batch = await routerBatch('3.2')
      expect(batch.messages).to.deep.equal({ [HUB]: [{ type: MessageType.Request, poolId: pool33Id }] })
      expect(batch.alwaysBatch).to.equal(true)
    })
  })

  describe('share class', () => {
    it('updateValuation is a managerCall to the spoke SyncManager on 3.3 and updateContract on 3.2', async () => {
      const { centrifuge, build } = setup()
      const built33 = await build(entities(centrifuge, pool33Id, scId33).shareClass.updateValuation(SPOKE, valuation))
      const hub33 = ctx(pool33Id, '3.3')
      const spoke33 = ctx(pool33Id, '3.3', SPOKE)
      expect(built33.to.toLowerCase()).to.equal(hub33.addresses.hub!.toLowerCase())
      expect(built33.data).to.equal(
        builders.hubManagerCall(hub33, {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: spoke33.addresses.syncManager!,
          payload: encodeSyncManagerPayload({ kind: 'valuation', scId: scId33.raw, valuation }),
          label: 'SyncManager.Valuation',
          refundAddress: signer,
        }).data
      )
      expect(built33.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id)] })

      const built32 = await build(entities(centrifuge, pool32Id, scId32).shareClass.updateValuation(SPOKE, valuation))
      expect(built32.to.toLowerCase()).to.equal(ctx(pool32Id, '3.2').addresses.hub!.toLowerCase())
      expect(decodeFunctionData({ abi: ABIS_V3_2.Hub, data: built32.data }).functionName).to.equal('updateContract')
    })

    it('updateHook sets the hook through the share token registrar on 3.3', async () => {
      const { centrifuge, build } = setup({ shareTokenAndRegistrar: [token, registrar] })
      const built = await build(entities(centrifuge, pool33Id, scId33).shareClass.updateHook(SPOKE, valuation))
      expect(built.data).to.equal(
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: registrar,
          payload: encodeShareTokenRegistrarPayload({ kind: 'setHook', scId: scId33.raw, hook: valuation }),
          label: 'ShareTokenRegistrar.SetHook',
          refundAddress: signer,
        }).data
      )
      expect(built.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id)] })
    })

    it('refuses the removed price ages and a liability holding', async () => {
      const { centrifuge, build } = setup()
      const { shareClass, pool } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'metadata').returns(thenable(undefined) as any)
      sinon.stub(centrifuge, 'pool').returns(thenable(pool) as any)
      await expectRefusal(build(shareClass.setMaxSharePriceAge(SPOKE, 60)))
      await expectRefusal(build(shareClass.setMaxAssetPriceAge(spokeAssetId, 60)))
      await expectRefusal(build(shareClass.createHolding(spokeAssetId, valuation, true, {})))
    })

    it('createHolding initializes the four AccountKind slots on 3.3', async () => {
      const { centrifuge, build } = setup()
      const { shareClass, pool } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'metadata').returns(thenable(undefined) as any)
      const built = await build(shareClass.createHolding(spokeAssetId, valuation, false, { 0: 1, 1: 2, 2: 4, 3: 3 }))
      expect(built.data).to.equal(
        builders.createHolding(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          assetId: spokeAssetId.toString(),
          valuationAddress: valuation,
          isLiability: false,
          accounts: { asset: '1', equity: '2', gain: '3', loss: '4' },
        }).data
      )
    })

    it('crosschainTransferShares names the signer as sender and owner on 3.3 for a bridger', async () => {
      // A pool without a bridging hook: the breaker is covered in ShareClass.tokenBridge.test.ts,
      // as is the TokenBridge path a non-bridger takes.
      const bridger = setup({
        bridger: true,
        bridgingHook: '0x0000000000000000000000000000000000000000',
        shareToken: token,
        allowance: 5n,
      })
      const built = await bridger.build(
        entities(bridger.centrifuge, pool33Id, scId33).shareClass.crosschainTransferShares(SPOKE, HUB, who, 5n)
      )
      expect(built.data).to.equal(
        builders.crosschainTransferShares(ctx(pool33Id, '3.3', SPOKE), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          destinationCentrifugeId: String(HUB),
          receiver: who,
          amount: '5',
          refundAddress: signer,
          senderAddress: signer,
        }).data
      )
    })

    it('approves deposits through Hub.managerCall in an always-wrapped hub batch on 3.3', async () => {
      const { centrifuge, build } = setup()
      const { shareClass } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [
            {
              assetId: spokeAssetId,
              pendingDeposit: new Balance(1_000n, 6),
              depositEpoch: 3,
              issueEpoch: 3,
            },
          ],
        }) as any
      )
      sinon.stub(shareClass, '_investOrders').returns(of({ investOrders: [] }) as any)
      const built = await build(
        shareClass.approveDepositsAndIssueShares([
          {
            assetId: spokeAssetId,
            approveAssetAmount: new Balance(500n, 6),
            approvePricePerAsset: new Balance(10n ** 18n, 18),
          },
        ] as any)
      )
      const expected = builders.approveDeposits(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        scId: scId33.raw,
        approvals: [
          {
            assetId: spokeAssetId.toString(),
            epochId: '3',
            approvedAssetAmount: '500',
            pricePoolPerAsset: (10n ** 18n).toString(),
          },
        ],
        refundAddress: signer,
      })
      expect(built.to).to.equal(expected.to)
      expect(built.data).to.equal(expected.data)
      expect(built.messages).to.deep.equal({ [SPOKE]: [{ type: MessageType.RequestCallback, poolId: pool33Id }] })
    })
  })

  describe('claims', () => {
    it('claimDeposit keys the 3.3 notification by request id, the investor bytes32 as a uint256', async () => {
      const { centrifuge, build } = setup()
      const { shareClass } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(shareClass, '_investorOrder').returns(thenable({ maxDepositClaims: 2 }) as any)
      const built = await build(shareClass.claimDeposit(spokeAssetId, who))
      expect(built.to.toLowerCase()).to.equal(ctx(pool33Id, '3.3').addresses.batchRequestManager!.toLowerCase())
      expect(built.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.BatchRequestManager,
          functionName: 'notifyDeposit',
          args: [pool33Id.raw, scId33.raw, spokeAssetId.raw, hexToBigInt(addressToBytes32(who)), 2, signer],
        })
      )
      expect(built.messages).to.deep.equal({ [SPOKE]: [{ type: MessageType.RequestCallback, poolId: pool33Id }] })
    })
  })

  describe('vaults', () => {
    const vaultAddress = '0x7777777777777777777777777777777777777777' as HexString

    it('links a vault and points the share token at it through the registrar on 3.3', async () => {
      const { centrifuge, build } = setup()
      const { network } = entities(centrifuge, pool33Id, scId33)
      sinon
        .stub(network, 'details')
        .returns(thenable({ isActive: true, activeShareClasses: [{ id: scId33, vaults: [] }] }) as any)
      sinon.stub(network, 'vaults').returns(thenable([{ address: vaultAddress }]) as any)
      const built = await build(
        network.linkVaults([{ shareClassId: scId33, assetId: spokeAssetId, address: vaultAddress }])
      )
      const expected = builders.updateVault(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        scId: scId33.raw,
        assetId: spokeAssetId.toString(),
        vaultOrFactory: vaultAddress,
        kind: 'link',
        refundAddress: signer,
        spoke: ctx(pool33Id, '3.3', SPOKE),
      })
      expect(built.calls.map((call) => call.data)).to.deep.equal(expected.calls!.map((call) => call.data))
      expect(built.messages).to.deep.equal({
        [SPOKE]: [{ type: MessageType.UpdateVault, subtype: 1, poolId: pool33Id }, managerCallMessage(pool33Id)],
      })
    })

    it('deploys and links a vault at the address the factory reports, for an active share class', async () => {
      const hubVaultAsset = AssetId.from(HUB, 1)
      const { centrifuge, build } = setup({
        manager: true,
        requestManager: who,
        idToAsset: [asset, 0n],
        shareToken: token,
        getVault: vaultAddress,
      })
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), HUB)
      sinon
        .stub(network, 'details')
        .returns(thenable({ isActive: true, activeShareClasses: [{ id: scId33, vaults: [] }] }) as any)
      const built = await build(network.deploy([], [{ shareClassId: scId33, assetId: hubVaultAsset, kind: 'async' }]))
      const hub33 = ctx(pool33Id, '3.3')
      const linked = builders.updateVault(hub33, {
        poolId: pool33Id.raw.toString(),
        scId: scId33.raw,
        assetId: hubVaultAsset.toString(),
        vaultOrFactory: hub33.addresses.asyncVaultFactory!,
        kind: 'deployAndLink',
        refundAddress: signer,
        spoke: ctx(pool33Id, '3.3', HUB),
        vaultAddress,
      })
      expect(built.calls.map((call) => call.data)).to.deep.equal([
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifyAssetPrice',
          args: [pool33Id.raw, scId33.raw, hubVaultAsset.raw, signer],
        }),
        ...linked.calls!.map((call) => call.data),
      ])
    })
  })

  describe('remaining writes', () => {
    const price = new Price(10n ** 18n)

    function redeemShareClass(centrifuge: Centrifuge) {
      const { shareClass } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingRedeem: new Balance(1_000n, 18), redeemEpoch: 5, revokeEpoch: 4 }],
        }) as any
      )
      sinon
        .stub(shareClass, '_redeemOrders')
        .returns(of({ redeemOrders: [{ assetId: spokeAssetId, investor: who }] }) as any)
      sinon
        .stub(shareClass, '_investorOrder')
        .returns(thenable({ assetId: spokeAssetId, investor: who, pendingRedeem: 10n, maxRedeemClaims: 0 }) as any)
      return { shareClass }
    }

    it('sets a relayer and an onramp asset with the v3.3 ramp manager calls', async () => {
      const { centrifuge, build } = setup({ accountingToken: () => legacyRamp() })
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      const manager = new OnOffRampManager(centrifuge, network, shareClass, ramp)
      const call = (payload: Parameters<typeof encodeOnOffRampPayload>[0]) =>
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: ramp,
          payload: encodeOnOffRampPayload(payload),
          label: `OnOffRamp.${payload.kind}`,
          refundAddress: signer,
        }).data
      expect((await build(manager.setRelayer(who, false))).data).to.equal(
        call({ kind: 'relayer', relayer: who, enabled: false })
      )
      expect((await build(manager.setAsset(spokeAssetId))).data).to.equal(
        call({ kind: 'onramp', assetId: spokeAssetId.toString(), enabled: true })
      )
    })

    it('unlinks a vault and clears the share token pointer on 3.3', async () => {
      const vaultAddress = '0x7777777777777777777777777777777777777777' as HexString
      const { centrifuge, build } = setup()
      const { network } = entities(centrifuge, pool33Id, scId33)
      sinon
        .stub(network, 'details')
        .returns(
          thenable({ isActive: true, activeShareClasses: [{ id: scId33, vaults: [{ address: vaultAddress }] }] }) as any
        )
      const built = await build(
        network.unlinkVaults([{ shareClassId: scId33, assetId: spokeAssetId, address: vaultAddress }])
      )
      const expected = builders.updateVault(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        scId: scId33.raw,
        assetId: spokeAssetId.toString(),
        vaultOrFactory: vaultAddress,
        kind: 'unlink',
        refundAddress: signer,
        spoke: ctx(pool33Id, '3.3', SPOKE),
      })
      expect(built.calls.map((c) => c.data)).to.deep.equal(expected.calls!.map((c) => c.data))
    })

    it('updates a vault max reserve with the SyncManager manager call on 3.3', async () => {
      const { centrifuge, build } = setup()
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      const vault = new Vault(centrifuge, network, shareClass, asset, token, spokeAssetId)
      sinon.stub(vault, '_investmentCurrency').returns(thenable({ decimals: 6 }) as any)
      const built = await build(vault.updateMaxReserve(new Balance(1_000n, 6)))
      expect(built.data).to.equal(
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: ctx(pool33Id, '3.3', SPOKE).addresses.syncManager!,
          payload: encodeSyncManagerPayload({
            kind: 'maxReserve',
            scId: scId33.raw,
            assetId: spokeAssetId.toString(),
            maxReserve: '1000',
          }),
          label: 'SyncManager.MaxReserve',
          refundAddress: signer,
        }).data
      )
      expect(built.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id)] })
    })

    it('sets adapters one network per transaction, never batched, without a recovery index on 3.3', async () => {
      // The adapter is a contract answering the v3.3 MultiAdapter as its entrypoint, which `setAdapters` checks.
      const adapter = '0x8888888888888888888888888888888888888888' as HexString
      const { centrifuge } = setup({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, {}, [adapter])
      const batches = collectBatches(centrifuge)
      await new Pool(centrifuge, pool33Id).setAdapters([
        { centrifugeId: SPOKE, localAdapters: [adapter], remoteAdapters: [adapter] },
        { centrifugeId: 3, localAdapters: [adapter], remoteAdapters: [adapter] },
      ])
      expect(batches.map((b) => b.data.length)).to.deep.equal([1, 1])
      expect(batches.map((b) => b.alwaysBatch)).to.deep.equal([undefined, undefined])
      expect(batches[0]!.data[0]).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'setAdapters',
          args: [pool33Id.raw, SPOKE, [adapter], [addressToBytes32(adapter)], 1, signer],
        })
      )
    })

    describe('setting adapters under a policy that refuses a network', () => {
      const adapter = '0x8888888888888888888888888888888888888888' as HexString
      const networks = [SPOKE, 3, 9].map((centrifugeId) => ({
        centrifugeId,
        localAdapters: [adapter],
        remoteAdapters: [adapter],
      }))
      const setAdaptersFor = (centrifugeId: number) =>
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'setAdapters',
          args: [pool33Id.raw, centrifugeId, [adapter], [addressToBytes32(adapter)], 1, signer],
        })

      it('judges every network before it signs the first, so a refusal leaves the adapters as they were', async () => {
        const { centrifuge } = setup({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, {}, [adapter])
        const sent = collectSigned(centrifuge)
        const classify = sinon
          .stub(centrifuge, '_classifyHubCalls')
          .callsFake(async (_signer, calls) => calls.filter((call) => call.data === setAdaptersFor(9)).map(refusal))

        await new Pool(centrifuge, pool33Id).setAdapters(networks)

        expect(classify.firstCall.args[1].map((call) => call.data)).to.deep.equal([
          setAdaptersFor(SPOKE),
          setAdaptersFor(3),
          setAdaptersFor(9),
        ])
        expect(sent).to.deep.equal([])
      })

      it('lists every network in the status in the order they would be set, with the verdict of each', async () => {
        const { centrifuge } = setup({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, {}, [adapter])
        const statuses: unknown[] = []
        collectSigned(centrifuge, statuses)
        sinon
          .stub(centrifuge, '_classifyHubCalls')
          .callsFake(async (_signer, calls) => calls.filter((call) => call.data === setAdaptersFor(9)).map(refusal))

        await new Pool(centrifuge, pool33Id).setAdapters(networks)

        const [status] = statuses as OperationOutOfPolicyStatus[]
        expect(statuses).to.have.length(1)
        expect(status!.type).to.equal('OutOfPolicy')
        expect(status!.batch).to.deep.equal([
          { data: setAdaptersFor(SPOKE), status: 'ready', deferred: false },
          { data: setAdaptersFor(3), status: 'ready', deferred: false },
          { data: setAdaptersFor(9), status: 'needs-authorization', deferred: false },
        ])
      })

      it('stops at the network that is refused when it is judged again, and signs no later one', async () => {
        const { centrifuge } = setup({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, {}, [adapter])
        const sent = collectSigned(centrifuge)
        const classify = sinon.stub(centrifuge, '_classifyHubCalls').resolves([])
        // The policy changed after the first judgement: the second network is refused on its own.
        classify.callsFake(async (_signer, calls) =>
          calls.length === 1 && calls[0]!.data === setAdaptersFor(3) ? [refusal(calls[0]!)] : []
        )

        await new Pool(centrifuge, pool33Id).setAdapters(networks)

        expect(sent.map((tx) => tx.calls)).to.deep.equal([[setAdaptersFor(SPOKE)]])
      })
    })

    it('notifies renamed share metadata with the v3.3 extra gas argument', async () => {
      const { centrifuge, build } = setup()
      const pool = new Pool(centrifuge, pool33Id)
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(centrifuge, 'pool').returns(thenable(pool) as any)
      sinon
        .stub(pool, 'details')
        .returns(
          thenable({ id: pool33Id, shareClasses: [{ details: { id: scId33, name: 'Old', symbol: 'OLD' } }] }) as any
        )
      sinon.stub(pool, 'metadata').returns(thenable(null) as any)
      sinon.stub(pool, 'activeNetworks').returns(thenable([network]) as any)
      sinon.stub(network, 'details').returns(thenable({ activeShareClasses: [{ id: scId33, shareClass }] }) as any)
      const built = await build(pool.update(null, [{ id: scId33, tokenName: 'New', symbolName: 'NEW' } as any]))
      expect(built.calls.map((c) => c.data)).to.include(
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifyShareMetadata',
          args: [pool33Id.raw, scId33.raw, SPOKE, 0n, signer],
        })
      )
    })

    it('withdraws from the v3.3 Spoke, which absorbed the balance sheet', async () => {
      const { centrifuge, build } = setup({ idToAsset: [asset, 0n] })
      const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
      const built = await build(
        new BalanceSheet(centrifuge, network, shareClass).withdraw(spokeAssetId, who, new Balance(5n, 6))
      )
      const spoke33 = ctx(pool33Id, '3.3', SPOKE)
      expect(built.to.toLowerCase()).to.equal(spoke33.addresses.spoke!.toLowerCase())
      expect(built.data).to.equal(
        builders.withdrawHolding(spoke33, {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          asset: { assetId: spokeAssetId.toString(), address: asset, assetTokenId: '0' },
          amount: '5',
          receiverAddress: who,
        } as any).data
      )
    })

    it('deposits into the v3.3 Spoke, reading the asset from SpokeRegistry', async () => {
      const { centrifuge, readContract } = setup({ idToAsset: [asset, 0n] })
      const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
      sinon.stub(centrifuge, '_allowance').resolves(10n ** 18n)
      const writeContract = sinon.stub().resolves('0x1')
      sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
        (async () => {
          const generator = callback({
            isBatching: false,
            signingAddress: signer,
            centrifugeId,
            signer: {},
            walletClient: { writeContract },
            publicClient: {
              getCode: async () => undefined,
              waitForTransactionReceipt: async () => ({ status: 'success' }),
            },
            root: centrifuge,
          })
          while (!(await generator.next()).done) {
            /* consume statuses */
          }
        })()) as any)
      await new BalanceSheet(centrifuge, network, shareClass).deposit(spokeAssetId, new Balance(5n, 6))
      const spoke33 = ctx(pool33Id, '3.3', SPOKE)
      expect(readContract.firstCall.args[0].address.toLowerCase()).to.equal(
        spoke33.addresses.spokeRegistry!.toLowerCase()
      )
      const sent = writeContract.firstCall.args[0]
      expect(sent.address.toLowerCase()).to.equal(spoke33.addresses.spoke!.toLowerCase())
      expect(encodeFunctionData(sent)).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_3.Spoke,
          functionName: 'deposit',
          args: [pool33Id.raw, scId33.raw, asset, 0n, 5n],
        })
      )
    })

    const submitQueued = (poolId: PoolId, scId: ShareClassId) =>
      encodeFunctionData({
        abi: ABIS_V3_3.Spoke,
        functionName: 'submitQueuedAssets',
        args: [poolId.raw, scId.raw, spokeAssetId.raw, 0n, signer],
      })

    describe('queued deltas', () => {
      const idleAssetId = AssetId.from(SPOKE, 2)

      /** Asset 1 has a queued deposit of 5 and asset 2 nothing; `shareDelta` is the queued share delta. */
      function setupQueue(shareDelta: bigint, isPositive = true) {
        const { centrifuge, build, readContract } = setup(
          {
            idToAsset: [asset, 0n],
            decimals: 18,
            queuedAssets: ([, , assetId]: [bigint, string, bigint]) =>
              assetId === spokeAssetId.raw ? [5n, 0n] : [0n, 0n],
            queuedShares: [shareDelta, isPositive, 1, 0n],
          },
          { disableRepeatOnEvents: true }
        )
        sinon.stub(centrifuge, 'currency').returns(thenable({ decimals: 6 }) as any)
        return { centrifuge, build, readContract }
      }

      const readsOf = (readContract: sinon.SinonStub, functionName: string) =>
        readContract.getCalls().filter((call) => call.args[0].functionName === functionName)

      it('submits each queued asset and the share delta from the v3.3 Spoke, reading SnapshotQueue', async () => {
        const { centrifuge, build, readContract } = setupQueue(3n)
        const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
        sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
        const built = await build(
          new BalanceSheet(centrifuge, network, shareClass).submitQueued([spokeAssetId, idleAssetId])
        )
        const spoke33 = ctx(pool33Id, '3.3', SPOKE)
        for (const call of [...readsOf(readContract, 'queuedAssets'), ...readsOf(readContract, 'queuedShares')]) {
          expect(call.args[0].address.toLowerCase()).to.equal(spoke33.addresses.snapshotQueue!.toLowerCase())
        }
        expect(built.to.toLowerCase()).to.equal(spoke33.addresses.spoke!.toLowerCase())
        expect(built.data).to.equal(
          encodeBatchCalldata([
            submitQueued(pool33Id, scId33),
            encodeFunctionData({
              abi: ABIS_V3_3.Spoke,
              functionName: 'submitQueuedShares',
              args: [pool33Id.raw, scId33.raw, 0n, signer],
            }),
          ])
        )
        expect(built.messages).to.deep.equal({
          [HUB]: [
            { type: MessageType.UpdateHoldingAmount, poolId: pool33Id },
            { type: MessageType.UpdateShares, poolId: pool33Id },
          ],
        })
      })

      it('submits from the v3.2 BalanceSheet, which holds its own queue', async () => {
        const { centrifuge, build, readContract } = setupQueue(0n)
        const { pool, shareClass, network } = entities(centrifuge, pool32Id, scId32)
        sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
        const built = await build(new BalanceSheet(centrifuge, network, shareClass).submitQueued([spokeAssetId]))
        const balanceSheet32 = ctx(pool32Id, '3.2', SPOKE).addresses.balanceSheet!.toLowerCase()
        expect(readsOf(readContract, 'queuedAssets')[0]!.args[0].address.toLowerCase()).to.equal(balanceSheet32)
        expect(built.to.toLowerCase()).to.equal(balanceSheet32)
        expect(built.data).to.equal(
          encodeFunctionData({
            abi: ABIS_V3_2.BalanceSheet,
            functionName: 'submitQueuedAssets',
            args: [pool32Id.raw, scId32.raw, spokeAssetId.raw, 0n, signer],
          })
        )
        expect(built.messages).to.deep.equal({ [HUB]: [{ type: MessageType.UpdateHoldingAmount, poolId: pool32Id }] })
      })

      it('refuses to send an empty submit', async () => {
        const { centrifuge, build } = setupQueue(0n)
        const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
        sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
        let error: any
        try {
          await build(new BalanceSheet(centrifuge, network, shareClass).submitQueued([idleAssetId]))
        } catch (e) {
          error = e
        }
        expect(error?.message).to.match(/Nothing is queued/)
      })

      it('refuses a signer that is not a balance sheet manager', async () => {
        const { centrifuge, build } = setupQueue(3n)
        const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
        sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(false) as any)
        let error: any
        try {
          await build(new BalanceSheet(centrifuge, network, shareClass).submitQueued([spokeAssetId]))
        } catch (e) {
          error = e
        }
        expect(error?.message).to.match(/not a BalanceSheetManager/)
      })

      it('submits a repeated asset once', async () => {
        const { centrifuge, build, readContract } = setupQueue(0n)
        const { pool, shareClass, network } = entities(centrifuge, pool33Id, scId33)
        sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
        const built = await build(
          new BalanceSheet(centrifuge, network, shareClass).submitQueued([spokeAssetId, spokeAssetId])
        )
        expect(readsOf(readContract, 'queuedAssets')).to.have.length(1)
        expect(built.data).to.equal(submitQueued(pool33Id, scId33))
        expect(built.messages).to.deep.equal({ [HUB]: [{ type: MessageType.UpdateHoldingAmount, poolId: pool33Id }] })
      })

      it('reads the queue per asset in the asset decimals, and the signed share delta in the pool decimals', async () => {
        const { centrifuge } = setupQueue(3n, false)
        const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
        const queue = await firstValueFrom(
          new BalanceSheet(centrifuge, network, shareClass).queued([spokeAssetId, idleAssetId])
        )
        expect(queue.shares).to.deep.equal({ delta: new Balance(3n, 18), isPositive: false })
        expect(
          queue.assets.map(({ assetId, deposits, withdrawals }) => [assetId, deposits, withdrawals])
        ).to.deep.equal([
          [spokeAssetId, new Balance(5n, 6), new Balance(0n, 6)],
          [idleAssetId, new Balance(0n, 6), new Balance(0n, 6)],
        ])
      })

      it('refuses an asset from another network', async () => {
        const { centrifuge } = setupQueue(0n)
        const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
        let error: any
        try {
          await firstValueFrom(new BalanceSheet(centrifuge, network, shareClass).queued([AssetId.from(HUB, 1)]))
        } catch (e) {
          error = e
        }
        expect(error?.message).to.match(/not on this balance sheet's centrifugeId/)
      })
    })

    it('approves redeems and revokes through Hub.managerCall, and notifies in a second transaction', async () => {
      const { centrifuge } = setup({ policy: zeroAddress })
      const sent = collectSigned(centrifuge)
      const { shareClass } = redeemShareClass(centrifuge)
      await shareClass.approveRedeemsAndRevokeShares([
        {
          assetId: spokeAssetId,
          approveShareAmount: new Balance(500n, 18),
          approvePricePerAsset: new Balance(10n ** 18n, 18),
        },
      ] as any)
      await shareClass.approveRedeemsAndRevokeShares([{ assetId: spokeAssetId, revokePricePerShare: price }] as any)

      const hub33 = ctx(pool33Id, '3.3')
      const hub = hub33.addresses.hub!.toLowerCase()
      expect(sent.map((tx) => tx.to)).to.deep.equal([hub, hub, hub33.addresses.batchRequestManager!.toLowerCase()])
      expect(sent[0]!.calls).to.deep.equal(
        builders
          .approveRedeems(hub33, {
            poolId: pool33Id.raw.toString(),
            scId: scId33.raw,
            approvals: [
              {
                assetId: spokeAssetId.toString(),
                epochId: '5',
                approvedShareAmount: '500',
                pricePoolPerAsset: (10n ** 18n).toString(),
              },
            ],
          })
          .calls!.map((c) => c.data)
      )
      expect(sent[1]!.calls).to.deep.equal(
        builders
          .revokeShares(hub33, {
            poolId: pool33Id.raw.toString(),
            scId: scId33.raw,
            revocations: [
              { assetId: spokeAssetId.toString(), fromEpochId: '4', pricesPoolPerShare: [(10n ** 18n).toString()] },
            ],
            refundAddress: signer,
          })
          .calls!.map((c) => c.data)
      )
      expect(sent[2]!.calls).to.deep.equal(
        builders
          .notifyOrderClaims(hub33, {
            poolId: pool33Id.raw.toString(),
            scId: scId33.raw,
            kind: 'redeem',
            notify: [
              {
                assetId: spokeAssetId.toString(),
                notifications: [
                  { investor: who, maxClaims: 1, requestId: hexToBigInt(addressToBytes32(who)).toString() },
                ],
              },
            ],
            refundAddress: signer,
          })
          .calls!.map((c) => c.data)
      )
    })

    it('refuses to build a v3.3 revoke that has claims to notify, and builds it with notify: false', async () => {
      const { centrifuge, build } = setup()
      const { shareClass } = redeemShareClass(centrifuge)
      await expectRefusal(
        build(shareClass.approveRedeemsAndRevokeShares([{ assetId: spokeAssetId, revokePricePerShare: price }] as any))
      )
      const built = await build(
        shareClass.approveRedeemsAndRevokeShares([{ assetId: spokeAssetId, revokePricePerShare: price }] as any, {
          notify: false,
        })
      )
      expect(built.to.toLowerCase()).to.equal(ctx(pool33Id, '3.3').addresses.hub!.toLowerCase())
      expect(built.calls).to.have.length(1)
    })

    it('issues shares with claims: the hub batch, then the notifications on the manager', async () => {
      const { centrifuge } = setup({ policy: zeroAddress })
      const sent = collectSigned(centrifuge)
      const { shareClass } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 4, issueEpoch: 3 }],
        }) as any
      )
      sinon
        .stub(shareClass, '_investOrders')
        .returns(of({ investOrders: [{ assetId: spokeAssetId, investor: who }] }) as any)
      sinon
        .stub(shareClass, '_investorOrder')
        .returns(thenable({ assetId: spokeAssetId, investor: who, pendingDeposit: 10n, maxDepositClaims: 2 }) as any)
      await shareClass.approveDepositsAndIssueShares([{ assetId: spokeAssetId, issuePricePerShare: price }] as any)

      const hub33 = ctx(pool33Id, '3.3')
      expect(sent).to.have.length(2)
      expect(sent[0]!.calls).to.deep.equal(
        builders
          .issueShares(hub33, {
            poolId: pool33Id.raw.toString(),
            scId: scId33.raw,
            issuances: [
              { assetId: spokeAssetId.toString(), fromEpochId: '3', pricesPoolPerShare: [(10n ** 18n).toString()] },
            ],
            refundAddress: signer,
          })
          .calls!.map((c) => c.data)
      )
      expect(sent[1]!.to).to.equal(hub33.addresses.batchRequestManager!.toLowerCase())
      expect(sent[1]!.calls).to.deep.equal(
        builders
          .notifyOrderClaims(hub33, {
            poolId: pool33Id.raw.toString(),
            scId: scId33.raw,
            kind: 'deposit',
            notify: [
              {
                assetId: spokeAssetId.toString(),
                notifications: [
                  { investor: who, maxClaims: 3, requestId: hexToBigInt(addressToBytes32(who)).toString() },
                ],
              },
            ],
            refundAddress: signer,
          })
          .calls!.map((c) => c.data)
      )
    })

    it('stops after a refused issue: the claim notifications are never signed or sent', async () => {
      const { centrifuge } = setup({ policy: zeroAddress })
      const sent = collectSigned(centrifuge)
      const classify = refuseEveryCall(centrifuge)
      const { shareClass } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 4, issueEpoch: 3 }],
        }) as any
      )
      sinon
        .stub(shareClass, '_investOrders')
        .returns(of({ investOrders: [{ assetId: spokeAssetId, investor: who }] }) as any)
      sinon
        .stub(shareClass, '_investorOrder')
        .returns(thenable({ assetId: spokeAssetId, investor: who, pendingDeposit: 10n, maxDepositClaims: 2 }) as any)

      await shareClass.approveDepositsAndIssueShares([{ assetId: spokeAssetId, issuePricePerShare: price }] as any)

      expect(classify.callCount).to.equal(1)
      expect(sent).to.deep.equal([])
    })

    it('stops after a refused revoke: the claim notifications are never signed or sent', async () => {
      const { centrifuge } = setup({ policy: zeroAddress })
      const sent = collectSigned(centrifuge)
      const classify = refuseEveryCall(centrifuge)
      const { shareClass } = redeemShareClass(centrifuge)

      await shareClass.approveRedeemsAndRevokeShares([{ assetId: spokeAssetId, revokePricePerShare: price }] as any)

      expect(classify.callCount).to.equal(1)
      expect(sent).to.deep.equal([])
    })

    it('reads the deployed OnchainPM from the renamed v3.3 deploy event argument', async () => {
      const { centrifuge } = setup()
      const onchainPM = '0x9999999999999999999999999999999999999999' as HexString
      const spoke33 = ctx(pool33Id, '3.3', SPOKE)
      const factory = spoke33.addresses.onchainPMFactory!
      const { encodeEventTopics, encodeAbiParameters } = await import('viem')
      const topics = encodeEventTopics({
        abi: ABIS_V3_3.OnchainPMFactory,
        eventName: 'DeployOnchainPM',
        args: { poolId: pool33Id.raw, onchainPM },
      })
      const statuses: unknown[] = []
      sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
        (async () => {
          const generator = callback({
            isBatching: false,
            signingAddress: signer,
            centrifugeId,
            walletClient: { writeContract: sinon.stub().resolves('0x1') },
            publicClient: {
              readContract: async () => '0x0000000000000000000000000000000000000000',
              getCode: async () => undefined,
              waitForTransactionReceipt: async () => ({
                status: 'success',
                logs: [{ address: factory.toLowerCase(), topics, data: encodeAbiParameters([], []) }],
              }),
            },
            root: centrifuge,
          })
          for await (const status of generator) statuses.push(status)
        })()) as any)
      // Built after the stub, because entities bind `_transact` when they are constructed.
      await new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), SPOKE).deployOnchainPM()
      expect(statuses.at(-1)).to.deep.equal({ type: 'DeployedOnchainPM', address: onchainPM })
    })
  })

  describe('pre-3.3 vaults on a 3.3 pool', () => {
    function vaultWith(read: () => Promise<unknown>) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon
        .stub(centrifuge as any, '_poolRows')
        .returns(of([{ id: pool33Id.toString(), protocolVersion: '3.3', migrationStatus: 'live' }]))
      stubMigrationRows(centrifuge)
      stubChain(centrifuge, { readContract: sinon.stub().callsFake(read) })
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      return new Vault(centrifuge, network, shareClass, asset, token, spokeAssetId)
    }
    const revert = () => {
      const abi = ABIS_V3_2.AsyncVault
      throw new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi, functionName: 'vaultKind' }), {
        abi,
        functionName: 'vaultKind',
      })
    }

    it('reads a vault that still answers vaultKind() with the v3.2 vault ABI', async () => {
      expect(await vaultWith(async () => 0)._vaultVersion()).to.equal('3.2')
    })

    it('reads a vault that refuses vaultKind() as a v3.3 vault', async () => {
      expect(await vaultWith(async () => revert())._vaultVersion()).to.equal('3.3')
    })

    it('surfaces a failed read instead of guessing the version', async () => {
      let error: unknown
      try {
        await vaultWith(async () => {
          throw new Error('rpc down')
        })._vaultVersion()
      } catch (e) {
        error = e
      }
      expect((error as Error).message).to.equal('rpc down')
    })
  })

  describe('review follow-ups', () => {
    it('routes a hook and a valuation in one batch, both as v3.3 manager calls', async () => {
      const { centrifuge, build } = setup({ shareTokenAndRegistrar: [token, registrar] })
      const built = await build(
        entities(centrifuge, pool33Id, scId33).shareClass.updateHookAndValuation(SPOKE, valuation, who)
      )
      const hub33 = ctx(pool33Id, '3.3')
      const managerCall = (target: string, payload: HexString, label: string) =>
        builders.hubManagerCall(hub33, {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target,
          payload,
          label,
          refundAddress: signer,
        }).data
      expect(built.calls.map((c) => c.data)).to.deep.equal([
        managerCall(
          registrar,
          encodeShareTokenRegistrarPayload({ kind: 'setHook', scId: scId33.raw, hook: valuation }),
          'ShareTokenRegistrar.SetHook'
        ),
        managerCall(
          ctx(pool33Id, '3.3', SPOKE).addresses.syncManager!,
          encodeSyncManagerPayload({ kind: 'valuation', scId: scId33.raw, valuation: who }),
          'SyncManager.Valuation'
        ),
      ])
      expect(built.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id), managerCallMessage(pool33Id)] })
    })

    it('refuses a raw v3.2 contract update on 3.3', async () => {
      const { centrifuge, build } = setup()
      await expectRefusal(
        build(entities(centrifuge, pool33Id, scId33).shareClass._updateContract(SPOKE, ramp, '0x1234'))
      )
    })

    it('deploys a sync-deposit vault with the max reserve manager call before the price notification', async () => {
      const vaultAddress = '0x7777777777777777777777777777777777777777' as HexString
      const hubAsset = AssetId.from(HUB, 1)
      const { centrifuge, build } = setup({
        manager: true,
        requestManager: who,
        idToAsset: [asset, 0n],
        shareToken: token,
        getVault: vaultAddress,
      })
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), HUB)
      sinon
        .stub(network, 'details')
        .returns(thenable({ isActive: true, activeShareClasses: [{ id: scId33, vaults: [] }] }) as any)
      const built = await build(network.deploy([], [{ shareClassId: scId33, assetId: hubAsset, kind: 'syncDeposit' }]))
      const hub33 = ctx(pool33Id, '3.3')
      const expected = builders.deployVault(hub33, {
        poolId: pool33Id.raw.toString(),
        scId: scId33.raw,
        assetId: hubAsset.toString(),
        kind: 'syncDeposit',
        refundAddress: signer,
        spoke: ctx(pool33Id, '3.3', HUB),
        vaultAddress,
      })
      expect(built.calls.map((c) => c.data)).to.deep.equal(expected.calls!.map((c) => c.data))
    })

    it('reads holding accounts from the v3.3 AccountKind slots', async () => {
      const slots: Record<number, bigint> = { 0: 11n, 1: 22n, 2: 33n, 3: 44n }
      const { centrifuge } = setup({
        valuation,
        amount: 5n,
        value: 7n,
        accountId: (args: readonly unknown[]) => slots[Number(args[3])] ?? 0n,
      })
      const { shareClass, pool } = entities(centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'currency').returns(thenable({ decimals: 18 }) as any)
      sinon.stub(centrifuge, '_assetDecimals').returns(thenable(6) as any)
      const holding = await firstValueFrom(shareClass._holding(spokeAssetId))
      expect(holding.isLiability).to.equal(false)
      expect(holding.accounts).to.deep.equal({
        [AccountType.Asset]: 11n,
        [AccountType.Equity]: 22n,
        [AccountType.Loss]: 44n,
        [AccountType.Gain]: 33n,
        [AccountType.Expense]: null,
        [AccountType.Liability]: null,
      })
    })

    it('prices a pool adapter update on the pool’s own version, and on 3.3 over its own adapter set', () => {
      const descriptor = { type: MessageType.SetPoolAdapters, poolId: pool33Id } as const
      expect(emptyMessage(descriptor, '3.2')).to.equal(protocolEmptyMessage(MessageType.SetPoolAdapters))
      expect(emptyMessage(descriptor, '3.3')).to.equal(
        emptyMessageV3_3(MessageTypeV3_3.SetPoolAdapters, pool33Id.raw.toString())
      )
    })

    it('estimates a NotifyShareClass at its v3.3 minimum wire size', () => {
      const message = emptyMessage({ type: MessageType.NotifyShareClass, poolId: pool33Id }, '3.3')
      expect((message.length - 2) / 2).to.equal(268)
    })
  })

  describe('pool', () => {
    it('updates balance sheet managers with Hub.updateManager(spoke) on 3.3 and keeps 3.2 beside it', async () => {
      const { centrifuge, build } = setup()
      const update = [{ centrifugeId: SPOKE, address: who, canManage: true }]
      const built33 = await build(new Pool(centrifuge, pool33Id).updateBalanceSheetManagers(update))
      expect(built33.data).to.equal(
        builders.updateManager(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          kind: 'spoke',
          address: who,
          canManage: true,
          refundAddress: signer,
        }).data
      )
      expect(built33.messages).to.deep.equal({
        [SPOKE]: [messageV3_3(MessageTypeV3_3.UpdateManager, pool33Id)],
      })

      const built32 = await build(new Pool(centrifuge, pool32Id).updateBalanceSheetManagers(update))
      expect(built32.data).to.equal(
        encodeFunctionData({
          abi: ABIS_V3_2.Hub,
          functionName: 'updateBalanceSheetManager',
          args: [pool32Id.raw, SPOKE, addressToBytes32(who), true, signer],
        })
      )
      expect(built32.to.toLowerCase()).to.not.equal(built33.to.toLowerCase())
    })

    it('updates an OracleValuation feeder as a local managerCall on 3.3', async () => {
      const { centrifuge, build } = setup()
      const built = await build(new Pool(centrifuge, pool33Id).updateOracleValuationFeeder(valuation, SPOKE, who, true))
      expect(decodeFunctionData({ abi: ABIS_V3_3.Hub, data: built.data }).args).to.deep.equal([
        pool33Id.raw,
        HUB,
        addressToBytes32(valuation),
        encodeOracleValuationFeederPayload({ centrifugeId: String(SPOKE), feeder: who, canFeed: true }),
        0n,
        0n,
        getAddress(signer),
      ])
    })
  })

  describe('balance sheet', () => {
    function balanceSheet(reads: Record<string, unknown>, isHubManager = true) {
      const subject = setup(reads)
      const { pool, shareClass, network } = entities(subject.centrifuge, pool33Id, scId33)
      sinon.stub(pool, 'isPoolManager').returns(thenable(isHubManager) as any)
      return { ...subject, sheet: new BalanceSheet(subject.centrifuge, network, shareClass) }
    }

    it('issues through the spoke ShareManager from the hub on 3.3', async () => {
      const { sheet, build } = balanceSheet({ manager: true })
      const built = await build(sheet.issue(who, new Balance(10n, 18), Price.fromFloat(0)))
      expect(built.centrifugeId).to.equal(HUB)
      expect(built.data).to.equal(
        builders.shareManagerCall(ctx(pool33Id, '3.3'), ctx(pool33Id, '3.3', SPOKE), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          kind: 'issue',
          account: who,
          shares: '10',
          refundAddress: signer,
        }).data
      )
      expect(built.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id)] })
    })

    it('revokes from the holder itself on 3.3, with no custodian, carrying the extra gas a remote revoke needs', async () => {
      const { sheet, build } = balanceSheet({ manager: true })
      const built = await build(sheet.revoke(who, new Balance(7n, 18), Price.fromFloat(0)))
      expect(built.data).to.equal(
        builders.shareManagerCall(ctx(pool33Id, '3.3'), ctx(pool33Id, '3.3', SPOKE), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          kind: 'revoke',
          account: who,
          shares: '7',
          refundAddress: signer,
          extraGasLimit: '300000',
        }).data
      )
      expect(built.messages).to.deep.equal({
        [SPOKE]: [{ ...managerCallMessage(pool33Id), extraGasLimit: SHARE_REVOKE_EXTRA_GAS }],
      })
    })

    it('prices the remote revoke message with the extra gas where MessageLib reads it', async () => {
      const { sheet, build } = balanceSheet({ manager: true })
      const built = await build(sheet.revoke(who, new Balance(7n, 18), Price.fromFloat(0)))
      const priced = emptyMessage(built.messages![SPOKE]![0]!, '3.3')
      const plain = emptyMessage(managerCallMessage(pool33Id), '3.3')
      expect(priced).to.have.length(plain.length)
      expect(BigInt(`0x${priced.slice(2 + 41 * 2, 2 + 41 * 2 + 32)}`)).to.equal(300_000n)
      expect(`${priced.slice(0, 2 + 41 * 2)}${'0'.repeat(32)}${priced.slice(2 + 41 * 2 + 32)}`).to.equal(plain)
    })

    it('carries no extra gas on a remote issue, nor on a revoke to the hub chain itself', async () => {
      const issued = balanceSheet({ manager: true })
      const issue = await issued.build(issued.sheet.issue(who, new Balance(10n, 18), Price.fromFloat(0)))
      expect(issue.data).to.equal(
        builders.shareManagerCall(ctx(pool33Id, '3.3'), ctx(pool33Id, '3.3', SPOKE), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          kind: 'issue',
          account: who,
          shares: '10',
          refundAddress: signer,
          extraGasLimit: '0',
        }).data
      )
      expect(issue.messages).to.deep.equal({ [SPOKE]: [managerCallMessage(pool33Id)] })

      const onHub = balanceSheet({ manager: true })
      const hubSheet = new BalanceSheet(
        onHub.centrifuge,
        new PoolNetwork(onHub.centrifuge, new Pool(onHub.centrifuge, pool33Id), HUB),
        new ShareClass(onHub.centrifuge, new Pool(onHub.centrifuge, pool33Id), scId33.raw)
      )
      sinon.stub(Pool.prototype, 'isPoolManager').returns(thenable(true) as any)
      const revoke = await onHub.build(hubSheet.revoke(who, new Balance(7n, 18), Price.fromFloat(0)))
      expect(revoke.data).to.equal(
        builders.shareManagerCall(ctx(pool33Id, '3.3'), ctx(pool33Id, '3.3', HUB), {
          poolId: pool33Id.raw.toString(),
          scId: scId33.raw,
          kind: 'revoke',
          account: who,
          shares: '7',
          refundAddress: signer,
          extraGasLimit: '0',
        }).data
      )
      expect(revoke.messages).to.deep.equal({ [HUB]: [managerCallMessage(pool33Id)] })
    })

    it('refuses before signing when ShareManager is not a spoke manager of the pool', async () => {
      const { sheet, build } = balanceSheet({ manager: false })
      let error: unknown
      try {
        await build(sheet.issue(who, new Balance(10n, 18), Price.fromFloat(0)))
      } catch (e) {
        error = e
      }
      expect((error as Error).message).to.match(/ShareManager .* is not a balance sheet manager/)
    })
  })

  describe('on/off-ramp', () => {
    it('sets a receiver with the v3.3 Offramp manager call', async () => {
      const { centrifuge, build } = setup({ accountingToken: () => legacyRamp() })
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      const manager = new OnOffRampManager(centrifuge, network, shareClass, ramp)
      const built = await build(manager.setReceiver(spokeAssetId, who, true))
      expect(built.data).to.equal(
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: ramp,
          payload: encodeOnOffRampPayload({
            kind: 'offramp',
            assetId: spokeAssetId.toString(),
            receiver: who,
            enabled: true,
          }),
          label: 'OnOffRamp.offramp',
          refundAddress: signer,
        }).data
      )
    })

    it('appends notifyAssetPrice to the managerCall for a ramp that deposits an accounting token on 3.3', async () => {
      const accountingAssetId = AssetId.from(SPOKE, 7)
      const accountingToken = defaultDeploymentRegistry().getDeployment('testnet', '3.3', SPOKE).contracts
        .accountingToken!
      const { centrifuge, build, readContract } = setup({
        accountingToken: () => accountingToken,
        idToAsset: () => [asset, 0n],
        assetToId: (args: readonly unknown[]) => {
          expect(args).to.deep.equal([accountingToken, toAccountingTokenId(pool33Id.raw, asset, true)])
          return accountingAssetId.raw
        },
        isRegistered: () => true,
      })
      const { shareClass, network } = entities(centrifuge, pool33Id, scId33)
      const spoke33 = await centrifuge.protocolContext({ poolId: pool33Id, centrifugeId: SPOKE })
      const hub33 = await centrifuge.protocolContext(pool33Id)
      const manager = new OnOffRampManager(centrifuge, network, shareClass, ramp)

      const built = await build(manager.setAsset(spokeAssetId))

      expect(built.calls.map((c) => c.data)).to.deep.equal([
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: ramp,
          payload: encodeOnOffRampPayload({ kind: 'onramp', assetId: spokeAssetId.toString(), enabled: true }),
          label: 'OnOffRamp.onramp',
          refundAddress: signer,
        }).data,
        encodeFunctionData({
          abi: ABIS_V3_3.Hub,
          functionName: 'notifyAssetPrice',
          args: [pool33Id.raw, scId33.raw, accountingAssetId.raw, signer],
        }),
      ])
      const readAddress = (name: string) =>
        readContract.getCalls().find((call) => call.args[0].functionName === name)!.args[0].address
      expect(readAddress('assetToId')).to.equal(spoke33.spokeRegistry)
      expect(readAddress('isRegistered')).to.equal(hub33.hubRegistry)
    })

    it('grants accounting-token minter rights with a managerCall when authorizing an OnchainPM on 3.3', async () => {
      const { centrifuge, build } = setup()
      const { network } = entities(centrifuge, pool33Id, scId33)
      const built = await build(network.authorizeOnchainPM(ramp, scId33.raw))
      const spoke33 = ctx(pool33Id, '3.3', SPOKE)
      expect(built.calls.map((call) => call.data)).to.deep.equal([
        builders.updateManager(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          kind: 'spoke',
          address: ramp,
          canManage: true,
          refundAddress: signer,
        }).data,
        builders.hubManagerCall(ctx(pool33Id, '3.3'), {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: spoke33.addresses.accountingToken!,
          payload: encodeAccountingTokenMinterPayload({ minter: ramp, canMint: true }),
          label: 'AccountingToken.UpdateMinter',
          refundAddress: signer,
        }).data,
      ])
      expect(built.messages).to.deep.equal({
        [SPOKE]: [messageV3_3(MessageTypeV3_3.UpdateManager, pool33Id), managerCallMessage(pool33Id)],
      })
    })
  })

  describe('OnchainPM policy', () => {
    it('buildPolicyUpdate encodes Hub.managerCall with the (strategist, root) payload on 3.3', async () => {
      const hub33 = ctx(pool33Id, '3.3')
      const { root, calldata } = await buildPolicyUpdate({
        hub: hub33.addresses.hub!,
        abis: ABIS_V3_2,
        protocolVersion: '3.3',
        poolId: pool33Id.raw,
        scId: scId33.raw,
        centrifugeId: SPOKE,
        onchainPM: ramp,
        strategist: who,
        scriptHashes: [],
        refund: signer,
      })
      const decoded = decodeFunctionData({ abi: ABIS_V3_3.Hub, data: calldata })
      expect(decoded.functionName).to.equal('managerCall')
      expect(decoded.args).to.deep.equal([
        pool33Id.raw,
        SPOKE,
        addressToBytes32(ramp),
        encodeOnchainPMPolicyPayload({ strategist: who, root }),
        0n,
        0n,
        getAddress(signer),
      ])
    })
  })

  describe('vault deploy', () => {
    it('refuses a vault for a share class deployed in the same call, which has no token to point yet', async () => {
      // On the hub's own chain, so no adapter wiring is read from the indexer.
      const { centrifuge, build } = setup({ manager: true, requestManager: who })
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), HUB)
      sinon.stub(network, 'details').returns(thenable({ isActive: true, activeShareClasses: [] }) as any)
      await expectRefusal(
        build(
          network.deploy(
            [{ id: scId33, hook: valuation }],
            [{ shareClassId: scId33, assetId: AssetId.from(HUB, 1), kind: 'async' }]
          )
        )
      )
    })
  })

  describe('adapter failover on a remote spoke', () => {
    const safe = '0x8888888888888888888888888888888888888888' as HexString
    const noHook = '0x0000000000000000000000000000000000000000' as HexString
    const scId33b = ShareClassId.from(pool33Id, 2)
    const spoke33 = () => ctx(pool33Id, '3.3', SPOKE).addresses
    const adapterFailover = () => spoke33().adapterFailover!
    const isFailover = (args: readonly unknown[]) => String(args[1]).toLowerCase() === adapterFailover().toLowerCase()

    /**
     * The spoke reads `deploy()` makes: every other manager is set, and `AdapterFailover` is the pool's adapter manager
     * when `failoverIsManager`. `safe` is only answered when given, so a read of it otherwise throws.
     */
    function spokeReads(failoverIsManager: boolean, guardianSafe?: HexString) {
      return {
        manager: (args: readonly unknown[]) => (isFailover(args) ? failoverIsManager : true),
        requestManager: who,
        ...(guardianSafe ? { safe: guardianSafe } : {}),
      }
    }

    /** The indexer answers with these pool adapter rows per side and no migration, so nothing leaves the process. */
    function indexer(centrifuge: Centrifuge, onHub: unknown[], onSpoke: unknown[] = onHub) {
      sinon
        .stub(centrifuge as any, '_queryDataOnce')
        .callsFake(async (_name: any, vars: any) => (vars.localCentrifugeId === String(HUB) ? onHub : onSpoke))
    }

    const adapterRow = (name: string) => ({
      adapterAddress: `0x${'0'.repeat(40)}`,
      isEnabled: true,
      crosschainInProgress: null,
      adapter: { name },
    })

    /** The pool's LayerZero adapter is live on both sides, so the deployment is one hub batch. */
    function wired(centrifuge: Centrifuge) {
      indexer(centrifuge, [adapterRow('layerZero')])
    }

    function hubFunctions(calls: { data: HexString }[], abi: typeof ABIS_V3_3.Hub | typeof ABIS_V3_2.Hub) {
      return calls.map((call) => decodeFunctionData({ abi, data: call.data }).functionName)
    }

    function failoverCalls() {
      const hub33 = ctx(pool33Id, '3.3')
      return [
        builders.updateManager(hub33, {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          kind: 'adapter',
          address: adapterFailover(),
          canManage: true,
          refundAddress: signer,
        }).data,
        builders.hubManagerCall(hub33, {
          poolId: pool33Id.raw.toString(),
          centrifugeId: String(SPOKE),
          target: adapterFailover(),
          payload: encodeAdapterFailoverStewardPayload({ who: safe, isSteward: true }),
          label: 'AdapterFailover.UpdateSteward',
          refundAddress: signer,
        }).data,
      ]
    }

    function remoteNetwork(centrifuge: Centrifuge, details: { isActive: boolean; activeShareClasses: unknown[] }) {
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), SPOKE)
      sinon.stub(network, 'details').returns(thenable(details) as any)
      return network
    }

    const firstDeployment = { isActive: false, activeShareClasses: [] }
    const alreadyNotified = { isActive: true, activeShareClasses: [{ id: scId33, vaults: [] }] }

    async function rejection(promise: PromiseLike<unknown>) {
      try {
        await promise
      } catch (e) {
        return e
      }
      throw new Error('expected a refusal')
    }

    it('makes AdapterFailover the adapter manager and ProtocolGuardian.safe() its steward, right after notifyPool', async () => {
      const { centrifuge, build, readContract } = setup(spokeReads(false, safe))
      wired(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)

      const built = await build(network.deploy([{ id: scId33, hook: noHook }], []))

      expect(hubFunctions(built.calls, ABIS_V3_3.Hub)).to.deep.equal([
        'notifyPool',
        'updateManager',
        'managerCall',
        'notifyShareClass',
      ])
      expect(built.calls.slice(1, 3).map((call) => call.data)).to.deep.equal(failoverCalls())
      expect(built.messages).to.deep.equal({
        [SPOKE]: [
          { type: MessageType.NotifyPool, poolId: pool33Id },
          messageV3_3(MessageTypeV3_3.UpdateManager, pool33Id),
          managerCallMessage(pool33Id),
          { type: MessageType.NotifyShareClass, poolId: pool33Id },
        ],
      })
      const reads = readContract.getCalls().map((call) => call.args[0])
      expect(reads.find((read) => read.functionName === 'safe')?.address).to.equal(spoke33().protocolGuardian)
      expect(reads.find((read) => read.functionName === 'manager' && isFailover(read.args))?.address).to.equal(
        spoke33().multiAdapter
      )
    })

    it('builds neither call where AdapterFailover already is the pool adapter manager, and leaves its stewards alone', async () => {
      // No `safe` answer: reading it would throw.
      const { centrifuge, build } = setup(spokeReads(true))
      wired(centrifuge)
      const network = remoteNetwork(centrifuge, alreadyNotified)

      const built = await build(network.deploy([{ id: scId33b, hook: noHook }], []))

      expect(hubFunctions(built.calls, ABIS_V3_3.Hub)).to.deep.equal(['notifyShareClass'])
    })

    it('installs both on a spoke the pool was notified to without them, and does not notify the pool again', async () => {
      const { centrifuge, build } = setup(spokeReads(false, safe))
      wired(centrifuge)
      const network = remoteNetwork(centrifuge, alreadyNotified)

      const built = await build(network.deploy([{ id: scId33b, hook: noHook }], []))

      expect(hubFunctions(built.calls, ABIS_V3_3.Hub)).to.deep.equal([
        'updateManager',
        'managerCall',
        'notifyShareClass',
      ])
      expect(built.calls.slice(0, 2).map((call) => call.data)).to.deep.equal(failoverCalls())
    })

    it('builds neither call on a spoke on the hub chain, where messages never go through adapters', async () => {
      const { centrifuge, build, readContract } = setup(spokeReads(false))
      indexer(centrifuge, [])
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool33Id), HUB)
      sinon.stub(network, 'details').returns(thenable(firstDeployment) as any)

      const built = await build(network.deploy([{ id: scId33, hook: noHook }], []))

      expect(hubFunctions(built.calls, ABIS_V3_3.Hub)).to.deep.equal(['notifyPool', 'notifyShareClass'])
      expect(readContract.getCalls().some((call) => call.args[0].args && isFailover(call.args[0].args))).to.equal(false)
    })

    it('builds the same calls as before for a v3.2 pool, which has no AdapterFailover', async () => {
      const { centrifuge, build } = setup({ manager: true, requestManager: who })
      wired(centrifuge)
      const network = new PoolNetwork(centrifuge, new Pool(centrifuge, pool32Id), SPOKE)
      sinon.stub(network, 'details').returns(thenable(firstDeployment) as any)

      const built = await build(network.deploy([{ id: scId32, hook: noHook }], []))

      expect(hubFunctions(built.calls, ABIS_V3_2.Hub)).to.deep.equal(['notifyPool', 'notifyShareClass'])
    })

    it('refuses with AdapterFailoverStewardMissingError before anything is sent when safe() is the zero address', async () => {
      const { centrifuge } = setup(spokeReads(false, noHook))
      wired(centrifuge)
      const sent = collectSigned(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)

      const error = await rejection(network.deploy([{ id: scId33, hook: noHook }], []))

      expect(error).to.be.instanceOf(AdapterFailoverStewardMissingError)
      expect(error).to.include({
        poolId: pool33Id.toString(),
        centrifugeId: SPOKE,
        protocolGuardian: spoke33().protocolGuardian,
      })
      expect(sent).to.deep.equal([])
    })

    it('refuses a zero safe() before sending the separate setAdapters transaction', async () => {
      const { centrifuge } = setup(spokeReads(false, noHook))
      // No adapters on either side: the deployment would send setAdapters on its own first.
      indexer(centrifuge, [])
      const sent = collectSigned(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)

      const error = await rejection(network.deploy([{ id: scId33, hook: noHook }], []))

      expect(error).to.be.instanceOf(AdapterFailoverStewardMissingError)
      expect(sent).to.deep.equal([])
    })

    it('reports an adapter conflict rather than the steward, without reading safe()', async () => {
      // No `safe` answer: reading it would throw instead of the conflict.
      const { centrifuge, readContract } = setup(spokeReads(false))
      indexer(centrifuge, [adapterRow('axelar')], [])
      const sent = collectSigned(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)

      const error = await rejection(network.deploy([{ id: scId33, hook: noHook }], []))

      expect((error as Error).message).to.match(/has adapters \[axelar\] on the hub/)
      expect(readContract.getCalls().some((call) => call.args[0].functionName === 'safe')).to.equal(false)
      expect(sent).to.deep.equal([])
    })

    it('refuses before setAdapters when the spoke context has no AdapterFailover', async () => {
      const { centrifuge } = setup(spokeReads(false, safe))
      indexer(centrifuge, [])
      const sent = collectSigned(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)
      const spokeContext = await network._protocolContext()
      sinon.stub(network, '_protocolContext').returns(thenable({ ...spokeContext, adapterFailover: undefined }) as any)

      const error = await rejection(network.deploy([{ id: scId33, hook: noHook }], []))

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect((error as Error).message).to.contain('adapterFailover is not deployed')
      expect(sent).to.deep.equal([])
    })

    it('names both calls when the backend deployVault route refuses, without reading safe()', async () => {
      const actions: unknown[] = []
      const centrifuge = new Centrifuge({
        environment: 'testnet',
        dataSource: { query: () => of({}) } as any,
        txStrategy: {
          prepare: (action) => {
            actions.push(action)
            return of({ route: 'custodial', txId: 'tx', signerType: 'fordefi', status: 'pending_approval' })
          },
        },
      })
      stubProjectedPools(centrifuge, [pool33Id], '3.3')
      const reads: Record<string, (args: readonly unknown[]) => unknown> = {
        manager: spokeReads(false).manager,
        requestManager: () => who,
      }
      stubChain(centrifuge, {
        readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
          if (!(functionName in reads)) throw new Error(`unexpected read ${functionName}`)
          return reads[functionName]!(args ?? [])
        },
      })
      wired(centrifuge)
      const network = remoteNetwork(centrifuge, firstDeployment)

      const error = await rejection(
        firstValueFrom(
          network.deployVaults([{ shareClassId: scId33, assetId: spokeAssetId, kind: 'async' }], {
            refundAddress: signer,
          })
        )
      )

      expect((error as Error).message).to.contain('Hub.updateManager making AdapterFailover the adapter manager')
      expect((error as Error).message).to.contain('Hub.managerCall naming ProtocolGuardian.safe() its steward')
      expect(actions).to.deep.equal([])
    })
  })

  describe('merkle proof manager', () => {
    it('stays refused on 3.3', async () => {
      const { centrifuge } = setup()
      const { network } = entities(centrifuge, pool33Id, scId33)
      let error: unknown
      try {
        await network.computeMerkleProofManagerAddress()
      } catch (e) {
        error = e
      }
      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
    })
  })
})
