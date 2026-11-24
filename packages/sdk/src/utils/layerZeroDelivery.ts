import {
  concatHex,
  decodeEventLog,
  getAddress,
  hexToBigInt,
  hexToNumber,
  keccak256,
  pad,
  parseAbi,
  sliceHex,
  size,
  type PublicClient,
  type TransactionReceipt,
} from 'viem'
import type { HexString } from '../types/index.js'
import { addressesEqual } from './addresses.js'

/** The one `LayerZeroAdapter` read the retry makes: the LayerZero endpoint it sends through and receives from. */
export const LAYER_ZERO_ADAPTER_ABI = parseAbi(['function endpoint() view returns (address)'])

/**
 * LayerZero `EndpointV2`, not a protocol contract. `InvalidAdapter()` is the protocol MultiAdapter's error, listed so a
 * re-execution that still reverts with it, bubbled up through the endpoint, decodes by name.
 */
export const LAYER_ZERO_ENDPOINT_ABI = parseAbi([
  'event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)',
  'function eid() view returns (uint32)',
  'function inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 nonce) view returns (bytes32)',
  'function lazyInboundNonce(address receiver, uint32 srcEid, bytes32 sender) view returns (uint64)',
  'function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes message, bytes extraData) payable',
  'error InvalidAdapter()',
])

/** A message LayerZero carries, as its `PacketSent` event encodes it on the source chain (packet version 1). */
export type LayerZeroPacket = {
  nonce: bigint
  srcEid: number
  /** The sending adapter, left-padded to 32 bytes. */
  sender: HexString
  dstEid: number
  /** The receiving adapter, left-padded to 32 bytes. */
  receiver: HexString
  guid: HexString
  message: HexString
}

/**
 * Where a LayerZero message stands on the destination endpoint:
 *
 * - `delivered`: no longer pending on the endpoint. Normally executed, so the protocol received it, and a message
 *   that then failed inside the protocol is retried with `Centrifuge.retryMessage`, not here. A nonce the receiver's
 *   delegate skipped or burnt on the endpoint reads the same, since neither leaves a trace in its storage.
 * - `inFlight`: not verified on the destination yet.
 * - `stuck`: verified and not executed. Its execution reverted (a pool message that arrived before the pool's
 *   adapters reverts with `InvalidAdapter()`), or the executor has not run yet.
 * - `skipped`: the receiver's delegate nilified it on the endpoint; it can no longer be executed.
 */
export type LayerZeroDeliveryStatus = 'delivered' | 'inFlight' | 'stuck' | 'skipped'

/** A message a transaction sent over LayerZero, with where it stands on the destination. */
export type LayerZeroDelivery = LayerZeroPacket & {
  /** The destination's LayerZero endpoint, which re-executes the message. */
  endpoint: HexString
  status: LayerZeroDeliveryStatus
}

const PACKET_VERSION = 1
// PacketV1Codec offsets, in bytes.
const SRC_EID_OFFSET = 9
const SENDER_OFFSET = 13
const DST_EID_OFFSET = 45
const RECEIVER_OFFSET = 49
const GUID_OFFSET = 81
const MESSAGE_OFFSET = 113

const EMPTY_PAYLOAD_HASH = `0x${'0'.repeat(64)}` as const
const NIL_PAYLOAD_HASH = `0x${'f'.repeat(64)}` as const

export function decodeLayerZeroPacket(encoded: HexString): LayerZeroPacket {
  if (size(encoded) < MESSAGE_OFFSET) throw new Error(`Not a LayerZero packet: ${size(encoded)} bytes`)
  const version = hexToNumber(sliceHex(encoded, 0, 1))
  if (version !== PACKET_VERSION) throw new Error(`Unsupported LayerZero packet version ${version}`)
  return {
    nonce: hexToBigInt(sliceHex(encoded, 1, SRC_EID_OFFSET)),
    srcEid: hexToNumber(sliceHex(encoded, SRC_EID_OFFSET, SENDER_OFFSET)),
    sender: sliceHex(encoded, SENDER_OFFSET, DST_EID_OFFSET),
    dstEid: hexToNumber(sliceHex(encoded, DST_EID_OFFSET, RECEIVER_OFFSET)),
    receiver: sliceHex(encoded, RECEIVER_OFFSET, GUID_OFFSET),
    guid: sliceHex(encoded, GUID_OFFSET, MESSAGE_OFFSET),
    message: size(encoded) === MESSAGE_OFFSET ? '0x' : sliceHex(encoded, MESSAGE_OFFSET),
  }
}

/**
 * The packets `endpoint` emitted in `receipt` from `sender` to `receiver` on the endpoint `dstEid`, in log order. The
 * destination is matched by endpoint id, not only by receiver: our adapters share one address across chains, so one
 * transaction to several chains carries packets to the same receiver address on each.
 */
