import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import {
  BaseError,
  ContractFunctionRevertedError,
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodePacked,
  keccak256,
  pad,
  toFunctionSelector,
} from 'viem'
import { Centrifuge } from './Centrifuge.js'
import { stubChain } from './tests/utils.js'
import type { HexString } from './types/index.js'
import {
  decodeLayerZeroPacket,
  LAYER_ZERO_ENDPOINT_ABI,
  layerZeroDeliveryStatus,
  layerZeroPacketsSent,
  type LayerZeroPacket,
} from './utils/layerZeroDelivery.js'
import { makeThenable } from './utils/rx.js'

const FROM = 1
const TO = 2
const SRC_EID = 40161
const DST_EID = 40245
const OTHER_EID = 40231
const SIGNER = '0x1000000000000000000000000000000000000001' as HexString
const SOURCE_ADAPTER = '0xa000000000000000000000000000000000000001' as HexString
const DESTINATION_ADAPTER = '0xb000000000000000000000000000000000000002' as HexString
const OTHER_ADAPTER = '0xc000000000000000000000000000000000000003' as HexString
const SOURCE_ENDPOINT = '0xe000000000000000000000000000000000000001' as HexString
const DESTINATION_ENDPOINT = '0xe000000000000000000000000000000000000002' as HexString
const TX_HASH = `0x${'ab'.repeat(32)}` as HexString
const EMPTY = `0x${'0'.repeat(64)}` as HexString
const NIL = `0x${'f'.repeat(64)}` as HexString

function packet(nonce: bigint, message: HexString, receiver = DESTINATION_ADAPTER, dstEid = DST_EID): LayerZeroPacket {
  return {
    nonce,
    srcEid: SRC_EID,
    sender: pad(SOURCE_ADAPTER, { size: 32 }),
    dstEid,
    receiver: pad(receiver, { size: 32 }),
    guid: keccak256(encodePacked(['uint64'], [nonce])),
    message,
  }
}

function encodePacket(p: LayerZeroPacket): HexString {
  return encodePacked(
    ['uint8', 'uint64', 'uint32', 'bytes32', 'uint32', 'bytes32', 'bytes32', 'bytes'],
    [1, p.nonce, p.srcEid, p.sender, p.dstEid, p.receiver, p.guid, p.message]
  )
}

function packetSentLog(p: LayerZeroPacket, address = SOURCE_ENDPOINT) {
  return {
    address,
    topics: encodeEventTopics({ abi: LAYER_ZERO_ENDPOINT_ABI, eventName: 'PacketSent' }),
    data: encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'address' }],
      [encodePacket(p), '0x', OTHER_ADAPTER]
    ),
  } as any
}

const payloadHash = (p: LayerZeroPacket) => keccak256(concatHex([p.guid, p.message]))

