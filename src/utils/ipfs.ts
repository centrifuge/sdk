export function createPinning(pinningApiUrl: string) {
  return {
    pinFile: (b64URI: string) =>
      pinToApi(`${pinningApiUrl}/pinFile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uri: b64URI }),
      }),

    pinJson: (json: any) =>
      pinToApi(`${pinningApiUrl}/pinJson`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json }),
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

export function getUrlFromHash(uriOrHash: string, ipfsGateway: string) {
  if (!uriOrHash) return ''

  try {
    let newUrl

    if (!uriOrHash.includes(':')) {
      // string without protocol is assumed to be an IPFS hash
      newUrl = new URL(`ipfs/${uriOrHash.replace(/\/?(ipfs\/)/, '')}`, ipfsGateway)
    } else if (uriOrHash.startsWith('ipfs://ipfs/')) {
      newUrl = new URL(`ipfs/${uriOrHash.slice(12)}`, ipfsGateway)
    } else if (uriOrHash.startsWith('ipfs://')) {
      newUrl = new URL(`ipfs/${uriOrHash.slice(7)}`, ipfsGateway)
    } else {
      newUrl = new URL(uriOrHash)
    }

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
