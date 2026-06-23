import { expect } from 'chai'
import sinon from 'sinon'
import { UnknownDeploymentError, verifyDeployments, type IndexerDeploymentResponse } from './verifyDeployments.js'
import type { KnownDeployment } from './deployments.js'
import type { HexString } from '../types/index.js'

const ADDR_A = '0x1111111111111111111111111111111111111111' as HexString
const ADDR_B = '0x2222222222222222222222222222222222222222' as HexString
const ADDR_A_LOWER = ADDR_A.toLowerCase() as HexString
const ADDR_EVIL = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead' as HexString

function makeDeployment(overrides: Record<string, string> = {}) {
  return {
    centrifugeId: '1',
    chainId: '11155111',
    accounting: ADDR_A,
    asyncRequestManager: ADDR_A,
    asyncVaultFactory: ADDR_A,
    balanceSheet: ADDR_A,
    batchRequestManager: ADDR_A,
    circleDecoder: ADDR_A,
    contractUpdater: ADDR_A,
    freelyTransferableHook: ADDR_A,
    freezeOnlyHook: ADDR_A,
    fullRestrictionsHook: ADDR_A,
    gasService: ADDR_A,
    gateway: ADDR_A,
    globalEscrow: ADDR_A,
    holdings: ADDR_A,
    hub: ADDR_A,
    hubHandler: ADDR_A,
    hubRegistry: ADDR_A,
    identityValuation: ADDR_A,
    merkleProofManagerFactory: ADDR_A,
    messageDispatcher: ADDR_A,
    messageProcessor: ADDR_A,
    multiAdapter: ADDR_A,
    navManager: ADDR_A,
    onOfframpManagerFactory: ADDR_A,
    opsGuardian: ADDR_A,
    oracleValuation: ADDR_A,
    poolEscrowFactory: ADDR_A,
    protocolGuardian: ADDR_A,
    queueManager: ADDR_A,
    redemptionRestrictionsHook: ADDR_A,
    refundEscrowFactory: ADDR_A,
    root: ADDR_A,
    shareClassManager: ADDR_A,
    simplePriceManager: ADDR_A,
    spoke: ADDR_A,
    syncDepositVaultFactory: ADDR_A,
    syncManager: ADDR_A,
    tokenFactory: ADDR_A,
    tokenRecoverer: ADDR_A,
    vaultDecoder: ADDR_A,
    vaultRegistry: ADDR_A,
    vaultRouter: ADDR_A,
    ...overrides,
  } as IndexerDeploymentResponse['deployments']['items'][number]
}

function makeAllowlistEntry(overrides: Partial<KnownDeployment> = {}): KnownDeployment {
  return {
    name: 'sepolia',
    chainId: 11155111,
    accounting: ADDR_A,
    asyncRequestManager: ADDR_A,
    asyncVaultFactory: ADDR_A,
    balanceSheet: ADDR_A,
    batchRequestManager: ADDR_A,
    circleDecoder: ADDR_A,
    contractUpdater: ADDR_A,
    freelyTransferableHook: ADDR_A,
    freezeOnlyHook: ADDR_A,
    fullRestrictionsHook: ADDR_A,
    gasService: ADDR_A,
    gateway: ADDR_A,
    globalEscrow: ADDR_A,
    holdings: ADDR_A,
    hub: ADDR_A,
    hubHandler: ADDR_A,
    hubRegistry: ADDR_A,
    identityValuation: ADDR_A,
    merkleProofManagerFactory: ADDR_A,
    messageDispatcher: ADDR_A,
    messageProcessor: ADDR_A,
    multiAdapter: ADDR_A,
    navManager: ADDR_A,
    onOfframpManagerFactory: ADDR_A,
    opsGuardian: ADDR_A,
    oracleValuation: ADDR_A,
    poolEscrowFactory: ADDR_A,
    protocolGuardian: ADDR_A,
    queueManager: ADDR_A,
    redemptionRestrictionsHook: ADDR_A,
    refundEscrowFactory: ADDR_A,
    root: ADDR_A,
    shareClassManager: ADDR_A,
    simplePriceManager: ADDR_A,
    spoke: ADDR_A,
    syncDepositVaultFactory: ADDR_A,
    syncManager: ADDR_A,
    tokenFactory: ADDR_A,
    tokenRecoverer: ADDR_A,
    vaultDecoder: ADDR_A,
    vaultRegistry: ADDR_A,
    vaultRouter: ADDR_A,
    ...overrides,
  }
}

function makeResponse(
  deployments: ReturnType<typeof makeDeployment>[] = [makeDeployment()]
): IndexerDeploymentResponse {
  return {
    blockchains: { items: [{ id: '11155111', centrifugeId: '1', name: 'sepolia' }] },
    deployments: { items: deployments },
  }
}

