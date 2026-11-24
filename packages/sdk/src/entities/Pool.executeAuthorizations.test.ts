import { builders, encodeBatchRequestManagerPayload, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, getAddress } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import {
  ctx,
  HUB,
  noHook,
  pool32Id,
  pool33Id,
  scId33,
  scId33b,
  SPOKE,
  spokeAssetId,
  thenable,
  who,
} from '../tests/hubGroup.js'
import {
  adapter,
  argsOf,
  asset,
  callsBuiltBy,
  type Chain,
  deployedClass,
  deployRig,
  delayedOf,
  FIRST_DEPLOYMENT,
  hubAbi,
  inner,
  lastStatus,
  nameOf,
  OTHER_SIGNER,
  recordingWallet,
  registrar,
  rig,
  same,
  type Sent,
  sharePriceRig,
  SIGNER,
  token,
  vaultAddress,
} from '../tests/hubPolicyRig.js'
import type { HexString } from '../types/index.js'
import { Balance, Price } from '../utils/BigInt.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

// The oracle for a rule is the entity's own batch, sent with no policy installed. Its delayed subset is then executed
// with matured authorizations on a scripted hub chain, through a wallet that records what it is asked to send.

const setAdaptersCall = encodeFunctionData({
  abi: hubAbi,
  functionName: 'setAdapters',
  args: [pool33Id.raw, SPOKE, [adapter], [`0x${'11'.repeat(32)}` as HexString], 1, SIGNER],
})

/** Runs an entity's write, then executes the delayed subset of what it sent; returns both, as transactions. */
async function entityThenExecution(
  subject: ReturnType<typeof rig>,
  pool: Pool,
  write: () => PromiseLike<unknown>,
  group: (sent: HexString[]) => HexString[] = delayedOf
) {
  await write()
  const entity = subject.sent.splice(0)
  subject.chain.installed = true
  const batch = entity.flatMap((tx) => inner(tx.data))
  const result = await lastStatus(pool.executeAuthorizations(group(batch)))
  const executed = subject.sent.splice(0)
  return { entity, executed, batch, result }
}

