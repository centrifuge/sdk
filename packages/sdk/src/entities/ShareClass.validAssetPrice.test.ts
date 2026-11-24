import { getDeployment } from '@centrifuge/protocol'
import { expect } from 'chai'
import sinon from 'sinon'
import { ContractFunctionRevertedError } from 'viem'
import { Centrifuge } from '../Centrifuge.js'
import { stubChain, stubProjectedPools } from '../tests/utils.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { ShareClass } from './ShareClass.js'

const centrifugeId = 1
const poolId = PoolId.from(centrifugeId, 7)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centrifugeId, 5)

describe('ShareClass.validAssetPrice', () => {
  afterEach(() => sinon.restore())

  function setup(protocolVersion: '3.2' | '3.3', readContract: sinon.SinonStub) {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    stubChain(centrifuge, { readContract })
    stubProjectedPools(centrifuge, [poolId], protocolVersion)
    sinon
      .stub(centrifuge as any, '_filteredEvents')
      .returns({ pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) }) })
    const pool = new Pool(centrifuge, poolId.raw)
    return new ShareClass(centrifuge, pool, scId.raw)
  }

  it('reads the Spoke with the validity check on a 3.2 pool', async () => {
    const readContract = sinon.stub().resolves(10n ** 18n)
    const price = await setup('3.2', readContract).validAssetPrice(centrifugeId, assetId)
    const { spoke } = getDeployment('testnet', '3.2', centrifugeId).contracts
    expect(price?.toBigInt()).to.equal(10n ** 18n)
    const call = readContract.firstCall.args[0]
    expect(call.address.toLowerCase()).to.equal(spoke!.toLowerCase())
    expect(call.functionName).to.equal('pricePoolPerAsset')
    expect(call.args).to.deep.equal([poolId.raw, scId.raw, assetId.raw, true])
  })

  it('reads the SpokeRegistry on a 3.3 pool', async () => {
    const readContract = sinon.stub().resolves(10n ** 18n)
    await setup('3.3', readContract).validAssetPrice(centrifugeId, assetId)
    const { spokeRegistry } = getDeployment('testnet', '3.3', centrifugeId).contracts
    expect(readContract.firstCall.args[0].address.toLowerCase()).to.equal(spokeRegistry!.toLowerCase())
  })

  it('maps the InvalidPrice revert to null', async () => {
    const readContract = sinon
      .stub()
      .rejects(new ContractFunctionRevertedError({ abi: [], functionName: 'pricePoolPerAsset' }))
    const price = await setup('3.3', readContract).validAssetPrice(centrifugeId, assetId)
    expect(price).to.equal(null)
  })

  it('keeps every other failure as an error', async () => {
    const readContract = sinon.stub().rejects(new Error('Function "pricePoolPerAsset" not found on ABI.'))
    let error: unknown
    try {
      await setup('3.3', readContract).validAssetPrice(centrifugeId, assetId)
    } catch (e) {
      error = e
    }
    expect((error as Error).message).to.contain('not found on ABI')
  })
})
