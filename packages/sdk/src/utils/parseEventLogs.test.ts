import { defaultEventDecodeTable } from '@centrifuge/protocol'
import { expect } from 'chai'
import { parseEventLogs } from './transaction.js'

const transfer = {
  address: '0xab73766808d3e127e073661ee32e39cf2b2a1a54',
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    '0x000000000000000000000000c1a929cbc122ddb8794287d05bf890e41f23c8cb',
  ],
  data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
} as never

describe('parseEventLogs', () => {
  it('runs with several protocol versions registered', () => {
    expect(Object.keys(defaultEventDecodeTable()).length).to.be.greaterThan(1)
  })

  for (const protocolVersion of ['3.2', '3.3'] as const) {
    it(`decodes with an explicit ${protocolVersion} table`, () => {
      const [log] = parseEventLogs({ logs: [transfer], protocolVersion })
      expect(log?.eventName).to.equal('Transfer')
      expect((log?.args as { value: bigint }).value).to.equal(100n * 10n ** 18n)
    })
  }

  it('refuses an ambiguous table instead of decoding nothing', () => {
    expect(() => parseEventLogs({ logs: [transfer] })).to.throw(/requires an explicit protocolVersion/)
    expect(() => parseEventLogs({ logs: [] })).to.throw(/requires an explicit protocolVersion/)
  })
})
