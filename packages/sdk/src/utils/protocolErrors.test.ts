import { V33_MIGRATION_ABI_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { encodeErrorResult } from 'viem'
import { BATCH_TOO_EXPENSIVE, describeRevert } from '../entities/MigrationPlan.js'
import { protocolErrorName } from './protocolErrors.js'

const EPOCHS_NOT_SYNCED = encodeErrorResult({
  abi: V33_MIGRATION_ABI_V3_3,
  errorName: 'EpochsNotSynced',
  args: ['0x00010000000003e80000000000000001', 281474976710657n],
})
const NAMED = 'EpochsNotSynced(0x00010000000003e80000000000000001, 281474976710657)'

describe('protocolErrorName', () => {
  it('names a revert from the protocol errors with its arguments', () => {
    expect(protocolErrorName('0xdd629f86')).to.equal('NotEnoughGas()')
    expect(protocolErrorName(EPOCHS_NOT_SYNCED)).to.equal(NAMED)
  })

  it('leaves a selector no protocol error has unnamed', () => {
    expect(protocolErrorName('0xdeadbeef')).to.equal(undefined)
  })
})

describe('describeRevert', () => {
  it('names a protocol error instead of printing its raw data, as the drain stop of pool 281474976711656 did', () => {
    expect(describeRevert(EPOCHS_NOT_SYNCED)).to.equal(NAMED)
  })

  it('keeps the slicing hint for a batch the gateway refuses, and the raw data for an unknown revert', () => {
    expect(describeRevert(BATCH_TOO_EXPENSIVE)).to.match(
      /^IGateway\.BatchTooExpensive \(the batch needs slicing\), raw/
    )
    expect(describeRevert('0xdeadbeef00')).to.equal('revert 0xdeadbeef, data 0xdeadbeef00')
  })
})
