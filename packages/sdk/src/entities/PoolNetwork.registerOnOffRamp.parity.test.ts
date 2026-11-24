import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { of } from 'rxjs'
import sinon from 'sinon'
import { builders, resolveProtocolContext } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

type Case = {
  name: string
  poolId: string
  hubCentrifugeId: number
  hub: string
  args: { poolId: string; scId: string; centrifugeId: string; address: HexString; refundAddress: HexString }
  accountingToken?: string
  data: HexString
  messages: Record<string, { type: string; poolId: string }[]>
}

// The fixture is the protocol package's own builder output, checked there against an independent encoding.
const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../protocol/src/builders/__fixtures__/register-on-off-ramp.json', import.meta.url),
    'utf8'
  )
) as { xLayer: Case; legacy: Case }

function subject(fixture: Case, txStrategy?: TxStrategy) {
  const centrifuge = new Centrifuge({ environment: 'mainnet', ...(txStrategy ? { txStrategy } : {}) })
  stubChain(centrifuge)
  sinon.stub(centrifuge as any, '_estimate').callsFake(() => makeThenable(of(0n)))
  const poolId = new PoolId(BigInt(fixture.poolId))
  stubProjectedPools(centrifuge, [poolId])
  const network = new PoolNetwork(centrifuge, new Pool(centrifuge, poolId.raw), Number(fixture.args.centrifugeId))
  return { centrifuge, network, scId: new ShareClassId(fixture.args.scId as HexString) }
}

describe('registerOnOffRampManagerAsBSManager against the protocol fixture', () => {
  afterEach(() => sinon.restore())

  for (const [label, fixture] of [
    ['X Layer', fixtures.xLayer],
    ['legacy network', fixtures.legacy],
  ] as const) {
    it(`${label}: the local build equals the fixture calldata, hub and messages`, async () => {
      const { centrifuge, network, scId } = subject(fixture)

      const built = await centrifuge.buildOnly(
        network.registerOnOffRampManagerAsBSManager(fixture.args.address, scId, {
          refundAddress: fixture.args.refundAddress,
        }),
        { fromAddress: fixture.args.refundAddress }
      )

      expect(built.data).to.equal(fixture.data)
      expect(built.to.toLowerCase()).to.equal(fixture.hub.toLowerCase())
      const expected = Object.fromEntries(
        Object.entries(fixture.messages).map(([centrifugeId, messages]) => [
          centrifugeId,
          messages.map((message) => ({
            type: MessageType[message.type as keyof typeof MessageType],
            poolId: message.poolId,
          })),
        ])
      )
      const actual = Object.fromEntries(
        Object.entries(built.messages ?? {}).map(([centrifugeId, messages]) => [
          centrifugeId,
          messages.map((message: any) => ({ type: message.type, poolId: message.poolId.raw.toString() })),
        ])
      )
      expect(actual).to.deep.equal(expected)
    })

    it(`${label}: the backend payload fed to the builder equals the fixture calldata`, async () => {
      const actions: PoolAction[] = []
      const strategy: TxStrategy = {
        prepare(action: PoolAction) {
          actions.push(action)
          return of({
            route: 'custodial',
            txId: 'tx-parity',
            signerType: 'fordefi',
            status: 'pending_approval',
          } satisfies PrepareOutcome)
        },
      }
      const { network, scId } = subject(fixture, strategy)

      await new Promise((resolve) =>
        (
          network.registerOnOffRampManagerAsBSManager(fixture.args.address, scId, {
            refundAddress: fixture.args.refundAddress,
          }) as any
        ).subscribe({ complete: resolve, error: resolve })
      )

      expect(actions).to.have.length(1)
      const { action, payload } = actions[0]!
      const context = (centrifugeId: number) =>
        resolveProtocolContext(fixture.poolId, '3.2', { environment: 'mainnet', centrifugeId })
      const hubContext = context(fixture.hubCentrifugeId)
      const built =
        action === 'registerOnOffRamp'
          ? builders.registerOnOffRamp(hubContext, payload as any, context(Number(fixture.args.centrifugeId)))
          : builders.updateBalanceSheetManagers(hubContext, payload as any)

      expect(action).to.equal(fixture.accountingToken ? 'registerOnOffRamp' : 'updateBalanceSheetManagers')
      expect(built.data).to.equal(fixture.data)
    })
  }
})
