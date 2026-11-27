export function createPinning(pinningApiUrl: string) {
  return {
    pinFile: (b64URI: string) =>
      pinToApi(`${pinningApiUrl}/pinFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uri: b64URI }),
      }),

    pinJson: (json: any, name?: string) =>
      pinToApi(`${pinningApiUrl}/pinJson`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(name === undefined ? { json } : { json, name }),
      }),
  }
}

export async function pinToApi(url: string, reqInit?: RequestInit) {
  const res = await fetch(url, reqInit)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error pinning: ${text}`)
  }
  const { uri } = (await res.json()) as { uri: string }
  return parseIPFSHash(uri).ipfsHash
}

/**
 * The IPFS path (`<cid>` or `<cid>/<file>`) named by `uriOrHash`, or `''` when it names none.
 * Accepts a bare hash, `ipfs://…`, `ipfs://ipfs/…` and a gateway URL (`https://host/ipfs/…`),
 * whose host is dropped.
 */
export function ipfsPathFromHash(uriOrHash: string): string {
  if (!uriOrHash) return ''
  if (!uriOrHash.includes(':')) {
    // string without protocol is assumed to be an IPFS hash
    return uriOrHash.replace(/\/?(ipfs\/)/, '')
  }
  if (uriOrHash.startsWith('ipfs://ipfs/')) return uriOrHash.slice(12)
  if (uriOrHash.startsWith('ipfs://')) return uriOrHash.slice(7)
  // Some sources hand back an already-gateway-qualified URL
  // (`https://some-gateway/ipfs/<hash>/...`) instead of an `ipfs://` URI.
  const match = /\/ipfs\/([^?#]+)/.exec(uriOrHash)
  return match ? match[1]! : ''
}

export function getUrlFromHash(uriOrHash: string, ipfsGateway: string) {
  if (!uriOrHash) return ''

  try {
    // `uriOrHash` can be on-chain metadata (e.g. a pool's `metadata` field),
    // which is attacker-controlled data, not a trusted input. The path is
    // appended onto the SDK's OWN configured `ipfsGateway` via
    // `new URL(path, ipfsGateway)`, so the request's host is always the
    // gateway — never a host named by `uriOrHash` itself. Without this, a
    // `https://…` value would be fetched verbatim, and IPFS content is
    // addressed by hash, so there is never a legitimate reason for the
    // reporter of that hash to also choose which host serves it.
    const ipfsPath = ipfsPathFromHash(uriOrHash)
    if (!ipfsPath) return ''

    const newUrl = new URL(`ipfs/${ipfsPath}`, ipfsGateway)

    if (newUrl.protocol === 'http:' || newUrl.protocol === 'https:') {
      // Pinata sometimes returns the wrong MIME type for SVG files
      // This workaround fixes it, while not affecting other kinds of files
      newUrl.search = '?format='
      return newUrl.href
    }

    return ''
  } catch {
    console.warn('parseMetadataUrl: Invalid URL', uriOrHash)
    return ''
  }
}

/**
 * True only when `url` (as produced by {@link getUrlFromHash}) actually points
 * at `ipfsGateway`. `getUrlFromHash` already guarantees this by construction,
 * but callers that `fetch()` the result re-check it right at the call site —
 * a visible, local guard against a fixed, verified domain, rather than trust
 * carried across a function boundary.
 */
export function isTrustedGatewayUrl(url: string, ipfsGateway: string): boolean {
  try {
    return new URL(url).origin === new URL(ipfsGateway).origin
  } catch {
    return false
  }
}

const IPFS_HASH_LENGTH = 46
function parseIPFSHash(uri: string) {
  if (uri.startsWith('ipfs://')) {
    const hash = uri.slice(7)
    return { uri, ipfsHash: hash }
  } else if (!uri.includes('/') && uri.length === IPFS_HASH_LENGTH) {
    return { uri: `ipfs://${uri}`, ipfsHash: uri }
  }
  throw new Error(`Invalid IPFS URI: ${uri}`)
}
