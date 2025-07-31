import { expect } from 'chai'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Centrifuge } from '../Centrifuge.js'
import { randomAddress } from '../tests/utils.js'
import { signPermit } from './permit.js'
import { doSignMessage } from './transaction.js'

const chainId = 11155111
const someErc20 = '0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'

describe('Permit utils', () => {
  it('can sign a permit', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    centrifuge.setSigner(account)
    await centrifuge._transact(async function* (ctx) {
      const permit = yield* doSignMessage('signPermit', () => signPermit(ctx, someErc20, randomAddress(), 100n))
      expect(permit.r.startsWith('0x')).to.be.true
      expect(permit.s.startsWith('0x')).to.be.true
      expect(permit.v).to.be.oneOf([27, 28])
      console.log('p', permit)
    }, chainId)
  })
})
