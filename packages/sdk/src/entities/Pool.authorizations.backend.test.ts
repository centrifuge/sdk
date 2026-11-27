import { ABIS_V3_3, resolveProtocolContext } from '@centrifuge/protocol'
import { expect } from 'chai'
import { firstValueFrom, of, toArray } from 'rxjs'
import sinon from 'sinon'
import { encodeFunctionData, zeroAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { Centrifuge } from '../Centrifuge.js'
import { backendRoutingTable } from '../data/routing.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import type { PoolAction, PrepareOutcome, TxStrategy } from '../tx/TxStrategy.js'
import type { HexString } from '../types/index.js'
import { PoolId } from '../utils/types.js'
import { Pool } from './Pool.js'

const pool33Id = PoolId.from(1, 33)
const manager = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const addresses33 = resolveProtocolContext(pool33Id.raw.toString(), '3.3', { environment: 'testnet' }).addresses
const hub33 = addresses33.hub!
const candidatePolicy = '0x1010101010101010101010101010101010101010' as HexString
const call = encodeFunctionData({
  abi: ABIS_V3_3.Hub,
  functionName: 'updateHubManager',
  args: [pool33Id.raw, '0x19f46d8130e610c6c0f0116ea40fb781defade93', true],
})

/** An EIP-1193 wallet that records what it is asked to send, as a browser wallet would receive it. */
function recordingWallet() {
  const sent: { to: HexString; data: HexString }[] = []
  const signer = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [manager]
        case 'eth_chainId':
          return `0x${sepolia.id.toString(16)}`
        case 'eth_sendTransaction':
          sent.push({ to: params![0].to, data: params![0].data })
          return `0x${'99'.repeat(32)}`
        default:
          throw new Error(`recordingWallet: unexpected RPC method "${method}"`)
      }
    },
  }
  return { signer, sent }
}

/** A backend-mode client whose strategy records every action it is asked to prepare. */
function backendCentrifuge({
  reads = {},
  withCode = [],
}: { reads?: Record<string, unknown>; withCode?: HexString[] } = {}) {
  const actions: PoolAction[] = []
  const strategy: TxStrategy = {
    prepare(action: PoolAction) {
      actions.push(action)
      return of({
        route: 'custodial',
        txId: 'tx-1',
        signerType: 'fordefi',
        status: 'pending_approval',
      } satisfies PrepareOutcome)
    },
  }
  const centrifuge = new Centrifuge({
    environment: 'testnet',
    dataSource: { query: () => of({}) } as any,
    txStrategy: strategy,
  })
  stubProjectedPools(centrifuge, [pool33Id], '3.3')
  stubChain(centrifuge, {
    // The pool has no hub policy, so the pre-send check of a classified write ends at this read.
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'policy') return zeroAddress
      if (functionName in reads) return reads[functionName]
      throw new Error(`unexpected read ${functionName}`)
    },
    getCode: async ({ address }: { address: HexString }) => (withCode.includes(address) ? '0x60' : undefined),
    waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({ status: 'success', hash }),
  })
  return { centrifuge, actions }
}

describe('Pool hub policy writes in backend mode', () => {
  afterEach(() => sinon.restore())

  it('builds both in the client and sends one wallet transaction each, with no action prepared by the backend', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const pool = new Pool(centrifuge, pool33Id)
    const { signer, sent } = recordingWallet()
    centrifuge.setSigner(signer as any)

    await firstValueFrom(pool.initiateAuthorizations([call]).pipe(toArray()))
    await firstValueFrom(pool.cancelAuthorization(call).pipe(toArray()))

    expect(actions).to.have.length(0)
    expect(sent).to.have.length(2)
    expect(sent.map((tx) => tx.to.toLowerCase())).to.deep.equal([hub33.toLowerCase(), hub33.toLowerCase()])
    expect(sent[0]!.data).to.equal(
      encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'initiateAuthorization', args: [pool33Id.raw, call] })
    )
    expect(sent[1]!.data).to.equal(
      encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'cancelAuthorization', args: [pool33Id.raw, call] })
    )
  })

  it('executes a group in the client and sends one wallet transaction, with no action prepared by the backend', async () => {
    const { centrifuge, actions } = backendCentrifuge()
    const pool = new Pool(centrifuge, pool33Id)
    const { signer, sent } = recordingWallet()
    centrifuge.setSigner(signer as any)

    await firstValueFrom(pool.executeAuthorizations([call]).pipe(toArray()))

    expect(actions).to.have.length(0)
    expect(sent).to.have.length(1)
    expect(sent[0]!.to.toLowerCase()).to.equal(hub33.toLowerCase())
    expect(sent[0]!.data).to.equal(call)
  })

  it('installs a policy in the client and sends one wallet transaction, with no action prepared by the backend', async () => {
    const { centrifuge, actions } = backendCentrifuge({
      reads: {
        hub: hub33,
        hubRegistry: addresses33.hubRegistry,
        multiAdapter: addresses33.multiAdapter,
        shareClassManager: addresses33.shareClassManager,
      },
      withCode: [candidatePolicy],
    })
    const pool = new Pool(centrifuge, pool33Id)
    const { signer, sent } = recordingWallet()
    centrifuge.setSigner(signer as any)

    await firstValueFrom(pool.installHubPolicy(candidatePolicy).pipe(toArray()))

    expect(actions).to.have.length(0)
    expect(sent).to.have.length(1)
    expect(sent[0]!.to.toLowerCase()).to.equal(hub33.toLowerCase())
    expect(sent[0]!.data).to.equal(
      encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName: 'setPolicy', args: [pool33Id.raw, candidatePolicy] })
    )
  })

  it('has no row in the write routing table', () => {
    const routed = Object.keys(backendRoutingTable().writes)

    expect(routed).to.not.include('initiateAuthorizations')
    expect(routed).to.not.include('initiateAuthorization')
    expect(routed).to.not.include('cancelAuthorization')
    expect(routed).to.not.include('executeAuthorizations')
    for (const name of ['installHubPolicy', 'setPolicy', 'deployHubPolicy', 'newHubPolicy']) {
      expect(routed).to.not.include(name)
    }
  })
})
