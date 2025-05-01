import { pinToApi } from './pinToApi.js'

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
