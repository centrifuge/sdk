import { expect } from 'chai'
import { describeCrosschainMessage, isCrosschainMessageDescriptionComplete } from './crosschainMessageDescription.js'

// Addresses arrive left-aligned in a 32-byte word (address high bytes, zero-padded tail),
// so `relevantBytes: 20` keeps the leading address and drops the padding.
const ADDRESS = '0xac4e6f1234567890abcdef1234567890abcd0032000000000000000000000000'

describe('describeCrosschainMessage', () => {
  it('describes pool/share deployment from token context', () => {
    expect(
      describeCrosschainMessage(
        { messageType: 'NotifyPool', data: {} },
        { token: { name: 'Anemoy', symbol: 'ANEMOY' } }
      )
    ).to.equal('Deploy pool Anemoy')
    expect(
      describeCrosschainMessage(
        { messageType: 'NotifyShareClass', data: {} },
        { token: { name: 'Anemoy', symbol: 'ANEMOY' } }
      )
    ).to.equal('Deploy share token ANEMOY')
  })

  it('falls back to [??] when no token label is available', () => {
    expect(describeCrosschainMessage({ messageType: 'NotifyPool', data: {} })).to.equal('Deploy pool [??]')
  })

  it('scales and rounds prices (18 decimals, 6 places)', () => {
    const data = { price: 1234567890000000000n.toString() } // 1.23456789e18 -> 1.234568
    expect(
      describeCrosschainMessage({ messageType: 'NotifyPricePoolPerShare', data }, { token: { symbol: 'USDC' } })
    ).to.equal('Update USDC price to 1.234568')
    expect(describeCrosschainMessage({ messageType: 'NotifyPricePoolPerAsset', data })).to.equal(
      'Update asset price to 1.234568'
    )
  })

  it('scales transfer amounts using context decimals and destination', () => {
    const data = { amount: 5_000000n.toString() }
    const ctx = {
      token: { name: 'USDC', symbol: 'USDC' },
      toBlockchain: { id: '1', centrifugeId: 1 as const, network: 'ethereum' },
      tokenDecimals: 6,
    }
    expect(describeCrosschainMessage({ messageType: 'InitiateTransferShares', data }, ctx)).to.equal(
      'Initiate transfer of 5.000000 USDC to Ethereum'
    )
    expect(describeCrosschainMessage({ messageType: 'ExecuteTransferShares', data }, ctx)).to.equal(
      'Transfer 5.000000 USDC to Ethereum'
    )
  })

  it('shortens addresses in upgrade/manager messages', () => {
    expect(describeCrosschainMessage({ messageType: 'ScheduleUpgrade', data: { target: ADDRESS } })).to.equal(
      'Schedule upgrade 0xac4...032'
    )
    expect(describeCrosschainMessage({ messageType: 'SetRequestManager', data: { manager: ADDRESS } })).to.equal(
      'Set 0xac4...032 as request manager'
    )
  })

  it('handles vault kind variants', () => {
    const ctx = { token: { symbol: 'ANEMOY' } }
    expect(describeCrosschainMessage({ messageType: 'UpdateVault', data: { kind: 0 } }, ctx)).to.equal(
      'Deploy ANEMOY vault'
    )
    expect(describeCrosschainMessage({ messageType: 'UpdateVault', data: { kind: 1 } }, ctx)).to.equal(
      'Link ANEMOY vault'
    )
    expect(describeCrosschainMessage({ messageType: 'UpdateVault', data: { kind: 2 } }, ctx)).to.equal(
      'Unlink ANEMOY vault'
    )
  })

  it('reads nested decodedPayload for restriction/request messages', () => {
    expect(
      describeCrosschainMessage({
        messageType: 'UpdateRestriction',
        data: { decodedPayload: { type: 'Member', data: { user: ADDRESS } } },
      })
    ).to.equal('Add 0xac4...032 as investor')
    expect(
      describeCrosschainMessage({ messageType: 'UpdateRestriction', data: { decodedPayload: { type: 'Freeze' } } })
    ).to.equal('Freeze/unfreeze investor')
    expect(
      describeCrosschainMessage({
        messageType: 'Request',
        data: { decodedPayload: { type: 'DepositRequest', data: { investor: ADDRESS } } },
      })
    ).to.equal('Deposit request by 0xac4...032')
    expect(
      describeCrosschainMessage({
        messageType: 'RequestCallback',
        data: { decodedPayload: { type: 'FulfilledDepositRequest' } },
      })
    ).to.equal('Fulfilled deposit request')
  })

  it('un-camel-cases unknown message types instead of throwing', () => {
    expect(describeCrosschainMessage({ messageType: 'SomeBrandNewMessage', data: {} })).to.equal(
      'Some brand new message'
    )
  })

  it('reports description completeness per message type', () => {
    expect(isCrosschainMessageDescriptionComplete('NotifyPool')).to.equal(true)
    expect(isCrosschainMessageDescriptionComplete('UpdateShares')).to.equal(false)
    expect(isCrosschainMessageDescriptionComplete('Nonexistent')).to.equal(false)
  })
})