describe('verifyDeployments', () => {
  it('passes through unchanged when allowlist matches', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse()
    const result = verifyDeployments(data, allowlist)
    expect(result).to.equal(data)
  })

  it('accepts case-insensitive address matches', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ hub: ADDR_A_LOWER })])
    expect(() => verifyDeployments(data, allowlist)).not.to.throw()
  })

  it('drops a mismatched address (and warns) instead of rejecting the whole response', () => {
    const warn = sinon.stub(console, 'warn')
    try {
      const allowlist = { 1: makeAllowlistEntry() }
      const data = makeResponse([makeDeployment({ hub: ADDR_EVIL })])
      const result = verifyDeployments(data, allowlist)
      const item = result.deployments.items[0] as Record<string, unknown>
      // Mismatched field is removed so it can never be used...
      expect(item.hub).to.equal(undefined)
      // ...but every other field on the deployment is untouched.
      expect(item.spoke).to.equal(ADDR_A)
      expect(warn.calledOnce).to.equal(true)
      expect(warn.firstCall.args[0]).to.contain("field='hub'")
    } finally {
      warn.restore()
    }
  })

  it('only drops the offending field, leaving other deployments intact', () => {
    const warn = sinon.stub(console, 'warn')
    try {
      const allowlist = { 1: makeAllowlistEntry(), 2: makeAllowlistEntry({ name: 'other', chainId: 2 }) }
      const good = makeDeployment({ centrifugeId: '2' })
      const bad = makeDeployment({ centrifugeId: '1', spoke: ADDR_EVIL })
      const result = verifyDeployments(makeResponse([good, bad]), allowlist)
      const goodItem = result.deployments.items[0] as Record<string, unknown>
      const badItem = result.deployments.items[1] as Record<string, unknown>
      expect(goodItem.spoke).to.equal(ADDR_A) // untouched chain unaffected
      expect(badItem.spoke).to.equal(undefined) // only the mismatched field dropped
      expect(badItem.hub).to.equal(ADDR_A)
    } finally {
      warn.restore()
    }
  })

  it('throws UnknownDeploymentError for an unknown centrifugeId in strict mode (default)', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ centrifugeId: '999' })])
    expect(() => verifyDeployments(data, allowlist)).to.throw(UnknownDeploymentError)
  })

  it('allows unknown centrifugeId when allowUnknownDeployments=true', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ centrifugeId: '999' })])
    expect(() => verifyDeployments(data, allowlist, { allowUnknownDeployments: true })).not.to.throw()
  })

  it('still drops mismatches on known centIds even when allowUnknownDeployments=true', () => {
    const warn = sinon.stub(console, 'warn')
    try {
      const allowlist = { 1: makeAllowlistEntry() }
      const data = makeResponse([makeDeployment({ hub: ADDR_EVIL })])
      const result = verifyDeployments(data, allowlist, { allowUnknownDeployments: true })
      expect((result.deployments.items[0] as Record<string, unknown>).hub).to.equal(undefined)
      expect(warn.calledOnce).to.equal(true)
    } finally {
      warn.restore()
    }
  })

  it('skips fields the indexer omits (allowlist is a superset of the SDK query)', () => {
    // The bundled allowlist is generated from the protocol repo and contains
    // every deployed contract; the SDK's GraphQL query is a subset. Fields
    // absent from the indexer response are skipped — the verifier only checks
    // what came back. A substituted address that IS returned is still handled
    // (covered by 'drops a mismatched address' above).
    const allowlist = { 1: makeAllowlistEntry() }
    const partial = makeDeployment()
    delete (partial as Record<string, unknown>).hub
    const data = makeResponse([partial])
    expect(() => verifyDeployments(data, allowlist)).not.to.throw()
  })

  it('skips verification with a warning when the allowlist is empty', () => {
    const data = makeResponse([makeDeployment({ hub: ADDR_EVIL })])
    expect(() => verifyDeployments(data, {})).not.to.throw()
  })

  it('tolerates optional contract fields missing from the allowlist', () => {
    // wormholeAdapter, axelarAdapter, etc are optional in ProtocolContracts;
    // an indexer that returns them shouldn't fail just because the bundled
    // allowlist omits them.
    const allowlist = { 1: makeAllowlistEntry({ wormholeAdapter: undefined }) }
    const data = makeResponse([makeDeployment({ wormholeAdapter: ADDR_B })])
    expect(() => verifyDeployments(data, allowlist)).not.to.throw()
  })

  it('throws on non-numeric centrifugeId', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ centrifugeId: 'not-a-number' })])
    expect(() => verifyDeployments(data, allowlist)).to.throw(/non-numeric centrifugeId/)
  })
})
