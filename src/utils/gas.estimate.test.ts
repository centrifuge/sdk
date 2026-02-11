import { expect } from 'chai'
import sinon from 'sinon'
import { estimateBatchBridgeFee } from './gas.js'

describe('utils/gas estimate flow', () => {
  it('uses maxBatchGasLimit, passes summed gas to estimate, and applies estimate buffer', async () => {
    const readContract = sinon.stub()
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(100n) // messageOverallGasLimit
    readContract.onCall(1).resolves(140n) // messageOverallGasLimit
    readContract.onCall(2).resolves(500n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate

    const gasService = '0x1111111111111111111111111111111111111111'
    const multiAdapter = '0x2222222222222222222222222222222222222222'

    const result = await estimateBatchBridgeFee({
      publicClient,
      gasService,
      multiAdapter,
      gasMessagePayloads: ['0x01', '0x02'],
      toCentrifugeId: 2,
    })

    expect(result).to.equal(1165n)
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
    const publicClient = { readContract } as any
    readContract.onCall(0).resolves(200n) // messageOverallGasLimit
    readContract.onCall(1).resolves(300n) // messageOverallGasLimit
    readContract.onCall(2).resolves(400n) // maxBatchGasLimit
    readContract.onCall(3).resolves(777n) // estimate

    try {
      await estimateBatchBridgeFee({
        publicClient,
        gasService: '0x1111111111111111111111111111111111111111',
        multiAdapter: '0x2222222222222222222222222222222222222222',
        gasMessagePayloads: ['0x01', '0x02'],
        toCentrifugeId: 2,
      })
      expect.fail('Expected estimateBatchBridgeFee to throw when maxBatchGasLimit is exceeded')
    } catch (error) {
      expect((error as Error).message).to.equal('Batch gas 500 exceeds limit 400 for chain 2')
    }

    expect(readContract.calledWithMatch({ functionName: 'estimate' })).to.equal(true)
  })
})
