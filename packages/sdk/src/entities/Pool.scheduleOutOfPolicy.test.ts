import { builders, encodeBatchRequestManagerPayload, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData } from 'viem'
import { ctx, HUB, pool32Id, pool33Id, scId33, scId33b, SPOKE, spokeAssetId, thenable, who } from '../tests/hubGroup.js'
import {
  argsOf,
  asset,
  deployedClass,
  deployRig,
  FIRST_DEPLOYMENT,
  hubAbi,
  initiated,
  inner,
  judged,
  lastStatus,
  nameOf,
  OTHER_SIGNER,
  outline,
  rig,
  same,
  scheduledData,
  sharePriceRig,
  SIGNER,
  token,
  vaultAddress,
} from '../tests/hubPolicyRig.js'
import type { HexString } from '../types/index.js'
import type { OperationOutOfPolicyStatus, OutOfPolicyBatchCall } from '../types/transaction.js'
import { Price } from '../utils/BigInt.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

// An entity's write runs on a hub whose policy delays what it does not list and has scheduled nothing, so it ends in
// `OutOfPolicy`. That status is scheduled, the hub's answer flips to matured, and the group is executed: the oracle is
// the same entity sent with no policy installed.

type Subject = ReturnType<typeof rig>

/** A status as a caller could hold it, from the calls of a batch. */
const statusOf = (batch: OutOfPolicyBatchCall[]): OperationOutOfPolicyStatus => ({
  id: 'status',
  type: 'OutOfPolicy',
  title: 'Update',
  calls: [],
  batch,
})
const manager = (poolId = pool33Id) =>
  encodeFunctionData({ abi: hubAbi, functionName: 'updateHubManager', args: [poolId.raw, who, true] })
const needsAuthorization = (data: HexString): OutOfPolicyBatchCall => ({
  data,
  status: 'needs-authorization',
  deferred: false,
})
const ready = (data: HexString, deferred = false): OutOfPolicyBatchCall => ({ data, status: 'ready', deferred })
const hubCall = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi: hubAbi, functionName, args } as any)
const word = `0x${'00'.repeat(32)}`
const notifyPool = () => hubCall('notifyPool', [pool33Id.raw, SPOKE, who])
const notifyShareClass = (centrifugeId = SPOKE) =>
  hubCall('notifyShareClass', [pool33Id.raw, scId33.raw, centrifugeId, word, '0x', 0n, who])
const setPoolMetadata = () => hubCall('setPoolMetadata', [pool33Id.raw, '0x'])