export function layerZeroPacketsSent(
  receipt: Pick<TransactionReceipt, 'logs'>,
  endpoint: HexString,
  sender: HexString,
  receiver: HexString,
  dstEid: number
): LayerZeroPacket[] {
  const packets: LayerZeroPacket[] = []
  for (const log of receipt.logs) {
    if (!addressesEqual(log.address, endpoint)) continue
    let encodedPayload: HexString
    try {
      const decoded = decodeEventLog({ abi: LAYER_ZERO_ENDPOINT_ABI, data: log.data, topics: log.topics })
      if (decoded.eventName !== 'PacketSent') continue
      encodedPayload = decoded.args.encodedPayload
    } catch {
      continue
    }
    const packet = decodeLayerZeroPacket(encodedPayload)
    if (
      packet.dstEid === dstEid &&
      packet.sender.toLowerCase() === leftPadded(sender).toLowerCase() &&
      packet.receiver.toLowerCase() === leftPadded(receiver).toLowerCase()
    ) {
      packets.push(packet)
    }
  }
  return packets
}

/** Classifies a packet from the destination endpoint's `inboundPayloadHash` and `lazyInboundNonce` for its path. */
export function layerZeroDeliveryStatus(
  packet: LayerZeroPacket,
  storedHash: HexString,
  lazyInboundNonce: bigint
): LayerZeroDeliveryStatus {
  if (storedHash === NIL_PAYLOAD_HASH) return 'skipped'
  if (storedHash === EMPTY_PAYLOAD_HASH) return packet.nonce <= lazyInboundNonce ? 'delivered' : 'inFlight'
  const expected = keccak256(concatHex([packet.guid, packet.message]))
  if (storedHash.toLowerCase() === expected.toLowerCase()) return 'stuck'
  throw new Error(
    `LayerZero nonce ${packet.nonce} (guid ${packet.guid}) is verified on the destination with payload hash ` +
      `${storedHash}, not the ${expected} its PacketSent event carries`
  )
}

/** LayerZero pads addresses on the left; `addressToBytes32` pads on the right, as protocol messages do. */
function leftPadded(address: HexString): HexString {
  return pad(address, { size: 32 })
}

/** The address a 32-byte, left-padded LayerZero sender or receiver holds. */
export function bytes32ToAddress(value: HexString): HexString {
  return getAddress(sliceHex(value, 12)) as HexString
}

type Side = { client: PublicClient; adapters: readonly HexString[] }

/**
 * Every LayerZero message `txHash` sent from one of the source adapters to one of the destination adapters, with where
 * it stands on the destination endpoint. A chain lists one adapter per protocol version it runs.
 */
export async function readLayerZeroDeliveries(
  source: Side,
  destination: Side,
  txHash: HexString
): Promise<LayerZeroDelivery[]> {
  const endpointOf = (client: PublicClient, adapter: HexString) =>
    client.readContract({ address: adapter, abi: LAYER_ZERO_ADAPTER_ABI, functionName: 'endpoint' })
  const [receipt, sourceEndpoints, destinationEndpoints] = await Promise.all([
    source.client.getTransactionReceipt({ hash: txHash }),
    Promise.all(source.adapters.map((adapter) => endpointOf(source.client, adapter))),
    Promise.all(
      destination.adapters.map(async (adapter) => {
        const address = await endpointOf(destination.client, adapter)
        const eid = await destination.client.readContract({
          address,
          abi: LAYER_ZERO_ENDPOINT_ABI,
          functionName: 'eid',
        })
        return { address, eid }
      })
    ),
  ])
  const sent = source.adapters.flatMap((sender, i) =>
    destination.adapters.flatMap((receiver, j) =>
      layerZeroPacketsSent(receipt, sourceEndpoints[i]!, sender, receiver, destinationEndpoints[j]!.eid).map(
        (packet) => ({ packet, receiver, endpoint: destinationEndpoints[j]!.address })
      )
    )
  )
  return Promise.all(
    sent.map(async ({ packet, receiver, endpoint }) => {
      const [storedHash, lazyInboundNonce] = await Promise.all([
        destination.client.readContract({
          address: endpoint,
          abi: LAYER_ZERO_ENDPOINT_ABI,
          functionName: 'inboundPayloadHash',
          args: [receiver, packet.srcEid, packet.sender, packet.nonce],
        }),
        destination.client.readContract({
          address: endpoint,
          abi: LAYER_ZERO_ENDPOINT_ABI,
          functionName: 'lazyInboundNonce',
          args: [receiver, packet.srcEid, packet.sender],
        }),
      ])
      return { ...packet, endpoint, status: layerZeroDeliveryStatus(packet, storedHash, lazyInboundNonce) }
    })
  )
}
