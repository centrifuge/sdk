export const pinToApi = async (url: string, reqInit?: RequestInit) => {
  const res = await fetch(url, reqInit)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error pinning: ${text}`)
  }
  return res.json()
}
