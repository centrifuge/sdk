import { expect } from 'chai'
import sinon from 'sinon'
import { firstValueFrom } from 'rxjs'
import { Centrifuge } from '../Centrifuge.js'
import { arc, chains, hyperliquidEvmTestnet } from './chains.js'

const ARC_CHAIN_ID = 5042
const ARC_CENTRIFUGE_ID = 14
const ARC_DEFAULT_RPC = 'https://rpc.mainnet.arc.io'

describe('mainnet chain configuration', () => {
  let warn: sinon.SinonStub

  beforeEach(() => {
    warn = sinon.stub(console, 'warn')
  })

  afterEach(() => {
    warn.restore()
  })

  it('bundles a default RPC for Arc', () => {
    expect(arc.id).to.equal(ARC_CHAIN_ID)
    expect(arc.rpcUrls.default.http).to.deep.equal([ARC_DEFAULT_RPC])
  })

  it('declares Multicall3 on every chain, testnets included, so reads can be batched', () => {
    const missing = chains.filter((chain) => !chain.contracts?.multicall3).map((chain) => chain.name)
    expect(missing).to.deep.equal([])
  })

  it('declares Multicall3 so reads on Arc can be batched', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const client = await firstValueFrom(centrifuge.getClient(ARC_CENTRIFUGE_ID))
    expect(client.chain.contracts?.multicall3?.address).to.equal('0xcA11bde05977b3631167028862bE2a173976CA11')
  })

  it('declares Multicall3 on HyperEVM testnet, which viem leaves out, at the address deployed there', () => {
    expect(hyperliquidEvmTestnet.id).to.equal(998)
    expect(hyperliquidEvmTestnet.contracts?.multicall3?.address).to.equal('0xcA11bde05977b3631167028862bE2a173976CA11')
  })

  it('builds an Arc client without any configuration', () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    expect(centrifuge.chains).to.include(ARC_CHAIN_ID)
  })

  it('reaches Arc on the bundled RPC when none is configured', async () => {
    const centrifuge = new Centrifuge({ environment: 'mainnet' })
    const client = await firstValueFrom(centrifuge.getClient(ARC_CENTRIFUGE_ID))
    expect(client.transport.url).to.equal(ARC_DEFAULT_RPC)
  })

  it('prefers a configured RPC over the bundled one', async () => {
    const configured = 'https://arc.example.test/rpc'
    const centrifuge = new Centrifuge({ environment: 'mainnet', rpcUrls: { [ARC_CHAIN_ID]: configured } })
    const client = await firstValueFrom(centrifuge.getClient(ARC_CENTRIFUGE_ID))
    expect(client.transport.url).to.equal(configured)
  })
})
