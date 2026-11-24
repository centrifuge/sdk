import { DEPLOYMENTS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import type * as sdk from '../index.js'
import {
  DeploymentMismatchError,
  KNOWN_DEPLOYMENTS,
  type IndexerDeployment,
  type IndexerDeploymentResponse,
  type KnownDeployment,
  type VerifyOptions,
} from './deploymentsCompat.js'

// The 2.10.0 allowlist API stays exported from the package entry point, under the same names.
type Exported = [
  sdk.KnownDeployment,
  sdk.IndexerDeployment,
  sdk.IndexerDeploymentResponse,
  sdk.VerifyOptions,
  typeof sdk.KNOWN_DEPLOYMENTS,
  sdk.DeploymentMismatchError,
]

describe('config/deploymentsCompat (2.10.0 allowlist API, deprecated)', () => {
  it('keeps DeploymentMismatchError an Error with its 2.10.0 fields and name', () => {
    const error = new DeploymentMismatchError(1, 'hub', '0xexpected', '0xactual')

    expect(error).to.be.instanceOf(Error)
    expect(error).to.be.instanceOf(DeploymentMismatchError)
    expect(error.name).to.equal('DeploymentMismatchError')
    expect([error.centrifugeId, error.field, error.expected, error.actual]).to.deep.equal([
      1,
      'hub',
      '0xexpected',
      '0xactual',
    ])
    expect(error.message).to.contain("centrifugeId=1 field='hub'")
  })

  it('lists the bundled address book v3.2 mainnet stacks in the 2.10.0 shape', () => {
    const bundled = DEPLOYMENTS_V3_2.mainnet
    expect(Object.keys(KNOWN_DEPLOYMENTS)).to.deep.equal(Object.keys(bundled)).and.not.be.empty

    for (const [centrifugeId, { chainId, name, contracts }] of Object.entries(bundled)) {
      const known: KnownDeployment = KNOWN_DEPLOYMENTS[Number(centrifugeId)]!
      expect(known).to.deep.equal({ name, chainId, ...contracts })
      expect(known.chainId).to.be.a('number')
      expect(known.name).to.be.a('string')
      for (const address of Object.values(contracts)) expect(address).to.match(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('cannot be modified, so no caller mistakes it for something the SDK reads', () => {
    expect(() => {
      ;(KNOWN_DEPLOYMENTS as Record<number, unknown>)[999] = { chainId: 0, name: 'nowhere' }
    }).to.throw(TypeError)
    expect(KNOWN_DEPLOYMENTS[999]).to.equal(undefined)
  })

  it('accepts the values code written against 2.10.0 builds', () => {
    // These compile only while the types keep their 2.10.0 shape.
    const options: VerifyOptions = { allowUnknownDeployments: true }
    const response: IndexerDeploymentResponse = {
      blockchains: { items: [{ id: '1', centrifugeId: '1', name: 'ethereum', icon: 'icon.svg' }] },
      deployments: { items: [] },
    }
    const indexerIds: Pick<IndexerDeployment, 'chainId' | 'centrifugeId'> = { chainId: '1', centrifugeId: '1' }
    const known: KnownDeployment = { chainId: 1, name: 'ethereum', hub: '0x0000000000000000000000000000000000000001' }
    const exported: Exported | undefined = undefined

    expect([options, response, indexerIds, known, exported]).to.have.length(5)
  })
})
