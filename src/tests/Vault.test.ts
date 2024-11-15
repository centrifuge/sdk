import { expect } from 'chai'
import { firstValueFrom, skip, skipWhile } from 'rxjs'
import sinon from 'sinon'
import { Pool } from '../Pool.js'
import { PoolNetwork } from '../PoolNetwork.js'
import { Vault } from '../Vault.js'
import { context } from './setup.js'

const poolId = '2779829532'
const trancheId = '0xac6bffc5fd68f7772ceddec7b0a316ca'
const asset = '0x8503b4452bf6238cc76cdbee223b46d7196b1c93'
const vaultAddress = '0x05eb35c2e4fa21fb06d3fab92916191b254b3504'
const investorA = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'

describe('Vault', () => {
  let vault: Vault
  beforeEach(() => {
    const { centrifuge } = context
    const pool = new Pool(centrifuge, poolId)
    const poolNetwork = new PoolNetwork(centrifuge, pool, 11155111)
    vault = new Vault(centrifuge, poolNetwork, trancheId, asset, vaultAddress)
  })

  it('get investment details for an investor', async () => {
    const fetchSpy = sinon.spy(globalThis, 'fetch')
    const investment = await vault.investment(investorA)
    expect(investment.isAllowedToInvest).to.equal(true)
    // Calls should get batched
    expect(fetchSpy.getCalls().length).to.equal(4)
  })

  it('should place an invest order', async () => {
    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.placeInvestOrder(100_000_000n),
      firstValueFrom(vault.investment(investorA).pipe(skipWhile((i) => i.pendingInvestCurrency !== 100_000_000n))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.pendingInvestCurrency).to.equal(100_000_000n)
  })

  it('should cancel an order', async () => {
    const investmentBefore = await vault.investment(investorA)
    expect(investmentBefore.hasPendingCancelRedeemRequest).to.equal(false)
    context.tenderlyFork.impersonateAddress = investorA
    context.centrifuge.setSigner(context.tenderlyFork.signer)
    const [result, investmentAfter] = await Promise.all([
      vault.cancelRedeemOrder(),
      firstValueFrom(vault.investment(investorA).pipe(skip(1))),
    ])
    expect(result.type).to.equal('TransactionConfirmed')
    expect(investmentAfter.hasPendingCancelRedeemRequest).to.equal(true)
  })
})
