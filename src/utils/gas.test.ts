import { expect } from 'chai'
import { assertBatchGasWithinLimit } from './gas.js'

describe('utils/gas', () => {
  it('does not throw when batch gas is within the max batch gas limit', () => {
    expect(() => assertBatchGasWithinLimit(250n, 300n, 2)).to.not.throw()
  })

  it('throws when batch gas exceeds the max batch gas limit', () => {
    expect(() => assertBatchGasWithinLimit(400n, 300n, 2)).to.throw(
      'Batch gas 400 exceeds limit 300 for chain 2'
    )
  })
})

