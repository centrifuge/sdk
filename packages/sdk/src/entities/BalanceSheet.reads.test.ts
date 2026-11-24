import { expect } from 'chai'
import { firstValueFrom, of, Subject } from 'rxjs'
import sinon from 'sinon'
import { ABIS_V3_3 } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

const hubId = 1
const spokeId = 2
const poolId = PoolId.from(hubId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(spokeId, 1)
const balanceSheetAddress = '0x4444444444444444444444444444444444444444'
const spokeAddress = '0x5555555555555555555555555555555555555555'
const spokeRegistryAddress = '0x7777777777777777777777777777777777777777'
const snapshotQueueAddress = '0x8888888888888888888888888888888888888888'
const escrowFactory = '0x6666666666666666666666666666666666666666'
const escrow = '0xabcdef0000000000000000000000000000000001'
const asset = '0x2222222222222222222222222222222222222222'
const tokenId = 7n

const V3_2_ABIS = { BalanceSheet: ['v3.2 BalanceSheet'], Spoke: ['v3.2 Spoke'], PoolEscrowFactory: [] }

function context(protocolVersion: '3.2' | '3.3') {
  return {
    protocolVersion,
    centrifugeId: spokeId,
    balanceSheet: protocolVersion === '3.2' ? balanceSheetAddress : undefined,
    spoke: spokeAddress,
    spokeRegistry: protocolVersion === '3.3' ? spokeRegistryAddress : undefined,
    snapshotQueue: protocolVersion === '3.3' ? snapshotQueueAddress : undefined,
    poolEscrowFactory: protocolVersion === '3.2' ? escrowFactory : undefined,
    escrowFactory: protocolVersion === '3.3' ? escrowFactory : undefined,
    contractAbis: V3_2_ABIS,
  }
}

describe('BalanceSheet reads', () => {
  let centrifuge: Centrifuge
  let pool: Pool
  let network: PoolNetwork
  let balanceSheet: BalanceSheet
  let readContract: sinon.SinonStub
  let protocolContext: sinon.SinonStub
  let events: Subject<any[]>

  function setup(protocolVersion: '3.2' | '3.3', opts: { liveEvents?: boolean } = {}) {
    centrifuge = new Centrifuge({ environment: 'testnet', disableRepeatOnEvents: !opts.liveEvents })
    pool = new Pool(centrifuge, poolId)
    network = new PoolNetwork(centrifuge, pool, spokeId)
    balanceSheet = new BalanceSheet(centrifuge, network, new ShareClass(centrifuge, pool, scId.raw))
    readContract = sinon.stub()
    readContract.withArgs(sinon.match({ functionName: 'escrow' })).resolves(escrow.toUpperCase().replace('0X', '0x'))
    readContract.withArgs(sinon.match({ functionName: 'idToAsset' })).resolves([asset, tokenId])
    readContract.withArgs(sinon.match({ functionName: 'availableBalanceOf' })).resolves(2_500_000n)
    protocolContext = sinon.stub(centrifuge, 'protocolContext').returns(of(context(protocolVersion)) as any)
    sinon.stub(centrifuge, 'getClient').returns(of({ readContract }) as any)
    sinon.stub(centrifuge, 'currency').returns(of({ decimals: 6 }) as any)
    events = new Subject()
    sinon.stub(centrifuge, '_filteredEvents').returns(events as any)
  }

  function call(functionName: string) {
    return readContract.getCalls().filter((c) => c.args[0].functionName === functionName)
  }

  afterEach(() => sinon.restore())

  describe('escrowAddress', () => {
    it("reads the pool escrow from this network's PoolEscrowFactory at the pool's version, lowercased", async () => {
      setup('3.2')

      expect(await firstValueFrom(balanceSheet.escrowAddress())).to.equal(escrow)
      expect(protocolContext.calledWith({ poolId, centrifugeId: spokeId })).to.equal(true)
      expect(call('escrow')[0]!.args[0]).to.deep.include({ address: escrowFactory, args: [poolId.raw] })
    })

    it("reads the pool escrow from this network's EscrowFactory on v3.3", async () => {
      setup('3.3')

      expect(await firstValueFrom(balanceSheet.escrowAddress())).to.equal(escrow)
      expect(call('escrow')[0]!.args[0]).to.deep.include({
        address: escrowFactory,
        abi: ABIS_V3_3.EscrowFactory,
        args: [poolId.raw],
      })
    })
  })

  describe('availableBalance', () => {
    it('resolves the asset in the pool version (v3.2: Spoke) and reads BalanceSheet with its token id', async () => {
      setup('3.2')

      const available = await firstValueFrom(balanceSheet.availableBalance(assetId))

      expect(available.toFloat()).to.equal(2.5)
      expect(available.decimals).to.equal(6)
      expect(call('idToAsset')[0]!.args[0]).to.deep.include({ address: spokeAddress, abi: V3_2_ABIS.Spoke })
      expect(call('availableBalanceOf')[0]!.args[0]).to.deep.include({
        address: balanceSheetAddress,
        abi: V3_2_ABIS.BalanceSheet,
        args: [poolId.raw, scId.raw, asset, tokenId],
      })
      // The asset is never resolved through the chain's newest version.
      expect(protocolContext.calledWith(spokeId)).to.equal(false)
    })

    it('resolves the asset in SpokeRegistry and reads Spoke with the v3.3 ABI on v3.3', async () => {
      setup('3.3')

      await firstValueFrom(balanceSheet.availableBalance(assetId))

      expect(call('idToAsset')[0]!.args[0]).to.deep.include({
        address: spokeRegistryAddress,
        abi: ABIS_V3_3.SpokeRegistry,
      })
      expect(call('availableBalanceOf')[0]!.args[0]).to.deep.include({
        address: spokeAddress,
        abi: ABIS_V3_3.Spoke,
      })
    })

    it("refuses an asset from another network instead of reading another chain's token", async () => {
      setup('3.2')

      let error: unknown
      try {
        await firstValueFrom(balanceSheet.availableBalance(AssetId.from(hubId, 1)))
      } catch (e) {
        error = e
      }

      expect(String(error)).to.contain(`not on this balance sheet's centrifugeId ${spokeId}`)
      expect(readContract.called).to.equal(false)
    })

    it('re-reads when the escrow reserves the asset for a redemption', async () => {
      setup('3.2', { liveEvents: true })
      const seen: number[] = []
      const sub = balanceSheet.availableBalance(assetId).subscribe((b) => seen.push(b.toFloat()))
      await new Promise((resolve) => setTimeout(resolve, 0))

      const [address, eventName] = (centrifuge._filteredEvents as sinon.SinonStub).firstCall.args
      expect(address).to.deep.equal([balanceSheetAddress, escrow])
      expect(eventName).to.include.members(['IncreaseReserve', 'DecreaseReserve'])

      readContract.withArgs(sinon.match({ functionName: 'availableBalanceOf' })).resolves(1_000_000n)
      events.next([{ args: { poolId: poolId.raw, scId: scId.raw, asset, tokenId } }])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(seen).to.deep.equal([2.5, 1])
      sub.unsubscribe()
    })

    it('does not read the escrow when it would only feed event refreshes that are disabled', async () => {
      setup('3.2')

      await firstValueFrom(balanceSheet.availableBalance(assetId))

      expect(call('escrow')).to.have.length(0)
    })

    it("listens on the escrow of the same context it reads the balance sheet from", async () => {
      setup('3.3', { liveEvents: true })
      const sub = balanceSheet.availableBalance(assetId).subscribe()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const [address] = (centrifuge._filteredEvents as sinon.SinonStub).firstCall.args
      expect(address).to.deep.equal([spokeAddress, escrow])
      expect(call('escrow')[0]!.args[0]).to.deep.include({ address: escrowFactory, args: [poolId.raw] })
      sub.unsubscribe()
    })

    it('refuses an asset the pool version does not register', async () => {
      setup('3.3')
      readContract
        .withArgs(sinon.match({ functionName: 'idToAsset' }))
        .resolves(['0x0000000000000000000000000000000000000000', 0n])

      let error: unknown
      try {
        await firstValueFrom(balanceSheet.availableBalance(assetId))
      } catch (e) {
        error = e
      }

      expect(String(error)).to.contain('is not registered on centrifugeId 2 at protocol 3.3')
      expect(call('availableBalanceOf')).to.have.length(0)
    })

    it('ignores events for a sibling ERC-6909 token id on the same contract', async () => {
      setup('3.2', { liveEvents: true })
      const sub = balanceSheet.availableBalance(assetId).subscribe()
      await new Promise((resolve) => setTimeout(resolve, 0))

      events.next([{ args: { poolId: poolId.raw, scId: scId.raw, asset, tokenId: tokenId + 1n } }])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(call('availableBalanceOf')).to.have.length(1)
      sub.unsubscribe()
    })
  })

  describe('Vault._availableBalance', () => {
    it("reads the vault's own asset at token id 0 through its network balance sheet", async () => {
      setup('3.2')
      const shareClass = new ShareClass(centrifuge, pool, scId.raw)
      const vault = new Vault(centrifuge, network, shareClass, asset, `0x${'9'.repeat(40)}`, assetId)

      expect((await firstValueFrom(vault._availableBalance())).toFloat()).to.equal(2.5)
      expect(call('availableBalanceOf')[0]!.args[0]).to.deep.include({
        address: balanceSheetAddress,
        args: [poolId.raw, scId.raw, asset, 0n],
      })
      // The vault knows its asset: `assetId` is not re-resolved, which a pre-3.3 vault on a
      // migrated pool could resolve differently, and nothing is read for events it does not watch.
      expect(call('idToAsset')).to.have.length(0)
      expect(call('escrow')).to.have.length(0)
    })
  })

  describe('queued', () => {
    function queueReads() {
      readContract.withArgs(sinon.match({ functionName: 'queuedAssets' })).resolves([5_000_000n, 0n])
      readContract.withArgs(sinon.match({ functionName: 'queuedShares' })).resolves([0n, true, 0, 0n])
      sinon.stub(pool, 'decimals').returns(of(18) as any)
    }

    it('re-reads when a v3.2 BalanceSheet queues a note withdraw for the share class', async () => {
      setup('3.2', { liveEvents: true })
      queueReads()
      const seen: number[] = []
      const sub = balanceSheet.queued([assetId]).subscribe((q) => seen.push(q.assets[0]!.withdrawals.toFloat()))
      await new Promise((resolve) => setTimeout(resolve, 0))

      const [address, eventName] = (centrifuge._filteredEvents as sinon.SinonStub).firstCall.args
      expect(address).to.equal(balanceSheetAddress)
      expect(eventName).to.include.members(['Deposit', 'NoteDeposit', 'Withdraw', 'NoteWithdraw'])

      readContract.withArgs(sinon.match({ functionName: 'queuedAssets' })).resolves([5_000_000n, 2_000_000n])
      events.next([{ args: { poolId: poolId.raw, scId: ShareClassId.from(poolId, 2).raw } }])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(seen).to.deep.equal([0])

      events.next([{ args: { poolId: poolId.raw, scId: scId.raw } }])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(seen).to.deep.equal([0, 2])
      sub.unsubscribe()
    })

    it('listens on the v3.3 SnapshotQueue for queue and submit events', async () => {
      setup('3.3', { liveEvents: true })
      queueReads()
      const sub = balanceSheet.queued([assetId]).subscribe()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const [address, eventName] = (centrifuge._filteredEvents as sinon.SinonStub).firstCall.args
      expect(address).to.equal(snapshotQueueAddress)
      expect(eventName).to.deep.equal(['QueueAssets', 'QueueShares', 'SubmitQueuedAssets', 'SubmitQueuedShares'])
      sub.unsubscribe()
    })
  })
})