describe('LayerZero delivery', () => {
  afterEach(() => sinon.restore())

  describe('decodeLayerZeroPacket', () => {
    it('reads every PacketV1Codec field, the message last', () => {
      const p = packet(7n, '0x0102030405')
      expect(decodeLayerZeroPacket(encodePacket(p))).to.deep.equal(p)
    })

    it('refuses a packet of another version or one too short to hold a guid', () => {
      const encoded = encodePacket(packet(1n, '0x01'))
      expect(() => decodeLayerZeroPacket(`0x02${encoded.slice(4)}` as HexString)).to.throw('version 2')
      expect(() => decodeLayerZeroPacket(encoded.slice(0, 100) as HexString)).to.throw('Not a LayerZero packet')
    })
  })

  describe('layerZeroPacketsSent', () => {
    it('keeps the endpoint packets between the two adapters, to the destination endpoint, in log order', () => {
      const first = packet(1n, '0x01')
      const second = packet(2n, '0x02')
      const receipt = {
        logs: [
          packetSentLog(first),
          packetSentLog(packet(3n, '0x03', OTHER_ADAPTER)),
          packetSentLog(packet(4n, '0x04'), OTHER_ADAPTER),
          // Our adapters share one address across chains: same receiver, another chain's endpoint.
          packetSentLog(packet(5n, '0x05', DESTINATION_ADAPTER, OTHER_EID)),
          { address: SOURCE_ENDPOINT, topics: [`0x${'99'.repeat(32)}`], data: '0x' },
          packetSentLog(second),
        ],
      }

      const packets = layerZeroPacketsSent(receipt, SOURCE_ENDPOINT, SOURCE_ADAPTER, DESTINATION_ADAPTER, DST_EID)

      expect(packets).to.deep.equal([first, second])
    })
  })

  describe('layerZeroDeliveryStatus', () => {
    const p = packet(5n, '0x0505')

    it('is stuck while the destination holds the verified payload unexecuted', () => {
      expect(layerZeroDeliveryStatus(p, payloadHash(p), 9n)).to.equal('stuck')
    })

    it('is delivered once the payload is cleared, or skipped or burnt, at or below the lazy nonce; in flight above it', () => {
      expect(layerZeroDeliveryStatus(p, EMPTY, 5n)).to.equal('delivered')
      expect(layerZeroDeliveryStatus(p, EMPTY, 4n)).to.equal('inFlight')
    })

    it('is skipped once nilified, and refuses a verified hash the packet does not carry', () => {
      expect(layerZeroDeliveryStatus(p, NIL, 9n)).to.equal('skipped')
      expect(() => layerZeroDeliveryStatus(p, `0x${'12'.repeat(32)}`, 9n)).to.throw('not the')
    })
  })

  describe('Centrifuge', () => {
    const stuck = packet(1n, '0x0101')
    const delivered = packet(2n, '0x0202')
    const inFlight = packet(3n, '0x0303')

    /**
     * A source transaction that sent `sent`, and a destination endpoint answering `stored(nonce)` for each verified
     * payload: by default the first is verified and unexecuted, the second executed and the third not verified yet.
     * `simulate` answers the re-execution.
     */
    function setup({
      simulate = async () => ({}),
      sent = [stuck, delivered, inFlight],
      stored = (nonce: bigint) => (nonce === 1n ? payloadHash(stuck) : EMPTY),
    }: {
      simulate?: () => Promise<unknown>
      sent?: LayerZeroPacket[]
      stored?: (nonce: bigint) => HexString
    } = {}) {
      const centrifuge = new Centrifuge({ environment: 'testnet' })
      sinon.stub(centrifuge, 'protocolContext').callsFake(
        (target) =>
          makeThenable(
            of({ layerZeroAdapter: (target as any).centrifugeId === FROM ? SOURCE_ADAPTER : DESTINATION_ADAPTER })
          ) as any
      )
      const readContract = async ({ address, functionName, args }: any) => {
        if (functionName === 'endpoint') return address === SOURCE_ADAPTER ? SOURCE_ENDPOINT : DESTINATION_ENDPOINT
        if (functionName === 'eid') return DST_EID
        if (functionName === 'lazyInboundNonce') return 2n
        if (functionName === 'inboundPayloadHash') return stored(args[3])
        throw new Error(`unexpected read ${functionName}`)
      }
      const simulateContract = sinon.stub().callsFake(simulate)
      stubChain(centrifuge, {
        readContract,
        simulateContract,
        getTransactionReceipt: async () => ({ logs: sent.map((p) => packetSentLog(p)) }),
      })
      return { centrifuge, simulateContract }
    }

    it('reports each message the transaction sent by where it stands on the destination', async () => {
      const { centrifuge } = setup()

      const deliveries = await centrifuge.layerZeroDeliveries(FROM, TO, TX_HASH)

      expect(deliveries.map((d) => [d.nonce, d.status])).to.deep.equal([
        [1n, 'stuck'],
        [2n, 'delivered'],
        [3n, 'inFlight'],
      ])
      expect(deliveries[0]!.endpoint).to.equal(DESTINATION_ENDPOINT)
    })

    it('re-executes only the stuck message, at the destination endpoint, with its verified origin and payload', async () => {
      const { centrifuge, simulateContract } = setup()

      const built = await centrifuge.buildOnly(centrifuge.retryLayerZeroDelivery(FROM, TO, TX_HASH), {
        fromAddress: SIGNER,
      })

      expect(simulateContract.callCount).to.equal(1)
      expect(built.to).to.equal(DESTINATION_ENDPOINT)
      const { functionName, args } = decodeFunctionData({ abi: LAYER_ZERO_ENDPOINT_ABI, data: built.data })
      expect(functionName).to.equal('lzReceive')
      const [origin, receiver, guid, message, extraData] = args!
      expect(origin).to.deep.equal({ srcEid: SRC_EID, sender: stuck.sender, nonce: 1n })
      expect((receiver as string).toLowerCase()).to.equal(DESTINATION_ADAPTER)
      expect([guid, message, extraData]).to.deep.equal([stuck.guid, stuck.message, '0x'])
    })

    it('refuses before signing when the re-execution still reverts with InvalidAdapter()', async () => {
      const revert = new ContractFunctionRevertedError({
        abi: LAYER_ZERO_ENDPOINT_ABI,
        functionName: 'lzReceive',
        data: toFunctionSelector('InvalidAdapter()'),
      })
      const { centrifuge } = setup({
        simulate: async () => {
          throw new BaseError('simulation failed', { cause: revert })
        },
      })

      let error: Error | undefined
      try {
        await centrifuge.buildOnly(centrifuge.retryLayerZeroDelivery(FROM, TO, TX_HASH), { fromAddress: SIGNER })
      } catch (e) {
        error = e as Error
      }

      expect(error?.message).to.contain('still reverts with InvalidAdapter()')
      expect(error?.message).to.contain('adapters have not arrived')
    })

    it('ignores what the same transaction sent to another chain, though to the same adapter address', async () => {
      const { centrifuge } = setup({ sent: [stuck, packet(7n, '0x0707', DESTINATION_ADAPTER, OTHER_EID)] })

      const deliveries = await centrifuge.layerZeroDeliveries(FROM, TO, TX_HASH)

      expect(deliveries.map((d) => d.nonce)).to.deep.equal([1n])
    })

    it('moves on to the next stuck message when the executor delivers one before our re-execution', async () => {
      const later = packet(4n, '0x0404')
      let firstReads = 0
      const { centrifuge, simulateContract } = setup({
        sent: [stuck, later],
        // Stuck when the retry starts; delivered by the time our simulation runs.
        stored: (nonce) => (nonce === 4n ? payloadHash(later) : firstReads++ === 0 ? payloadHash(stuck) : EMPTY),
        simulate: async () => {
          if (simulateContract.callCount === 1) throw new BaseError('LZ_PayloadHashNotFound')
          return {}
        },
      })

      const built = await centrifuge.buildOnly(centrifuge.retryLayerZeroDelivery(FROM, TO, TX_HASH), {
        fromAddress: SIGNER,
      })

      const { args } = decodeFunctionData({ abi: LAYER_ZERO_ENDPOINT_ABI, data: built.data })
      expect((args![0] as { nonce: bigint }).nonce).to.equal(4n)
    })

    it('moves on when our re-execution reverts because the executor delivered the message first', async () => {
      const later = packet(4n, '0x0404')
      let delivered1 = false
      const { centrifuge } = setup({
        sent: [stuck, later],
        stored: (nonce) => (nonce === 4n ? payloadHash(later) : delivered1 ? EMPTY : payloadHash(stuck)),
      })
      const sent: HexString[] = []
      sinon.stub(centrifuge, '_transact').callsFake(((callback: any) =>
        (async () => {
          const generator = callback({
            isBatching: false,
            signingAddress: SIGNER,
            centrifugeId: TO,
            root: centrifuge,
            publicClient: {
              simulateContract: async () => ({}),
              getCode: async () => undefined,
              // The executor lands nonce 1 between our simulation and our transaction, which then reverts.
              waitForTransactionReceipt: async () => {
                const first = sent.length === 1
                if (first) delivered1 = true
                return { status: first ? 'reverted' : 'success', logs: [] }
              },
            },
            walletClient: {
              getChainId: async () => 11155111,
              sendTransaction: async ({ data }: { data: HexString }) => {
                sent.push(data)
                return TX_HASH
              },
            },
          })
          for await (const _ of generator) {
            /* consume statuses */
          }
        })()) as any)
      sinon.stub(centrifuge, '_estimate').returns(makeThenable(of(0n)) as any)
      sinon.stub(console, 'error')

      await centrifuge.retryLayerZeroDelivery(FROM, TO, TX_HASH)

      const nonces = sent.map((data) => {
        const { args } = decodeFunctionData({ abi: LAYER_ZERO_ENDPOINT_ABI, data })
        return (args![0] as { nonce: bigint }).nonce
      })
      expect(nonces).to.deep.equal([1n, 4n])
    })

    it('refuses when nothing the transaction sent is stuck', async () => {
      const { centrifuge } = setup({ sent: [delivered] })

      let error: Error | undefined
      try {
        await centrifuge.buildOnly(centrifuge.retryLayerZeroDelivery(FROM, TO, TX_HASH), { fromAddress: SIGNER })
      } catch (e) {
        error = e as Error
      }

      expect(error?.message).to.contain('Nothing to retry')
      expect(error?.message).to.contain('nonce 2: delivered')
    })
  })
})