describe('Pool.scheduleOutOfPolicy', () => {
  afterEach(() => sinon.restore())

  describe('a share price beyond the guard', () => {
    const write = (subject: ReturnType<typeof sharePriceRig>) =>
      subject.shareClasses[0]!.updateSharePrice(new Price(10n ** 18n), new Date(1_700_000_000_000))

    it('schedules the update alone, sends no notification and no value', async () => {
      const subject = sharePriceRig()
      const status = await judged(subject, () => write(subject))
      expect(outline(status)).to.deep.equal([
        ['updateSharePrice', 'needs-authorization', false],
        ['notifySharePrice', 'ready', true],
        ['notifySharePrice', 'ready', true],
      ])

      const result = await lastStatus(subject.pool.scheduleOutOfPolicy(status))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(subject.sent).to.have.length(1)
      expect(initiated(subject.sent[0]!.data)).to.equal(status.batch[0]!.data)
      expect(subject.sent[0]!.value).to.equal(0n)
    })

    it('is executed once matured as the entity sends the update: the update and a notification per network, with its fee', async () => {
      const subject = sharePriceRig()
      await write(subject)
      const oracle = subject.sent.splice(0)
      const status = await judged(subject, () => write(subject))
      await subject.pool.scheduleOutOfPolicy(status)
      subject.sent.splice(0)
      subject.chain.authorizationDefault = 'matured'

      const result = await lastStatus(subject.pool.executeAuthorizations(scheduledData(status)))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(oracle[0]!.value > 0n).to.equal(true)
      same(oracle, subject.sent)
    })
  })

  describe('a Freeze with Member updates', () => {
    const members = [who, SIGNER].map((address) => ({ address, validUntil: 1_900_000_000, centrifugeId: SPOKE }))

    function freezeAndMembers() {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const shareClass = new ShareClass(subject.centrifuge, pool, scId33.raw)
      const write = () =>
        subject.centrifuge.batchTransactions('Freeze and update members', [
          shareClass.freezeMember(who, SPOKE),
          shareClass.updateMembers(members),
        ])
      return { ...subject, pool, write }
    }

    it('sends the Freeze with its fee and schedules each Member, in one transaction', async () => {
      const { write, pool, ...subject } = freezeAndMembers()
      const status = await judged(subject as Subject, write)
      expect(outline(status)).to.deep.equal([
        ['updateRestriction', 'ready', false],
        ['updateRestriction', 'needs-authorization', false],
        ['updateRestriction', 'needs-authorization', false],
      ])

      await pool.scheduleOutOfPolicy(status)

      expect(subject.sent).to.have.length(1)
      const [freeze, ...members] = inner(subject.sent[0]!.data)
      expect(nameOf(subject.sent[0]!.data)).to.equal('multicall')
      expect(freeze).to.equal(status.batch[0]!.data)
      expect(members.map(initiated)).to.deep.equal(scheduledData(status))
      expect(subject.sent[0]!.value).to.equal(2_000n)
    })

    it('judges only the calls it sends, which name their pool, and not the ones it schedules', async () => {
      const { write, pool, ...subject } = freezeAndMembers()
      const status = await judged(subject as Subject, write)
      const classify = sinon.spy(subject.centrifuge, '_classifyHubCalls')

      await pool.scheduleOutOfPolicy(status)

      expect(classify.callCount).to.equal(1)
      expect(classify.firstCall.args[1]).to.deep.equal([{ poolId: pool33Id, data: status.batch[0]!.data }])
    })

    it('ends in OutOfPolicy again, with nothing signed, when the Freeze is no longer ready', async () => {
      const { write, pool, ...subject } = freezeAndMembers()
      const status = await judged(subject as Subject, write)
      subject.chain.forbidden.add('updateRestriction')

      const result = (await lastStatus(pool.scheduleOutOfPolicy(status))) as OperationOutOfPolicyStatus

      expect(result.type).to.equal('OutOfPolicy')
      expect(result.calls.map((call) => [call.data, call.status])).to.deep.equal([[status.batch[0]!.data, 'forbidden']])
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('a deployment', () => {
    const hook = who

    it('schedules the delayed calls and defers the notification of the pool, which it does not send', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      const status = await judged(subject, () => subject.network.deploy([{ id: scId33, hook }], []))
      expect(outline(status)).to.deep.equal([
        ['notifyPool', 'ready', true],
        ['updateManager', 'needs-authorization', false],
        ['managerCall', 'needs-authorization', false],
        ['setRequestManager', 'needs-authorization', false],
        ['notifyShareClass', 'needs-authorization', false],
        ['managerCall', 'needs-authorization', false],
      ])

      await subject.pool.scheduleOutOfPolicy(status)

      expect(subject.sent).to.have.length(1)
      expect(inner(subject.sent[0]!.data).map(initiated)).to.deep.equal(scheduledData(status))
      expect(subject.sent[0]!.value).to.equal(0n)
    })

    it('is executed once matured as the entity sends the deployment, the notification of the pool first', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      await subject.network.deploy([{ id: scId33, hook }], [])
      const oracle = subject.sent.splice(0)
      const status = await judged(subject, () => subject.network.deploy([{ id: scId33, hook }], []))
      await subject.pool.scheduleOutOfPolicy(status)
      subject.sent.splice(0)
      subject.chain.authorizationDefault = 'matured'

      await subject.pool.executeAuthorizations(scheduledData(status))

      expect(nameOf(inner(oracle[0]!.data)[0]!)).to.equal('notifyPool')
      same(oracle, subject.sent)
    })

    const vaultRig = () =>
      deployRig(deployedClass, {
        reads: {
          manager: true,
          requestManager: who,
          idToAsset: [asset, 0n],
          shareToken: token,
          getVault: vaultAddress,
        },
      })
    const deployVault = (subject: ReturnType<typeof vaultRig>) => () =>
      subject.network.deploy([], [{ shareClassId: scId33, assetId: spokeAssetId, kind: 'syncDeposit' }])

    it('is executed once matured as the entity sends the vault, the price of its asset right before the link', async () => {
      const subject = vaultRig()
      await deployVault(subject)()
      const oracle = subject.sent.splice(0)
      const status = await judged(subject, deployVault(subject))
      expect(status.batch.map(({ data, deferred }) => [nameOf(data), deferred])).to.deep.include([
        'notifyAssetPrice',
        true,
      ])
      await subject.pool.scheduleOutOfPolicy(status)
      expect(inner(subject.sent[0]!.data).map(nameOf)).to.not.include('notifyAssetPrice')
      subject.sent.splice(0)
      subject.chain.authorizationDefault = 'matured'

      await subject.pool.executeAuthorizations(scheduledData(status))

      expect(inner(oracle[0]!.data).map(nameOf)).to.deep.equal([
        'managerCall',
        'notifyAssetPrice',
        'updateVault',
        'managerCall',
      ])
      same(oracle, subject.sent)
    })

    it('defers the price of the asset of a vault that is deployed, and schedules the vault', async () => {
      const subject = vaultRig()
      const status = await judged(subject, deployVault(subject))
      expect(outline(status)).to.deep.equal([
        ['managerCall', 'needs-authorization', false],
        ['notifyAssetPrice', 'ready', true],
        ['updateVault', 'needs-authorization', false],
        ['managerCall', 'needs-authorization', false],
      ])

      await subject.pool.scheduleOutOfPolicy(status)

      expect(inner(subject.sent[0]!.data).map(initiated)).to.deep.equal(scheduledData(status))
      expect(subject.sent[0]!.value).to.equal(0n)
    })

    it('schedules a setAdapters call that needs an authorization like any other call', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT, { wired: false })
      const status = await judged(subject, () => subject.network.deploy([{ id: scId33, hook }], []))
      expect(status.batch[0]).to.deep.include({ status: 'needs-authorization', deferred: false })
      expect(nameOf(status.batch[0]!.data)).to.equal('setAdapters')

      await subject.pool.scheduleOutOfPolicy(status)

      expect(subject.sent).to.have.length(1)
      expect(inner(subject.sent[0]!.data).map(initiated)).to.deep.equal(scheduledData(status))
    })
  })

  describe('the transaction', () => {
    it('is one transaction on the hub, so the calls it schedules share a transaction hash', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      sinon.stub(pool, 'poolManagers').returns(thenable([{ address: SIGNER }]) as any)
      const status = await judged(subject, () =>
        pool.updatePoolManagers([
          { address: who, canManage: true },
          { address: OTHER_SIGNER, canManage: true },
        ])
      )

      await pool.scheduleOutOfPolicy(status)

      expect(subject.sent).to.have.length(1)
      expect(subject.sent[0]!.to.toLowerCase()).to.equal(ctx(pool33Id, '3.3').addresses.hub!.toLowerCase())
      expect(inner(subject.sent[0]!.data).map(initiated)).to.deep.equal(scheduledData(status))
      expect(scheduledData(status)).to.have.length(2)
    })

    it('sends a single call to schedule as the plain initiateAuthorization, with no multicall', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)

      await pool.scheduleOutOfPolicy(statusOf([needsAuthorization(manager())]))

      expect(subject.sent.map((tx) => nameOf(tx.data))).to.deep.equal(['initiateAuthorization'])
    })

    it('sends a ready deployment leg bound for a network other than the one whose notifyPool it leaves to the execution', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)

      await pool.scheduleOutOfPolicy(
        statusOf([ready(notifyPool(), true), needsAuthorization(notifyShareClass(SPOKE)), ready(notifyShareClass(HUB))])
      )

      expect(inner(subject.sent[0]!.data).map(nameOf)).to.deep.equal(['initiateAuthorization', 'notifyShareClass'])
    })

    it('can be built, and builds the calls it would send', async () => {
      const subject = rig()
      const pool = new Pool(subject.centrifuge, pool33Id)
      const other = encodeFunctionData({
        abi: hubAbi,
        functionName: 'updateHubManager',
        args: [pool33Id.raw, SIGNER, true],
      })

      const built = await subject.build(
        pool.scheduleOutOfPolicy(statusOf([needsAuthorization(manager()), needsAuthorization(other)]))
      )

      expect(built.calls.map((call) => initiated(call.data))).to.deep.equal([manager(), other])
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('refuses a status it cannot schedule, before anything is signed', () => {
    async function managerStatus(subject: Subject, setUp: (chain: Subject['chain']) => void = () => {}) {
      const pool = new Pool(subject.centrifuge, pool33Id)
      sinon.stub(pool, 'poolManagers').returns(thenable([{ address: SIGNER }]) as any)
      subject.chain.authorization.set('updateHubManager', 'none')
      setUp(subject.chain)
      const status = await judged(subject, () => pool.updatePoolManagers([{ address: who, canManage: true }]))
      return { pool, status }
    }

    async function refusal(pool: Pool, status: OperationOutOfPolicyStatus) {
      let error: unknown
      try {
        await pool.scheduleOutOfPolicy(status)
      } catch (e) {
        error = e
      }
      expect(error, 'expected a refusal').to.be.instanceOf(Error)
      return (error as Error).message
    }

    const notScheduled: [string, (chain: Subject['chain']) => void, RegExp][] = [
      ['forbidden', (chain) => chain.forbidden.add('updateHubManager'), /forbidden[^]*no authorization/],
      [
        'pending',
        (chain) => chain.authorization.set('updateHubManager', 'pending'),
        /already scheduled[^]*wait[^]*Pool\.executeAuthorizations/,
      ],
      [
        'expired',
        (chain) => chain.authorization.set('updateHubManager', 'expired'),
        /expired[^]*Pool\.cancelAuthorization/,
      ],
      [
        'undetermined',
        (chain) => {
          chain.authorization.set('updateHubManager', 'matured')
          chain.expiry = 'no answer'
          sinon.stub(Pool.prototype, 'hubExecutionPolicy').returns(of(null) as any)
        },
        /expiry[^]*Pool\.cancelAuthorization/,
      ],
    ]

    for (const [verdict, setUp, message] of notScheduled) {
      it(`a call that is ${verdict}, naming it and what to do, with no read of the chain`, async () => {
        const subject = rig()
        const { pool, status } = await managerStatus(subject, setUp)
        expect(status.batch[0]!.status).to.equal(verdict)
        const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
        subject.readContract.resetHistory()

        const error = await refusal(pool, status)

        expect(error).to.match(/updateHubManager/)
        expect(error).to.match(message)
        expect(protocolContext.called, 'protocolContext').to.equal(false)
        expect(subject.readContract.called, 'readContract').to.equal(false)
        expect(subject.sent).to.deep.equal([])
      })
    }

    it('a status of another pool, with no read of the chain', async () => {
      const subject = rig()
      const { status } = await managerStatus(subject)
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')

      const error = await refusal(new Pool(subject.centrifuge, PoolId.from(HUB, 34)), status)

      expect(error).to.match(/not for pool/)
      expect(protocolContext.called).to.equal(false)
      expect(subject.sent).to.deep.equal([])
    })

    it('a status with no call that needs an authorization', async () => {
      const subject = rig()
      const { pool, status } = await managerStatus(subject)
      const nothing = { ...status, batch: status.batch.map((call) => ({ ...call, status: 'ready' as const })) }

      expect(await refusal(pool, nothing)).to.match(/nothing to schedule/)
      expect(subject.sent).to.deep.equal([])
    })

    it('an independent setAdapters, which the Hub refuses inside a batch', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT, { wired: false })
      subject.chain.instant.add('setAdapters')
      const status = await judged(subject, () => subject.network.deploy([{ id: scId33, hook: who }], []))
      expect(status.batch[0]).to.deep.include({ status: 'ready', deferred: false })
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')

      const error = await refusal(subject.pool, status)

      expect(error).to.match(/setAdapters[^]*batch/)
      expect(protocolContext.called).to.equal(false)
      expect(subject.sent).to.deep.equal([])
    })

    it('a ready deployment leg beside a notifyPool left to the execution, naming the leg and the group to execute first', async () => {
      const subject = deployRig(FIRST_DEPLOYMENT)
      const deployBoth = () =>
        subject.network.deploy(
          [
            { id: scId33, hook: who },
            { id: scId33b, hook: who },
          ],
          []
        )
      await deployBoth()
      const matured = inner(subject.sent.splice(0)[0]!.data).find(
        (call) => nameOf(call) === 'notifyShareClass' && argsOf(call)[1] === scId33.raw
      )!
      subject.chain.authorizationOfCall.set(matured.toLowerCase(), 'matured')
      const status = await judged(subject, deployBoth)
      expect(
        status.batch.map(({ data, status: verdict, deferred }) => [nameOf(data), verdict, deferred])
      ).to.deep.include.members([
        ['notifyPool', 'ready', true],
        ['notifyShareClass', 'ready', false],
        ['notifyShareClass', 'needs-authorization', false],
      ])
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
      subject.readContract.resetHistory()

      const error = await refusal(subject.pool, status)

      expect(error).to.match(/Hub\.notifyShareClass[^]*notifyPool[^]*Pool\.executeAuthorizations/)
      expect(protocolContext.called, 'protocolContext').to.equal(false)
      expect(subject.readContract.called, 'readContract').to.equal(false)
      expect(subject.sent).to.deep.equal([])
    })

    const malformed: [string, () => OperationOutOfPolicyStatus, RegExp][] = [
      ['an empty batch', () => statusOf([]), /at least one/],
      [
        'something that is not an OutOfPolicy status',
        () => ({ type: 'TransactionConfirmed' }) as unknown as OperationOutOfPolicyStatus,
        /OutOfPolicy status/,
      ],
      [
        'a status without the calls that are not ready',
        () =>
          ({ ...statusOf([needsAuthorization(manager())]), calls: undefined }) as unknown as OperationOutOfPolicyStatus,
        /OutOfPolicy status/,
      ],
      [
        'the same call to schedule twice',
        () => statusOf([needsAuthorization(manager()), needsAuthorization(manager())]),
        /same calldata twice/,
      ],
      [
        'calldata that is not a hub call',
        () => statusOf([needsAuthorization('0x1234567' as HexString)]),
        /whole-byte hex/,
      ],
      [
        'a multicall wrapper',
        () =>
          statusOf([
            needsAuthorization(encodeFunctionData({ abi: hubAbi, functionName: 'multicall', args: [[manager()]] })),
          ]),
        /not of a multicall/,
      ],
      [
        'a call to schedule that is marked deferred, which would leave it out of every transaction',
        () => statusOf([{ ...needsAuthorization(manager()), deferred: true }]),
        /deferred[^]*pass the status as the action yielded it/,
      ],
      [
        'a ready call marked deferred that no call of the batch makes the execution rebuild',
        () => statusOf([needsAuthorization(manager()), ready(setPoolMetadata(), true)]),
        /setPoolMetadata[^]*deferred/,
      ],
      [
        'a ready call marked not deferred that the execution rebuilds for a call that is not ready',
        () => statusOf([ready(notifyPool()), needsAuthorization(notifyShareClass())]),
        /notifyPool[^]*deferred/,
      ],
      [
        'a function no entity builds',
        () =>
          statusOf([
            needsAuthorization(
              encodeFunctionData({
                abi: hubAbi,
                functionName: 'updateHoldingValue',
                args: [pool33Id.raw, scId33.raw, 1n],
              })
            ),
          ]),
        /updateHoldingValue/,
      ],
    ]

    for (const [name, make, message] of malformed) {
      it(`${name}, with no read of the chain`, async () => {
        const subject = rig()
        const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')

        const error = await refusal(new Pool(subject.centrifuge, pool33Id), make())

        expect(error).to.match(message)
        expect(protocolContext.called).to.equal(false)
        expect(subject.readContract.called).to.equal(false)
        expect(subject.sent).to.deep.equal([])
      })
    }

    it('a v3.2 pool, with UnsupportedForProtocolVersionError, after the checks that read nothing', async () => {
      const subject = rig()
      let error: unknown
      try {
        await new Pool(subject.centrifuge, pool32Id).scheduleOutOfPolicy(
          statusOf([needsAuthorization(manager(pool32Id))])
        )
      } catch (e) {
        error = e
      }

      expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
      expect((error as Error).message).to.contain('Pool.scheduleOutOfPolicy')
      expect(subject.sent).to.deep.equal([])
    })

    it('a call whose messages cannot be derived with the pool’s BatchRequestManager, after reading the pool’s version', async () => {
      const subject = rig()
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
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

      const error = await refusal(
        new Pool(subject.centrifuge, pool33Id),
        statusOf([needsAuthorization(manager()), needsAuthorization(forceCancel)])
      )

      expect(error).to.match(/not an approve, issue or revoke/)
      expect(protocolContext.called).to.equal(true)
      expect(subject.sent).to.deep.equal([])
    })
  })
})