describe('Pool.executeAuthorizations', () => {
  afterEach(() => sinon.restore())

  describe('a share price update', () => {
    const write = (subject: ReturnType<typeof sharePriceRig>) =>
      subject.shareClasses[0]!.updateSharePrice(new Price(10n ** 18n), new Date(1_700_000_000_000))

    it('sends the update as scheduled and a notification for each network the entity notifies, with the entity’s value', async () => {
      const subject = sharePriceRig()

      const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () => write(subject))

      expect(batch.map(nameOf)).to.deep.equal(['updateSharePrice', 'notifySharePrice', 'notifySharePrice'])
      expect(entity[0]!.value > 0n).to.equal(true)
      same(entity, executed)
    })

    it('refunds the notifications to the signer, whoever built the scheduled calldata', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })

      await subject.pool.executeAuthorizations([update])

      const calls = inner(subject.sent[0]!.data)
      expect(calls[0]).to.equal(update)
      expect(calls.slice(1).map((call) => getAddress(argsOf(call)[3]))).to.deep.equal([SIGNER, SIGNER])
    })

    it('notifies after each update, for the share class that update names', async () => {
      const subject = sharePriceRig()
      await subject.shareClasses[0]!.updateSharePrice(new Price(10n ** 18n), new Date(1_700_000_000_000))
      await subject.shareClasses[1]!.updateSharePrice(new Price(2n * 10n ** 18n), new Date(1_700_000_000_000))
      const entity = subject.sent.splice(0)
      subject.chain.installed = true

      await subject.pool.executeAuthorizations(delayedOf(entity.flatMap((tx) => inner(tx.data))))

      const executed = subject.sent.splice(0)
      expect(executed[0]!.value).to.equal(entity[0]!.value + entity[1]!.value)
      expect(inner(executed[0]!.data)).to.deep.equal(entity.flatMap((tx) => inner(tx.data)))
    })

    it('sends a notifySharePrice the group holds once, as scheduled, and rebuilds none for the same network', async () => {
      const subject = sharePriceRig()

      const { entity, executed, batch } = await entityThenExecution(
        subject,
        subject.pool,
        () => write(subject),
        (calls) => calls
      )

      expect(batch.map(nameOf)).to.deep.equal(['updateSharePrice', 'notifySharePrice', 'notifySharePrice'])
      expect(inner(executed[0]!.data)).to.deep.equal(batch)
      same(entity, executed)
    })

    it('rebuilds a notifySharePrice only for the networks the group does not hold one for', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })
      const [held] = await callsBuiltBy(subject, subject.shareClasses[0]!.notifySharePrice(SPOKE))

      await subject.pool.executeAuthorizations([update, held!])

      const calls = inner(subject.sent[0]!.data)
      expect(calls.map((call) => [nameOf(call), argsOf(call)[2]])).to.deep.equal([
        ['updateSharePrice', 10n ** 18n],
        ['notifySharePrice', HUB],
        ['notifySharePrice', SPOKE],
      ])
      expect(calls[2]).to.equal(held)
    })

    it('rebuilds a notifySharePrice for a share class the group holds none for', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })
      const [other] = await callsBuiltBy(subject, subject.shareClasses[1]!.notifySharePrice(SPOKE))

      await subject.pool.executeAuthorizations([update, other!])

      expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal([
        'updateSharePrice',
        'notifySharePrice',
        'notifySharePrice',
        'notifySharePrice',
      ])
    })

    it('reads the networks of a share class once, however many updates of it the group holds', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      const [first, second] = [10n ** 18n, 2n * 10n ** 18n].map((price) =>
        encodeFunctionData({
          abi: hubAbi,
          functionName: 'updateSharePrice',
          args: [pool33Id.raw, scId33.raw, price, 1_700_000_000n],
        })
      )
      const read = sinon.spy(ShareClass.prototype, '_notifySharePriceNetworks')

      await subject.pool.executeAuthorizations([first!, second!])

      expect(read.callCount).to.equal(1)
      expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal([
        'updateSharePrice',
        'notifySharePrice',
        'notifySharePrice',
        'updateSharePrice',
        'notifySharePrice',
        'notifySharePrice',
      ])
    })

    it('notifies no network when the share class is deployed on none', async () => {
      const bare = rig()
      const pool = new Pool(bare.centrifuge, pool33Id)
      sinon.stub(pool, 'activeNetworks').returns(thenable([]) as any)
      bare.chain.installed = true
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })

      await pool.executeAuthorizations([update])

      expect(inner(bare.sent[0]!.data)).to.deep.equal([update])
      expect(bare.sent[0]!.value).to.equal(0n)
    })
  })

  describe('a deployment', () => {
    const hook = who

    it('notifies the pool first where it is not on the network yet, and sends the rest as scheduled with the entity’s value', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)

      const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () =>
        subject.network.deploy([{ id: scId33, hook }], [])
      )

      expect(batch.map(nameOf)).to.deep.equal([
        'notifyPool',
        'updateManager',
        'managerCall',
        'setRequestManager',
        'notifyShareClass',
        'managerCall',
      ])
      expect(entity[0]!.value > 0n).to.equal(true)
      same(entity, executed)
    })

    it('does not notify a pool that is already on the network', async () => {
      const subject = deployRig(deployedClass, { reads: { manager: true, requestManager: who } })

      const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () =>
        subject.network.deploy([{ id: scId33b, hook }], [])
      )

      expect(batch.map(nameOf)).to.not.include('notifyPool')
      same(entity, executed)
    })

    it('notifies the price of the asset right before the vault is linked, and nothing before a link or unlink', async () => {
      const subject = deployRig(deployedClass, {
        reads: {
          manager: true,
          requestManager: who,
          idToAsset: [asset, 0n],
          shareToken: token,
          getVault: vaultAddress,
        },
      })

      const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () =>
        subject.network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'syncDeposit' }])
      )

      expect(batch.map(nameOf)).to.deep.equal(['managerCall', 'notifyAssetPrice', 'updateVault', 'managerCall'])
      same(entity, executed)
    })

    it('sends a notifyAssetPrice the group holds once, as scheduled, and rebuilds none for the same asset', async () => {
      const subject = deployRig(deployedClass, {
        reads: {
          manager: true,
          requestManager: who,
          idToAsset: [asset, 0n],
          shareToken: token,
          getVault: vaultAddress,
        },
      })

      const { entity, executed, batch } = await entityThenExecution(
        subject,
        subject.pool,
        () => subject.network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'syncDeposit' }]),
        (calls) => calls
      )

      expect(batch.map(nameOf)).to.deep.equal(['managerCall', 'notifyAssetPrice', 'updateVault', 'managerCall'])
      expect(inner(executed[0]!.data)).to.deep.equal(batch)
      same(entity, executed)
    })

    it('rebuilds a notifyAssetPrice for an asset the group holds none for', async () => {
      const subject = deployRig(deployedClass, {
        reads: {
          manager: true,
          requestManager: who,
          idToAsset: [asset, 0n],
          shareToken: token,
          getVault: vaultAddress,
        },
      })
      const otherAsset = encodeFunctionData({
        abi: hubAbi,
        functionName: 'notifyAssetPrice',
        args: [pool33Id.raw, scId33.raw, spokeAssetId.raw + 1n, SIGNER],
      })

      const { batch, executed } = await entityThenExecution(
        subject,
        subject.pool,
        () => subject.network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'syncDeposit' }]),
        (calls) => [...delayedOf(calls), otherAsset]
      )

      expect(batch.map(nameOf)).to.deep.equal(['managerCall', 'notifyAssetPrice', 'updateVault', 'managerCall'])
      expect(inner(executed[0]!.data).map(nameOf)).to.deep.equal([
        'managerCall',
        'notifyAssetPrice',
        'updateVault',
        'managerCall',
        'notifyAssetPrice',
      ])
    })

    it('sends a link and an unlink as they were scheduled, with no instant call added', async () => {
      for (const direction of ['link', 'unlink'] as const) {
        const subject = deployRig({
          isActive: true,
          activeShareClasses: [{ id: scId33, vaults: [{ address: vaultAddress }] }],
        })
        sinon.stub(subject.network, 'vaults').returns(thenable([{ address: vaultAddress }]) as any)
        const vault = { shareClassId: scId33, assetId: spokeAssetId, address: vaultAddress }

        const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () =>
          direction === 'link' ? subject.network.linkVaults([vault]) : subject.network.unlinkVaults([vault])
        )

        expect(batch.map(nameOf), direction).to.deep.equal(['updateVault', 'managerCall'])
        same(entity, executed)
        sinon.restore()
      }
    })

    it('notifies the pool to each network before the first call bound for it, and not at the start of the group', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      const hubNetwork = new PoolNetwork(subject.centrifuge, subject.pool, HUB)
      sinon.stub(hubNetwork, 'details').returns(thenable(FIRST_DEPLOYMENT) as any)
      await subject.network.deploy([{ id: scId33, hook: noHook }], [])
      await hubNetwork.deploy([{ id: scId33b, hook: noHook }], [])
      const [toSpoke, toHub] = subject.sent.splice(0).map((tx) => inner(tx.data))
      subject.chain.installed = true

      await subject.pool.executeAuthorizations([...delayedOf(toSpoke!), ...delayedOf(toHub!)])

      expect(inner(subject.sent[0]!.data)).to.deep.equal([...toSpoke!, ...toHub!])
      expect(
        [...toSpoke!, ...toHub!].filter((call) => nameOf(call) === 'notifyPool').map((call) => argsOf(call)[1])
      ).to.deep.equal([SPOKE, HUB])
    })

    it('reads whether the pool is on each network together, before the first call is placed', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      const hubNetwork = new PoolNetwork(subject.centrifuge, subject.pool, HUB)
      sinon.stub(hubNetwork, 'details').returns(thenable(FIRST_DEPLOYMENT) as any)
      await subject.network.deploy([{ id: scId33, hook: noHook }], [])
      await hubNetwork.deploy([{ id: scId33b, hook: noHook }], [])
      const [toSpoke, toHub] = subject.sent.splice(0).map((tx) => inner(tx.data))
      subject.chain.installed = true
      let reading = 0
      let together = 0
      sinon.stub(PoolNetwork.prototype, '_needsNotifyPool').callsFake(async () => {
        together = Math.max(together, ++reading)
        await new Promise((resolve) => setImmediate(resolve))
        reading -= 1
        return true
      })

      await subject.pool.executeAuthorizations([...delayedOf(toSpoke!), ...delayedOf(toHub!)])

      expect(together).to.equal(2)
      expect(inner(subject.sent[0]!.data)).to.deep.equal([...toSpoke!, ...toHub!])
    })

    it('does not notify a pool for a call that deploys nothing', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      const manager = (
        await callsBuiltBy(
          subject,
          subject.pool.updateBalanceSheetManagers([{ centrifugeId: SPOKE, address: who, canManage: true }])
        )
      )[0]!
      subject.chain.installed = true

      await subject.pool.executeAuthorizations([manager])

      expect(inner(subject.sent[0]!.data)).to.deep.equal([manager])
    })

    it('leaves a pool the caller notifies itself alone', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)

      const { entity, executed, batch } = await entityThenExecution(
        subject,
        subject.pool,
        () => subject.network.deploy([{ id: scId33, hook: noHook }], []),
        (calls) => calls
      )

      expect(batch.filter((call) => nameOf(call) === 'notifyPool')).to.have.length(1)
      same(entity, executed)
    })
  })

  describe('setAdapters', () => {
    it('is sent alone, as the entity sends it', async () => {
      const subject = rig({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, [adapter])
      const pool = new Pool(subject.centrifuge, pool33Id)
      const update = [{ centrifugeId: SPOKE, localAdapters: [adapter], remoteAdapters: [adapter] }]

      const { entity, executed } = await entityThenExecution(subject, pool, () => pool.setAdapters(update))

      expect(entity).to.have.length(1)
      same(entity, executed)
    })

    it('goes first, each alone, and the rest is priced against the adapters it installs', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT, { wired: false })

      const { entity, executed, batch } = await entityThenExecution(subject, subject.pool, () =>
        subject.network.deploy([{ id: scId33, hook: who }], [])
      )

      expect(entity).to.have.length(2)
      expect(inner(entity[0]!.data).map(nameOf)).to.deep.equal(['setAdapters'])
      expect(batch.map(nameOf)[0]).to.equal('setAdapters')
      same(entity, executed)
    })

    it('is judged like the rest: a setAdapters call that is not ready stops the whole group', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT, { wired: false })
      await subject.network.deploy([{ id: scId33, hook: who }], [])
      const batch = subject.sent.splice(0).flatMap((tx) => inner(tx.data))
      subject.chain.installed = true
      subject.chain.authorization.set('setAdapters', 'pending')

      const result = await lastStatus(subject.pool.executeAuthorizations(delayedOf(batch)))

      expect(result.type).to.equal('OutOfPolicy')
      expect(result.calls?.map((call) => [call.functionName, call.status])).to.deep.equal([['setAdapters', 'pending']])
      expect(subject.sent).to.deep.equal([])
    })

    it('is not signed when the rest of the group is out of policy', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT, { wired: false })
      await subject.network.deploy([{ id: scId33, hook: who }], [])
      const batch = subject.sent.splice(0).flatMap((tx) => inner(tx.data))
      subject.chain.installed = true
      subject.chain.authorization.set('notifyShareClass', 'pending')

      const result = await lastStatus(subject.pool.executeAuthorizations(delayedOf(batch)))

      expect(result.type).to.equal('OutOfPolicy')
      expect(result.calls?.map((call) => call.functionName)).to.deep.equal(['notifyShareClass'])
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('a group that is not ready', () => {
    async function oneManagerCall(subject: ReturnType<typeof rig>, pool: Pool) {
      sinon.stub(pool, 'poolManagers').returns(thenable([{ address: SIGNER }]) as any)
      return callsBuiltBy(subject, pool.updatePoolManagers([{ address: who, canManage: true }]))
    }

    it('sends a matured group in one transaction', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const group = await oneManagerCall(subject, pool)
      subject.chain.installed = true

      const result = await lastStatus(pool.executeAuthorizations(group))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(subject.sent.map((tx) => inner(tx.data))).to.deep.equal([group])
    })

    for (const [status, setUp] of [
      ['pending', (chain: Chain) => chain.authorization.set('updateHubManager', 'pending')],
      ['expired', (chain: Chain) => chain.authorization.set('updateHubManager', 'expired')],
      ['needs-authorization', (chain: Chain) => chain.authorization.set('updateHubManager', 'none')],
      ['forbidden', (chain: Chain) => chain.forbidden.add('updateHubManager')],
      [
        'undetermined',
        (chain: Chain) => {
          chain.expiry = 'no answer'
          sinon.stub(Pool.prototype, 'hubExecutionPolicy').returns(of(null) as any)
        },
      ],
    ] as const) {
      it(`ends in OutOfPolicy with nothing signed when a call is ${status}`, async () => {
        const subject = rig()
        const pool = new Pool(subject.centrifuge, pool33Id)
        const group = await oneManagerCall(subject, pool)
        subject.chain.installed = true
        setUp(subject.chain)

        const result = await lastStatus(pool.executeAuthorizations(group))

        expect(result.type).to.equal('OutOfPolicy')
        expect(result.calls?.map((call) => [call.data, call.status])).to.deep.equal([[group[0], status]])
        expect(subject.sent).to.deep.equal([])
      })
    }

    it('names only the calls that are not ready, and signs none of the others', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      subject.chain.authorization.set('updateHubManager', 'pending')
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })
      const manager = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateHubManager',
        args: [pool33Id.raw, who, true],
      })

      const result = await lastStatus(subject.pool.executeAuthorizations([update, manager]))

      expect(result.calls?.map((call) => call.data)).to.deep.equal([manager])
      expect(subject.sent).to.deep.equal([])
    })

    it('judges the calls it rebuilds as well as the ones it was given', async () => {
      const subject = sharePriceRig()
      subject.chain.installed = true
      subject.chain.forbidden.add('notifySharePrice')
      const update = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateSharePrice',
        args: [pool33Id.raw, scId33.raw, 10n ** 18n, 1_700_000_000n],
      })

      const result = await lastStatus(subject.pool.executeAuthorizations([update]))

      expect(result.type).to.equal('OutOfPolicy')
      expect(result.calls?.map((call) => [call.functionName, call.status])).to.deep.equal([
        ['notifySharePrice', 'forbidden'],
        ['notifySharePrice', 'forbidden'],
      ])
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('the transaction it sends', () => {
    const issueShares = async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const shareClass = new ShareClass(subject.centrifuge, pool, scId33.raw)
      sinon.stub(shareClass, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 4, issueEpoch: 3 }],
        }) as any
      )
      sinon.stub(shareClass, '_investOrders').returns(of({ investOrders: [] }) as any)
      return { subject, pool, shareClass }
    }

    it('wraps a single call in a multicall when it is a local managerCall that sends a message, like the entity does', async () => {
      const { subject, pool, shareClass } = await issueShares()
      const write = () =>
        shareClass.approveDepositsAndIssueShares([
          { assetId: spokeAssetId, issuePricePerShare: new Price(10n ** 18n) },
        ] as any)

      const { entity, executed } = await entityThenExecution(subject, pool, write)

      expect(entity[0]!.data.startsWith('0xac9650d8')).to.equal(true)
      expect(executed.map((tx) => tx.data)).to.deep.equal(entity.map((tx) => tx.data))
    })

    it('wraps a lone local managerCall that sends a message even when setAdapters is signed before it', async () => {
      const rigged = rig({ entrypoint: ctx(pool33Id, '3.3').addresses.multiAdapter }, [adapter])
      const hubPool = new Pool(rigged.centrifuge, pool33Id)
      const orders = new ShareClass(rigged.centrifuge, hubPool, scId33.raw)
      sinon.stub(orders, 'pendingAmounts').returns(
        thenable({
          byVault: [{ assetId: spokeAssetId, pendingDeposit: new Balance(1_000n, 6), depositEpoch: 4, issueEpoch: 3 }],
        }) as any
      )
      sinon.stub(orders, '_investOrders').returns(of({ investOrders: [] }) as any)
      await hubPool.setAdapters([{ centrifugeId: SPOKE, localAdapters: [adapter], remoteAdapters: [adapter] }])
      await orders.approveDepositsAndIssueShares([
        { assetId: spokeAssetId, issuePricePerShare: new Price(10n ** 18n) },
      ] as any)
      const entity = rigged.sent.splice(0)
      rigged.chain.installed = true

      await hubPool.executeAuthorizations(delayedOf(entity.flatMap((tx) => inner(tx.data))))

      expect(rigged.sent.map((tx) => tx.data)).to.deep.equal(entity.map((tx) => tx.data))
      expect(nameOf(rigged.sent[1]!.data)).to.equal('multicall')
    })

    it('wraps a lone managerCall to the pool’s hub chain whose message stays on that chain, whatever its target', async () => {
      const subject = rig({ shareTokenAndRegistrar: [token, registrar] })
      const pool = new Pool(subject.centrifuge, pool33Id)
      const shareClass = new ShareClass(subject.centrifuge, pool, scId33.raw)

      const { entity, executed } = await entityThenExecution(subject, pool, () => shareClass.updateHook(HUB, who))

      expect(nameOf(entity[0]!.data)).to.equal('managerCall')
      expect(nameOf(executed[0]!.data)).to.equal('multicall')
      expect(inner(executed[0]!.data)).to.deep.equal([entity[0]!.data])
      expect(executed[0]!.value).to.equal(0n)
    })

    it('sends a single call to a remote target as it is, with no wrapper', async () => {
      const subject = rig()
      const shareClass = new ShareClass(subject.centrifuge, new Pool(subject.centrifuge, pool33Id), scId33.raw)
      const pool = new Pool(subject.centrifuge, pool33Id)

      const { entity, executed } = await entityThenExecution(subject, pool, () =>
        shareClass.updateValuation(SPOKE, who)
      )

      expect(nameOf(entity[0]!.data)).to.equal('managerCall')
      expect(executed.map((tx) => tx.data)).to.deep.equal(entity.map((tx) => tx.data))
    })

    it('wraps two calls in one multicall, in the order they were given', async () => {
      const subject = rig()
      subject.chain.installed = true
      const pool = new Pool(subject.centrifuge, pool33Id)
      const [first, second] = [who, OTHER_SIGNER].map((address) =>
        encodeFunctionData({ abi: hubAbi, functionName: 'updateHubManager', args: [pool33Id.raw, address, true] })
      )

      await pool.executeAuthorizations([second!, first!])

      expect(subject.sent).to.have.length(1)
      expect(nameOf(subject.sent[0]!.data)).to.equal('multicall')
      expect(inner(subject.sent[0]!.data)).to.deep.equal([second, first])
      expect(subject.sent[0]!.to.toLowerCase()).to.equal(ctx(pool33Id, '3.3').addresses.hub!.toLowerCase())
    })

    it('can be built, and refuses to be built with a setAdapters call, which is its own transaction', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const manager = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateHubManager',
        args: [pool33Id.raw, who, true],
      })

      expect(await callsBuiltBy(subject, pool.executeAuthorizations([manager]))).to.deep.equal([manager])
      let error: unknown
      try {
        await callsBuiltBy(subject, pool.executeAuthorizations([manager, setAdaptersCall]))
      } catch (e) {
        error = e
      }
      expect((error as Error).message).to.match(/several transactions/)
    })
  })

  describe('refuses a group it cannot send', () => {
    const update = encodeFunctionData({
      abi: hubAbi,
      functionName: 'updateHubManager',
      args: [pool33Id.raw, who, true],
    })
    type Refusal = [string, (subject: ReturnType<typeof rig>) => HexString[] | Promise<HexString[]>, RegExp, 'built'?]
    const cases: Refusal[] = [
      ['an empty group', () => [], /at least one/],
      ['the same calldata twice', () => [update, update], /same calldata twice/],
      [
        'the same calldata twice in another hex case',
        () => [update, update.toUpperCase().replace('0X', '0x') as HexString],
        /same calldata twice/,
      ],
      ['calldata that is not hex', () => ['0xzz' as HexString], /whole-byte hex/],
      ['calldata of odd length', () => ['0x1234567' as HexString], /whole-byte hex/],
      ['calldata shorter than a selector', () => ['0x123456' as HexString], /whole-byte hex/],
      [
        'a multicall wrapper',
        () => [encodeFunctionData({ abi: hubAbi, functionName: 'multicall', args: [[update]] })],
        /not of a multicall/,
      ],
      ['a selector the Hub does not carry', () => ['0xdeadbeef' as HexString], /not a function of the v3\.3 Hub/],
      ['calldata cut short', () => [`${update.slice(0, 10)}00` as HexString], /does not decode/],
      [
        'a call for another pool',
        () => [
          encodeFunctionData({ abi: hubAbi, functionName: 'updateHubManager', args: [pool33Id.raw + 1n, who, true] }),
        ],
        /not for pool/,
      ],
      [
        'a function no entity builds',
        () => [
          encodeFunctionData({ abi: hubAbi, functionName: 'updateHoldingValue', args: [pool33Id.raw, scId33.raw, 1n] }),
        ],
        /updateHoldingValue/,
      ],
      [
        'a managerCall that carries a local value',
        () => [
          encodeFunctionData({
            abi: hubAbi,
            functionName: 'managerCall',
            args: [pool33Id.raw, HUB, `0x${'11'.repeat(20)}${'00'.repeat(12)}`, '0x', 0n, 1n, SIGNER],
          }),
        ],
        /local value of 1/,
      ],
      [
        'extra gas on a function whose messages carry none',
        () => [
          encodeFunctionData({
            abi: hubAbi,
            functionName: 'updateRestriction',
            args: [pool33Id.raw, scId33.raw, SPOKE, '0x', 5n, SIGNER],
          }),
        ],
        /extra gas limit of 5/,
      ],
      [
        'a call that is valid next to one that is refused',
        () => [
          update,
          encodeFunctionData({ abi: hubAbi, functionName: 'cancelAuthorization', args: [pool33Id.raw, update] }),
        ],
        /cancelAuthorization/,
      ],
      ['a setAdapters call in a group that is built', () => [update, setAdaptersCall], /several transactions/, 'built'],
      ['a setAdapters call alone in a group that is built', () => [setAdaptersCall], /several transactions/, 'built'],
    ]

    for (const [name, group, message, built] of cases) {
      it(`${name}, with no protocol context, chain or indexer read`, async () => {
        const subject = rig()
        const pool = new Pool(subject.centrifuge, pool33Id)
        const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
        const indexer = (subject.centrifuge as any)._queryData as sinon.SinonStub
        const indexerOnce = sinon.spy(subject.centrifuge as any, '_queryDataOnce')
        let error: unknown
        try {
          const send = pool.executeAuthorizations(await group(subject))
          await (built ? callsBuiltBy(subject, send) : send)
        } catch (e) {
          error = e
        }

        expect((error as Error).message).to.match(message)
        expect(protocolContext.called, 'protocolContext').to.equal(false)
        expect(subject.readContract.called, 'readContract').to.equal(false)
        expect(indexer.called || indexerOnce.called, 'indexer').to.equal(false)
        expect(subject.sent).to.deep.equal([])
      })
    }

    it('refuses on a v3.2 pool with UnsupportedForProtocolVersionError, after the static checks', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool32Id)
      const call = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateHubManager',
        args: [pool32Id.raw, who, true],
      })
      let error: unknown
      try {
        await pool.executeAuthorizations([call])
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect((error as Error).message).to.contain('Pool.executeAuthorizations')
      expect(subject.sent).to.deep.equal([])
    })

    it('refuses a v3.2 pool on mainnet, whose address book lists no v3.3, with UnsupportedForProtocolVersionError', async () => {
      const centrifuge = new Centrifuge({ environment: 'mainnet' })
      const poolId = PoolId.from(1, 7)
      stubProjectedPools(centrifuge, [poolId], '3.2')
      stubChain(centrifuge)
      const sent: Sent[] = []
      centrifuge.setSigner(recordingWallet(sent) as any)
      const call = encodeFunctionData({ abi: hubAbi, functionName: 'updateHubManager', args: [poolId.raw, who, true] })
      let error: unknown
      try {
        await new Pool(centrifuge, poolId).executeAuthorizations([call])
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect(sent).to.deep.equal([])
    })

    it('refuses a managerCall to the BatchRequestManager of a kind no entity builds after reading the pool’s version and before signing', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
      subject.chain.installed = true
      const forceCancel = builders.hubManagerCall(ctx(pool33Id, '3.3'), {
        poolId: pool33Id.raw.toString(),
        centrifugeId: String(HUB),
        target: ctx(pool33Id, '3.3').addresses.batchRequestManager!,
        payload: encodeBatchRequestManagerPayload({
          kind: 'forceCancelDepositRequest',
          scId: scId33.raw,
          investor: who,
          assetId: spokeAssetId.toString(),
          refundAddress: SIGNER,
        }),
        label: 'BatchRequestManager',
        refundAddress: SIGNER,
      }).data
      let error: unknown
      try {
        await pool.executeAuthorizations([forceCancel])
      } catch (e) {
        error = e
      }

      expect((error as Error).message).to.match(/not an approve, issue or revoke/)
      expect(protocolContext.called).to.equal(true)
      expect(subject.sent).to.deep.equal([])
    })
  })
})
