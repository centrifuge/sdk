import { expect } from 'chai'
import { zeroAddress } from 'viem'
import { toAccountingTokenId } from './accountingToken.js'

describe('toAccountingTokenId', () => {
  it('matches the registered HYB USDC token IDs on X Layer', () => {
    const poolId = 281474976710671n
    const asset = '0xb6ceceab302e2e4948951ee7843fc24e92933061'
    expect(toAccountingTokenId(poolId, asset, false)).to.equal(
      411376139330324476711579443248626800522567278819732540068409441n
    )
    expect(toAccountingTokenId(poolId, asset, true)).to.equal(
      57896044618658509087924822828820665506078240959620804587007611736496633229409n
    )
  })

  it('encodes zero values and keeps the liability flag separate', () => {
    expect(toAccountingTokenId(0n, zeroAddress, false)).to.equal(0n)
    expect(toAccountingTokenId(0n, zeroAddress, true)).to.equal(1n << 255n)
  })

  it('preserves all 64 pool bits and 160 asset bits at their boundaries', () => {
    const poolId = (1n << 64n) - 1n
    const asset = '0xffffffffffffffffffffffffffffffffffffffff'
    expect(toAccountingTokenId(poolId, asset, false)).to.equal((1n << 224n) - 1n)
    expect(toAccountingTokenId(poolId, asset, true)).to.equal((1n << 255n) | ((1n << 224n) - 1n))
    expect(toAccountingTokenId(poolId, '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', false)).to.equal(
      toAccountingTokenId(poolId, asset, false)
    )
  })
})
