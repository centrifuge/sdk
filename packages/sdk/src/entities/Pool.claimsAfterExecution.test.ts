import { ABIS_V3_3, UnsupportedForProtocolVersionError } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { decodeFunctionData, getAddress, hexToBigInt, parseAbi } from 'viem'
import { HUB_ACTIONS } from '../tests/hubActions.js'
import { HUB, pool32Id, pool33Id, scId33, scId33b, SPOKE, spokeAssetId, who } from '../tests/hubGroup.js'
import { callsBuiltBy, lastStatus, rig, SIGNER } from '../tests/hubPolicyRig.js'
import {
  approveDeposits,
  approveRedeems,
  batchRequestManager,
  hubCall,
  issueShares,
  orderCall,
  revokeShares,
} from '../tests/orderCalls.js'
import {
  depositEpoch,
  depositOrder,
  type Indexed,
  redeemEpoch,
  redeemOrder,
  stubIndexer,
} from '../tests/settledOrders.js'
import type { HexString } from '../types/index.js'
import { addressToBytes32 } from '../utils/index.js'
import { AssetId, PoolId } from '../utils/types.js'
import { INDEXER_POLL_MS, INDEXER_WAIT_MS } from './claimsAfterExecution.js'
import { Pool } from './Pool.js'
import { claimNotificationBudget } from './ShareClass.js'

// The claims a group leaves for the investors after it executed: a `notifyDeposit` or `notifyRedeem` for each investor
// of an epoch the group issued or revoked who is not notified yet, sent to the pool's BatchRequestManager. Investors
// and claim counts come from the indexer, which the method waits for.

const second = '0x2222222222222222222222222222222222222222' as HexString
const third = '0x3333333333333333333333333333333333333333' as HexString
const daiAsset = AssetId.from(SPOKE, 2)
const multicall = parseAbi(['function multicall(bytes[] data) payable'])
const rows = (side: 'deposits' | 'redemptions', epochs: object[], orders: object[]): Indexed => ({
  [scId33.raw]: { [side]: { epochs, orders } },
})

const callsOf = (data: HexString): HexString[] => {
  try {
    return [...(decodeFunctionData({ abi: multicall, data }).args[0] as readonly HexString[])]
  } catch {
    return [data]
  }
}
const notificationsOf = (data: HexString) =>
  callsOf(data).map((call) => {
    const { functionName, args } = decodeFunctionData({ abi: ABIS_V3_3.BatchRequestManager, data: call }) as any
    const [poolId, scId, assetId, requestId, maxClaims, refund] = args
    return { functionName, poolId, scId, assetId, investor: requestId, maxClaims, refund }
  })
const requestId = (investor: HexString) => hexToBigInt(addressToBytes32(investor))
const notified = (functionName: string, investor: HexString, maxClaims: number, scId = scId33.raw) => ({
  functionName,
  poolId: pool33Id.raw,
  scId,
  assetId: spokeAssetId.raw,
  investor: requestId(investor),
  maxClaims,
  refund: SIGNER,
})
const investorsOf = (data: HexString) => notificationsOf(data).map(({ investor }) => investor)

/** A spy on a method of the root, or the stub a fixture already put there, with the calls so far forgotten. */
function watched(root: object, method: string): sinon.SinonSpy {
  const current = (root as any)[method]
  if (!current.restore) return sinon.spy(root as any, method)
  current.resetHistory()
  return current
}

/** The outcome of a transaction that may reject, so a test can advance the clock before it looks. */
const outcome = (tx: PromiseLike<unknown>) =>
  lastStatus(tx).then(
    (status) => ({ status, error: undefined }),
    (error: Error) => ({ status: undefined, error })
  )

