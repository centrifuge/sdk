import { sha256 } from 'viem'

/**
 * Verifies that bytes fetched from an IPFS gateway actually hash to the CID they
 * were requested under.
 *
 * A gateway fetch is a plain HTTP GET — the gateway, or anything between us and it,
 * can return whatever it likes. Content addressing only means anything if the client
 * checks it. The marketplace catalog is the input from which strategist policy roots
 * (Merkle leaves authorizing `OnchainPM.execute`) are derived, so an unverified
 * catalog makes a gateway compromise equivalent to full control over what a manager
 * whitelists.
 *
 * Only the canonical UnixFS shape `ipfs add` produces is accepted: a balanced DAG over
 * 256 KiB chunks with at most 174 links per node, hashed with sha2-256. A CID this
 * module cannot reproduce is rejected rather than waved through — a verifier with a
 * "couldn't compute it, accept anyway" branch verifies nothing.
 */

const CHUNK_SIZE = 262144
const MAX_LINKS = 174

const DAG_PB_CODEC = 0x70
const RAW_CODEC = 0x55
const SHA2_256_CODE = 0x12
const SHA2_256_LENGTH = 32

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** A CID reduced to the two things worth comparing: which codec, and the sha2-256 digest. */
interface DecodedCid {
  codec: number
  digest: Uint8Array
}

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)

  let out = ''
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    out = '1' + out
  }
  return out
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  while (bits.length % 5 !== 0) bits += '0'

  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function decodeBase58(input: string): Uint8Array {
  let value = 0n
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char)
    if (index < 0) throw new Error(`invalid base58 character "${char}"`)
    value = value * 58n + BigInt(index)
  }

  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  // Leading '1's are leading zero bytes, which the bigint conversion drops.
  for (const char of input) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

function decodeBase32(input: string): Uint8Array {
  let bits = ''
  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error(`invalid base32 character "${char}"`)
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Uint8Array.from(bytes)
}

function readUvarint(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0
  let shift = 0
  let index = offset
  for (;;) {
    const byte = bytes[index]
    if (byte === undefined) throw new Error('truncated varint')
    value |= (byte & 0x7f) << shift
    index += 1
    if ((byte & 0x80) === 0) return [value >>> 0, index]
    shift += 7
    if (shift > 28) throw new Error('varint too long')
  }
}

/**
 * Parses a CIDv0 (`Qm…`, base58btc, dag-pb implied) or a base32 CIDv1 (`b…`).
 *
 * @internal
 *
 * Other multibase prefixes and hash functions are rejected: the publish pipeline emits
 * sha2-256, and silently accepting a shape we cannot reproduce would defeat the check.
 */
export function decodeCid(cid: string): DecodedCid {
  if (cid.startsWith('Qm')) {
    const multihash = decodeBase58(cid)
    if (multihash.length !== 34 || multihash[0] !== SHA2_256_CODE || multihash[1] !== SHA2_256_LENGTH) {
      throw new Error(`unsupported CIDv0 multihash in "${cid}" — expected sha2-256`)
    }
    return { codec: DAG_PB_CODEC, digest: multihash.slice(2) }
  }

  if (!cid.startsWith('b')) {
    throw new Error(`unsupported CID encoding for "${cid}" — expected a CIDv0 (Qm…) or base32 CIDv1 (b…)`)
  }

  const bytes = decodeBase32(cid.slice(1))
  const [version, afterVersion] = readUvarint(bytes, 0)
  if (version !== 1) throw new Error(`unsupported CID version ${version} in "${cid}"`)
  const [codec, afterCodec] = readUvarint(bytes, afterVersion)
  const [hashCode, afterHashCode] = readUvarint(bytes, afterCodec)
  const [hashLength, afterHashLength] = readUvarint(bytes, afterHashCode)
  if (hashCode !== SHA2_256_CODE || hashLength !== SHA2_256_LENGTH) {
    throw new Error(`unsupported multihash in "${cid}" — expected sha2-256`)
  }
  const digest = bytes.slice(afterHashLength, afterHashLength + SHA2_256_LENGTH)
  if (digest.length !== SHA2_256_LENGTH) throw new Error(`truncated digest in "${cid}"`)
  return { codec, digest }
}

// --- Minimal protobuf writers (dag-pb / UnixFS) -----------------------------------

function uvarint(value: number): Uint8Array {
  const out: number[] = []
  let remaining = value
  for (;;) {
    const byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) out.push(byte | 0x80)
    else {
      out.push(byte)
      return Uint8Array.from(out)
    }
  }
}

/** Concatenates without spreading — a 256 KiB chunk would overflow the stack as arguments. */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function tag(field: number, wireType: number): Uint8Array {
  return uvarint((field << 3) | wireType)
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return concatBytes([tag(field, 2), uvarint(value.length), value])
}

function uintField(field: number, value: number): Uint8Array {
  return concatBytes([tag(field, 0), uvarint(value)])
}

/** UnixFS `Data` message with `Type: File`. */
function unixFsFile(data: Uint8Array | null, filesize: number, blocksizes: number[]): Uint8Array {
  const parts: Uint8Array[] = [uintField(1, 2)]
  if (data !== null) parts.push(bytesField(2, data))
  parts.push(uintField(3, filesize))
  for (const blocksize of blocksizes) parts.push(uintField(4, blocksize))
  return concatBytes(parts)
}

