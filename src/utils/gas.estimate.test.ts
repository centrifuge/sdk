import { expect } from 'chai'
import sinon from 'sinon'
import { estimateBatchBridgeFee } from './gas.js'

describe('utils/gas estimate flow', () => {
  it('uses maxBatchGasLimit and passes summed gas to estimate', async () => {
    const readContract = sinon.stub()
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit
    readContract.onCall(1).resolves(140n) // messageOverallGasLimit
    readContract.onCall(2).resolves(500n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate

    const gasService = '0x1111111111111111111111111111111111111111'
    const multiAdapter = '0x2222222222222222222222222222222222222222'

    const result = await estimateBatchBridgeFee({
      readContract,
      gasService,
      multiAdapter,
      gasMessagePayloads: ['0x01', '0x02'],
      toCentrifugeId: 2,
      gasServiceAbi: [],
      multiAdapterAbi: [],
    })

    expect(result).to.equal(777n)
    expect(
      readContract.calledWithMatch({
        address: gasService,
        functionName: 'maxBatchGasLimit',
        args: [2],
      })
    ).to.equal(true)
    expect(
      readContract.calledWithMatch({
        address: multiAdapter,
        functionName: 'estimate',
        args: [2, '0x0', 240n],
      })
    ).to.equal(true)
  })

  it('throws when summed message gas exceeds maxBatchGasLimit', async () => {
    const readContract = sinon.stub()
    readContract.onCall(0).resolves(200n) // messageOverallGasLimit
    readContract.onCall(1).resolves(300n) // messageOverallGasLimit
    readContract.onCall(2).resolves(400n) // maxBatchGasLimit

    try {
      await estimateBatchBridgeFee({
        readContract,
        gasService: '0x1111111111111111111111111111111111111111',
        multiAdapter: '0x2222222222222222222222222222222222222222',
        gasMessagePayloads: ['0x01', '0x02'],
        toCentrifugeId: 2,
        gasServiceAbi: [],
        multiAdapterAbi: [],
      })
      expect.fail('Expected estimateBatchBridgeFee to throw when maxBatchGasLimit is exceeded')
    } catch (error) {
      expect((error as Error).message).to.equal('Batch gas 500 exceeds limit 400 for chain 2')
    }
  })
})