describe('Pool.claimsAfterExecution', () => {
  afterEach(() => sinon.restore())

  describe('a group that issues shares', () => {
    const group = [orderCall(approveDeposits('3')), orderCall(issueShares('3'))]

    it('sends one transaction to the BatchRequestManager that notifies each unclaimed investor of the epoch for the unclaimed closed epochs of the asset the indexer lists', async () => {
      const subject = rig()
      stubIndexer(
        subject.centrifuge,
        rows(
          'deposits',
          [depositEpoch(3), depositEpoch(2)],
          [
            depositOrder(who, 3),
            depositOrder(who, 2),
            depositOrder(second, 3),
            depositOrder(second, 3, { assetId: daiAsset }),
            depositOrder(third, 2),
          ]
        )
      )
      subject.readContract.resetHistory()

      const result = await lastStatus(new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(subject.sent).to.have.length(1)
      expect(subject.sent[0]!.to.toLowerCase()).to.equal(batchRequestManager.toLowerCase())
      expect(notificationsOf(subject.sent[0]!.data)).to.deep.equal([
        notified('notifyDeposit', who, 2),
        notified('notifyDeposit', second, 1),
      ])
      expect(subject.sent[0]!.value, 'one callback fee per notification').to.equal(2n * BigInt(SPOKE) * 1_000n)
      const read = subject.readContract.getCalls().map((call) => call.args[0].functionName)
      expect(read, 'no claim count is read from the chain').to.not.include.members(['maxDepositClaims'])
    })

    it('notifies an investor who has orders in several epochs of the group once, and leaves out one of an epoch it did not settle', async () => {
      const subject = rig()
      stubIndexer(
        subject.centrifuge,
        rows(
          'deposits',
          [depositEpoch(3), depositEpoch(4), depositEpoch(9)],
          [
            depositOrder(who, 3),
            depositOrder(second, 3),
            depositOrder(second, 4),
            depositOrder(third, 4),
            depositOrder(who, 9),
            depositOrder('0x4444444444444444444444444444444444444444', 9),
          ]
        )
      )

      await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([
        orderCall(issueShares('3')),
        orderCall(issueShares('4')),
      ])

      expect(
        notificationsOf(subject.sent[0]!.data).map(({ investor, maxClaims }) => [investor, maxClaims])
      ).to.deep.equal([
        [requestId(who), 2],
        [requestId(second), 2],
        [requestId(third), 1],
      ])
    })

    it('skips an investor the indexer lists as notified', async () => {
      const subject = rig()
      stubIndexer(
        subject.centrifuge,
        rows('deposits', [depositEpoch(3)], [depositOrder(who, 3, { claimed: true }), depositOrder(second, 3)])
      )

      await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group)

      expect(investorsOf(subject.sent[0]!.data)).to.deep.equal([requestId(second)])
    })

    it('throws that every investor is claimed, and signs nothing, when none is left', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const subject = rig()
      const indexer = stubIndexer(
        subject.centrifuge,
        rows('deposits', [depositEpoch(3)], [depositOrder(who, 3, { claimed: true })])
      )

      const pending = outcome(new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group))
      await clock.tickAsync(INDEXER_POLL_MS)
      const { status, error } = await pending

      expect(status).to.equal(undefined)
      expect(error!.message).to.match(/Pool\.claimsAfterExecution: every investor .* is already claimed/)
      expect(subject.sent).to.deep.equal([])
      expect(indexer.callCount, 'two polls: the investors of an epoch are written right after its row').to.equal(4)
    })

    it('notifies as many investors as the entity’s gas budget allows, from the head of the list', async () => {
      const subject = rig()
      const investors = Array.from(
        { length: 60 },
        (_, index) => getAddress(`0x${(index + 1).toString(16).padStart(40, '0')}`).toLowerCase() as HexString
      )
      stubIndexer(
        subject.centrifuge,
        rows(
          'deposits',
          [depositEpoch(3)],
          investors.map((investor) => depositOrder(investor, 3))
        )
      )
      const budget = claimNotificationBudget(spokeAssetId, HUB, 1, 1)

      await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([orderCall(issueShares('3'))])

      expect(budget).to.equal(41)
      expect(investorsOf(subject.sent[0]!.data)).to.deep.equal(investors.slice(0, budget).map(requestId))
      expect(subject.sent[0]!.value).to.equal(BigInt(budget) * BigInt(SPOKE) * 1_000n)
    })

    it('throws when the group’s hub batch leaves no gas budget for a claim, and sends nothing', async () => {
      const subject = rig()
      stubIndexer(
        subject.centrifuge,
        rows(
          'deposits',
          Array.from({ length: 50 }, (_, index) => depositEpoch(index + 1)),
          [depositOrder(who, 1)]
        )
      )
      const issues = Array.from({ length: 50 }, (_, index) => orderCall(issueShares(String(index + 1))))
      let error: unknown
      try {
        await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(issues)
      } catch (e) {
        error = e
      }

      expect((error as Error).message).to.match(/no gas budget for a claim notification/)
      expect(subject.sent).to.deep.equal([])
    })

    it('is not judged by the pool’s hub policy, since the claims are no call of the Hub', async () => {
      const subject = rig()
      subject.chain.installed = true
      subject.chain.authorizationDefault = 'none'
      stubIndexer(subject.centrifuge, rows('deposits', [depositEpoch(3)], [depositOrder(who, 3)]))

      const result = await lastStatus(new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group))

      expect(result.type).to.equal('TransactionConfirmed')
      expect(subject.sent).to.have.length(1)
    })

    it('can be built, as the one transaction it sends', async () => {
      const subject = rig()
      stubIndexer(subject.centrifuge, rows('deposits', [depositEpoch(3)], [depositOrder(who, 3)]))

      const built = await subject.centrifuge.buildOnly(
        new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group),
        { fromAddress: SIGNER }
      )

      expect(built.to.toLowerCase()).to.equal(batchRequestManager.toLowerCase())
      expect(notificationsOf(built.data)).to.deep.equal([notified('notifyDeposit', who, 1)])
    })
  })

  describe('a group that revokes shares', () => {
    it('notifies each unclaimed investor of each epoch it revokes with a notifyRedeem for their unclaimed closed epochs', async () => {
      const subject = rig()
      stubIndexer(
        subject.centrifuge,
        rows(
          'redemptions',
          [redeemEpoch(4), redeemEpoch(5)],
          [redeemOrder(who, 4), redeemOrder(who, 5), redeemOrder(second, 5), redeemOrder(third, 4, { claimed: true })]
        )
      )

      await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([
        orderCall(approveRedeems('5')),
        orderCall(revokeShares('4')),
        orderCall(revokeShares('5')),
      ])

      expect(notificationsOf(subject.sent[0]!.data)).to.deep.equal([
        notified('notifyRedeem', who, 2),
        notified('notifyRedeem', second, 1),
      ])
    })

    it('sends the claims of an issue and of a revoke, and of two share classes, in one transaction in the order of the group', async () => {
      const subject = rig()
      stubIndexer(subject.centrifuge, {
        [scId33.raw]: {
          deposits: { epochs: [depositEpoch(3)], orders: [depositOrder(who, 3)] },
          redemptions: { epochs: [redeemEpoch(4)], orders: [redeemOrder(second, 4)] },
        },
        [scId33b.raw]: {
          redemptions: { epochs: [redeemEpoch(2)], orders: [redeemOrder(third, 2), redeemOrder(third, 1)] },
        },
      })

      await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([
        orderCall(revokeShares('4')),
        orderCall(issueShares('3')),
        orderCall(revokeShares('2', { scId: scId33b.raw })),
      ])

      expect(subject.sent).to.have.length(1)
      expect(notificationsOf(subject.sent[0]!.data)).to.deep.equal([
        notified('notifyRedeem', second, 1),
        notified('notifyDeposit', who, 1),
        notified('notifyRedeem', third, 2, scId33b.raw),
      ])
    })
  })

  describe('the wait for the indexer', () => {
    const group = [orderCall(issueShares('3'))]
    const pool = (subject: ReturnType<typeof rig>) => new Pool(subject.centrifuge, pool33Id)
    const clockWith = () => sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    it('signs nothing while the epoch is open, and sends the claims of the indexer as it is once it has closed', async () => {
      const clock = clockWith()
      const subject = rig()
      const indexed: Indexed = rows('deposits', [depositEpoch(3, { closed: false })], [])
      const indexer = stubIndexer(subject.centrifuge, indexed)

      const pending = outcome(pool(subject).claimsAfterExecution(group))
      await clock.tickAsync(INDEXER_POLL_MS - 1)
      expect(indexer.callCount, 'one poll so far').to.equal(2)
      expect(subject.sent).to.deep.equal([])
      Object.assign(indexed[scId33.raw]!, rows('deposits', [depositEpoch(3)], [depositOrder(who, 3)])[scId33.raw])
      await clock.tickAsync(1)
      const { status, error } = await pending

      expect(error).to.equal(undefined)
      expect(status!.type).to.equal('TransactionConfirmed')
      expect(notificationsOf(subject.sent[0]!.data)).to.deep.equal([notified('notifyDeposit', who, 1)])
    })

    it('waits for an epoch that the indexer has not listed at all', async () => {
      const clock = clockWith()
      const subject = rig()
      const indexed: Indexed = rows('deposits', [], [])
      stubIndexer(subject.centrifuge, indexed)

      const pending = outcome(pool(subject).claimsAfterExecution(group))
      await clock.tickAsync(INDEXER_POLL_MS * 2)
      expect(subject.sent).to.deep.equal([])
      Object.assign(indexed[scId33.raw]!, rows('deposits', [depositEpoch(3)], [depositOrder(who, 3)])[scId33.raw])
      await clock.tickAsync(INDEXER_POLL_MS)

      expect((await pending).status!.type).to.equal('TransactionConfirmed')
    })

    it('looks again when the epoch is closed and its investors are not written yet, and sends them', async () => {
      const clock = clockWith()
      const subject = rig()
      const indexed: Indexed = rows('deposits', [depositEpoch(3)], [])
      stubIndexer(subject.centrifuge, indexed)

      const pending = outcome(pool(subject).claimsAfterExecution(group))
      await clock.tickAsync(INDEXER_POLL_MS - 1)
      Object.assign(indexed[scId33.raw]!, rows('deposits', [depositEpoch(3)], [depositOrder(who, 3)])[scId33.raw])
      await clock.tickAsync(1)

      expect((await pending).status!.type).to.equal('TransactionConfirmed')
      expect(investorsOf(subject.sent[0]!.data)).to.deep.equal([requestId(who)])
    })

    it('throws that the indexer has not processed the execution, naming the open epoch, and signs nothing', async () => {
      const clock = clockWith()
      const subject = rig()
      stubIndexer(subject.centrifuge, rows('deposits', [depositEpoch(3, { closed: false })], []))

      const pending = outcome(pool(subject).claimsAfterExecution(group))
      await clock.tickAsync(INDEXER_WAIT_MS + INDEXER_POLL_MS)
      const { status, error } = await pending

      expect(status).to.equal(undefined)
      expect(error!.message).to.match(
        new RegExp(
          `Pool\\.claimsAfterExecution: the indexer has not processed the execution yet.*epoch 3 of asset ${spokeAssetId}.*call again`
        )
      )
      expect(subject.sent).to.deep.equal([])
    })

    it('does not retry a read that fails', async () => {
      const subject = rig()
      sinon.stub(subject.centrifuge as any, '_queryDataOnce').rejects(new Error('NOT_YET_PROJECTED'))
      let error: unknown
      try {
        await pool(subject).claimsAfterExecution(group)
      } catch (e) {
        error = e
      }

      expect((error as Error).message).to.equal('NOT_YET_PROJECTED')
      expect(subject.sent).to.deep.equal([])
    })

    it('stops asking the indexer once the subscriber has gone', async () => {
      const clock = clockWith()
      const subject = rig()
      const indexer = stubIndexer(subject.centrifuge, rows('deposits', [depositEpoch(3, { closed: false })], []))

      const subscription = pool(subject).claimsAfterExecution(group).subscribe()
      await clock.tickAsync(INDEXER_POLL_MS)
      subscription.unsubscribe()
      const reads = indexer.callCount
      await clock.tickAsync(INDEXER_WAIT_MS)

      expect(indexer.callCount).to.be.at.most(reads + 2)
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('a group with nothing to claim', () => {
    // Built from the entities that send them, so these are the groups an app passes after any other execution.
    const entityGroup = async (name: string) => {
      const action = HUB_ACTIONS.find((candidate) => candidate.name.startsWith(name))!
      const subject = rig(action.reads, action.contracts)
      const { pool, write } = action.setup(subject.centrifuge)
      return { subject, pool, calls: await callsBuiltBy(subject, write()) }
    }

    for (const name of ['PoolNetwork.deploy, first deployment on a spoke', 'ShareClass.updateSharePrice']) {
      it(`${name}: refuses before reading anything, since it holds no issue or revoke`, async () => {
        const { subject, pool, calls } = await entityGroup(name)
        const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
        const indexer = watched(subject.centrifuge, '_queryData')
        const indexerOnce = watched(subject.centrifuge, '_queryDataOnce')
        subject.readContract.resetHistory()
        let error: unknown
        try {
          await pool.claimsAfterExecution(calls)
        } catch (e) {
          error = e
        }

        expect((error as Error).message).to.match(/Pool\.claimsAfterExecution: .*holds no issue or revoke/)
        expect(protocolContext.called, 'protocolContext').to.equal(false)
        expect(subject.readContract.called, 'readContract').to.equal(false)
        expect(indexer.called || indexerOnce.called, 'indexer').to.equal(false)
        expect(subject.sent).to.deep.equal([])
      })
    }

    it('refuses a group of approves alone, which settle no epoch', async () => {
      const subject = rig()
      const indexer = stubIndexer(subject.centrifuge, {})
      let error: unknown
      try {
        await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([
          orderCall(approveDeposits('3')),
          orderCall(approveRedeems('3')),
        ])
      } catch (e) {
        error = e
      }

      expect((error as Error).message).to.match(/holds no issue or revoke/)
      expect(indexer.called).to.equal(false)
      expect(subject.sent).to.deep.equal([])
    })

    it('refuses an issue that goes to another contract than the pool’s BatchRequestManager, once it has read the pool’s version', async () => {
      const subject = rig()
      const indexer = stubIndexer(subject.centrifuge, {})
      let error: unknown
      try {
        await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution([
          orderCall(issueShares('3'), { target: who }),
        ])
      } catch (e) {
        error = e
      }

      expect((error as Error).message).to.match(/holds no issue or revoke/)
      expect(indexer.called).to.equal(false)
      expect(subject.sent).to.deep.equal([])
    })
  })

  describe('refuses a group it cannot read, before reading anything', () => {
    const cases: [string, () => HexString[], RegExp][] = [
      ['an empty group', () => [], /Pool\.claimsAfterExecution needs at least one hub call/],
      [
        'a call for another pool',
        () => [orderCall(issueShares('3'), { poolId: PoolId.from(HUB, 34) })],
        /not for pool/,
      ],
      ['a selector the Hub does not carry', () => ['0xdeadbeef' as HexString], /not a function of the v3\.3 Hub/],
      [
        'the same calldata twice',
        () => [orderCall(issueShares('3')), orderCall(issueShares('3'))],
        /Pool\.claimsAfterExecution.*same calldata twice/,
      ],
    ]

    for (const [name, group, message] of cases) {
      it(name, async () => {
        const subject = rig()
        const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')
        const indexer = stubIndexer(subject.centrifuge, {})
        let error: unknown
        try {
          await new Pool(subject.centrifuge, pool33Id).claimsAfterExecution(group())
        } catch (e) {
          error = e
        }

        expect((error as Error).message).to.match(message)
        expect(protocolContext.called).to.equal(false)
        expect(subject.readContract.called).to.equal(false)
        expect(indexer.called).to.equal(false)
        expect(subject.sent).to.deep.equal([])
      })
    }
  })

  it('refuses a v3.2 pool with UnsupportedForProtocolVersionError, after the checks that read nothing', async () => {
    const subject = rig()
    const indexer = stubIndexer(subject.centrifuge, {})
    let error: unknown
    try {
      await new Pool(subject.centrifuge, pool32Id).claimsAfterExecution([
        orderCall(issueShares('3'), { poolId: pool32Id }),
      ])
    } catch (e) {
      error = e
    }

    expect(error).to.be.instanceOf(UnsupportedForProtocolVersionError)
    expect((error as Error).message).to.contain('Pool.claimsAfterExecution')
    expect(indexer.called).to.equal(false)
    expect(subject.sent).to.deep.equal([])
  })

  describe('hasClaimsAfterExecution', () => {
    const pool = () => new Pool(rig().centrifuge, pool33Id)

    it('is true for a group that issues shares and for one that revokes them', () => {
      expect(pool().hasClaimsAfterExecution([orderCall(approveDeposits('3')), orderCall(issueShares('3'))])).to.equal(
        true
      )
      expect(pool().hasClaimsAfterExecution([orderCall(revokeShares('4'))])).to.equal(true)
      expect(pool().hasClaimsAfterExecution([orderCall(approveRedeems('5')), orderCall(revokeShares('4'))])).to.equal(
        true
      )
    })

    it('is false for a group of approves, which leave nothing to claim yet', () => {
      expect(
        pool().hasClaimsAfterExecution([orderCall(approveDeposits('3')), orderCall(approveRedeems('3'))])
      ).to.equal(false)
    })

    it('is false for a deployment group and for a share price group, as the entities build them', async () => {
      for (const name of ['PoolNetwork.deploy, first deployment on a spoke', 'ShareClass.updateSharePrice']) {
        const action = HUB_ACTIONS.find((candidate) => candidate.name.startsWith(name))!
        const subject = rig(action.reads, action.contracts)
        const { pool, write } = action.setup(subject.centrifuge)
        const calls = await callsBuiltBy(subject, write())

        expect(pool.hasClaimsAfterExecution(calls), name).to.equal(false)
        sinon.restore()
      }
    })

    it('is false for an empty group, for another pool’s issue and for calldata that is no Hub call, and never throws', () => {
      expect(pool().hasClaimsAfterExecution([])).to.equal(false)
      expect(pool().hasClaimsAfterExecution([orderCall(issueShares('3'), { poolId: pool32Id })])).to.equal(false)
      expect(pool().hasClaimsAfterExecution(['0xdeadbeef', '0x', '0x12'] as HexString[])).to.equal(false)
      expect(pool().hasClaimsAfterExecution([hubCall('notifyPool', [pool33Id.raw, SPOKE, SIGNER])])).to.equal(false)
    })

    it('reads nothing', () => {
      const subject = rig()
      const protocolContext = sinon.spy(subject.centrifuge, 'protocolContext')

      new Pool(subject.centrifuge, pool33Id).hasClaimsAfterExecution([orderCall(issueShares('3'))])

      expect(protocolContext.called).to.equal(false)
      expect(subject.readContract.called).to.equal(false)
    })
  })
})

describe('claimNotificationBudget', () => {
  it('leaves the asset’s share of the gas limit after the messages the hub batch sends, which cost less on the hub chain', () => {
    expect(claimNotificationBudget(spokeAssetId, HUB, 1, 2)).to.equal(40)
    expect(claimNotificationBudget(spokeAssetId, HUB, 2, 2)).to.equal(19)
    expect(claimNotificationBudget(new AssetId(AssetId.from(HUB, 1).raw), HUB, 1, 2)).to.equal(81)
    expect(claimNotificationBudget(spokeAssetId, HUB, 1, 50)).to.equal(0)
  })
})