/** dag-pb `PBNode`. Links (field 2) are serialized before Data (field 1). */
function pbNode(links: { cid: Uint8Array; tsize: number }[], data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  for (const link of links) {
    const encoded = concatBytes([bytesField(1, link.cid), bytesField(2, new Uint8Array(0)), uintField(3, link.tsize)])
    parts.push(bytesField(2, encoded))
  }
  parts.push(bytesField(1, data))
  return concatBytes(parts)
}

function digestOf(block: Uint8Array): Uint8Array {
  return sha256(block, 'bytes')
}

function cidBytes(codec: number, block: Uint8Array): Uint8Array {
  return concatBytes([Uint8Array.from([0x01, codec, SHA2_256_CODE, SHA2_256_LENGTH]), digestOf(block)])
}

/** One DAG node: its CID, its cumulative subtree byte size, and the file bytes beneath it. */
interface DagNode {
  cid: Uint8Array
  tsize: number
  filesize: number
}

/**
 * Builds the balanced UnixFS DAG for `content` and returns the root CID's codec and digest.
 *
 * `rawLeaves` selects the two shapes in production use: CIDv0 output wraps each chunk in a
 * UnixFS file node, while `ipfs add --cid-version=1` stores leaves as raw blocks.
 */
function computeRootCidBytes(content: Uint8Array, rawLeaves: boolean): Uint8Array {
  const chunkCount = Math.max(1, Math.ceil(content.length / CHUNK_SIZE))
  let level: DagNode[] = []
  for (let i = 0; i < chunkCount; i++) {
    const chunk = content.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    if (rawLeaves) {
      level.push({ cid: cidBytes(RAW_CODEC, chunk), tsize: chunk.length, filesize: chunk.length })
    } else {
      // An empty file carries no `Data` field at all — omitting it is what yields the
      // canonical empty-file CID rather than one for a zero-length byte string.
      const block = pbNode([], unixFsFile(chunk.length > 0 ? chunk : null, chunk.length, []))
      level.push({ cid: cidBytes(DAG_PB_CODEC, block), tsize: block.length, filesize: chunk.length })
    }
  }

  while (level.length > 1) {
    const next: DagNode[] = []
    for (let i = 0; i < level.length; i += MAX_LINKS) {
      const group = level.slice(i, i + MAX_LINKS)
      const filesize = group.reduce((sum, node) => sum + node.filesize, 0)
      const block = pbNode(
        group.map((node) => ({ cid: node.cid, tsize: node.tsize })),
        unixFsFile(
          null,
          filesize,
          group.map((node) => node.filesize)
        )
      )
      next.push({
        cid: cidBytes(DAG_PB_CODEC, block),
        tsize: block.length + group.reduce((sum, node) => sum + node.tsize, 0),
        filesize,
      })
    }
    level = next
  }

  return level[0]!.cid
}

/**
 * The canonical CIDs for `content`: CIDv0 (dag-pb leaves) and CIDv1 (raw leaves).
 *
 * These are the two shapes `ipfs add` produces with default settings. Publishers use this to
 * check that whatever CID a pinning service hands back is one a client can actually
 * reproduce — a service that chunks differently, or builds a trickle DAG, yields a CID no
 * consumer of this SDK can verify.
 */
export function canonicalCids(content: Uint8Array): { v0: string; v1: string } {
  return {
    v0: encodeBase58(computeRootCidBytes(content, false).slice(2)),
    v1: 'b' + encodeBase32(computeRootCidBytes(content, true)),
  }
}

/**
 * True when `content` reproduces `cid` under either canonical leaf encoding.
 *
 * Both encodings have to be tried: for multi-chunk content the root is dag-pb either way, so
 * the codec cannot tell them apart, and the same DAG has a valid CIDv0 and CIDv1 spelling.
 * The version does predict which is likelier — `Qm…` is CIDv0, which only comes with dag-pb
 * leaves, while `b…` is CIDv1, whose default is raw leaves — so start there and usually pay
 * one hash pass over the payload instead of two. For single-chunk content the codec is
 * decisive (a raw leaf IS the root), so a mismatched branch is skipped outright.
 */
export function cidMatchesContent(cid: string, content: Uint8Array): boolean {
  const expected = decodeCid(cid)
  const likelyRawLeaves = !cid.startsWith('Qm')

  return [likelyRawLeaves, !likelyRawLeaves].some((rawLeaves) => {
    if (content.length <= CHUNK_SIZE && expected.codec !== (rawLeaves ? RAW_CODEC : DAG_PB_CODEC)) return false
    const actual = computeRootCidBytes(content, rawLeaves)
    return expected.codec === actual[1] && expected.digest.every((byte, index) => byte === actual[index + 4])
  })
}

/**
 * Throws unless `content` hashes to `cid`.
 *
 * `context` names the caller in the message — the failure is either tampering in transit
 * or a CID published in a DAG shape this verifier does not model, and the reader needs to
 * know which fetch produced it.
 */
export function assertCidMatchesContent(cid: string, content: Uint8Array, context: string): void {
  let matches: boolean
  try {
    matches = cidMatchesContent(cid, content)
  } catch (error) {
    throw new Error(`${context}: could not verify CID "${cid}" — ${String(error)}`)
  }
  if (!matches) {
    throw new Error(
      `${context}: content served for CID "${cid}" does not hash to it (${content.length} bytes). ` +
        `The gateway response was tampered with, or the CID was published in a non-canonical UnixFS layout.`
    )
  }
}
