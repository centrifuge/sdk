import { expect } from 'chai'
import {
  DeploymentMismatchError,
  UnknownDeploymentError,
  verifyDeployments,
  type IndexerDeploymentResponse,
} from './verifyDeployments.js'
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

function makeResponse(deployments: ReturnType<typeof makeDeployment>[] = [makeDeployment()]): IndexerDeploymentResponse {
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

  it('throws DeploymentMismatchError when an indexer address differs from the allowlist', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ hub: ADDR_EVIL })])
    expect(() => verifyDeployments(data, allowlist))
      .to.throw(DeploymentMismatchError)
      .with.property('field', 'hub')
  })

  it('reports the offending centrifugeId and field in the error', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ spoke: ADDR_EVIL })])
    try {
      verifyDeployments(data, allowlist)
      expect.fail('expected throw')
    } catch (err) {
      expect(err).to.be.instanceOf(DeploymentMismatchError)
      const e = err as DeploymentMismatchError
      expect(e.centrifugeId).to.equal(1)
      expect(e.field).to.equal('spoke')
      expect(e.actual).to.equal(ADDR_EVIL)
      expect(e.expected.toLowerCase()).to.equal(ADDR_A.toLowerCase())
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

  it('still rejects mismatches on known centIds even when allowUnknownDeployments=true', () => {
    const allowlist = { 1: makeAllowlistEntry() }
    const data = makeResponse([makeDeployment({ hub: ADDR_EVIL })])
    expect(() => verifyDeployments(data, allowlist, { allowUnknownDeployments: true })).to.throw(
      DeploymentMismatchError
    )
  })

  it('skips fields the indexer omits (allowlist is a superset of the SDK query)', () => {
    // The bundled allowlist is generated from the protocol repo and contains
    // every deployed contract; the SDK's GraphQL query is a subset. Fields
    // absent from the indexer response are skipped — the verifier only checks
    // what came back. A substituted address is still caught (covered by
    // 'throws DeploymentMismatchError when an indexer address differs' above).
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
