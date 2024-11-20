export async function pinToApi(path: string, url: string, reqInit?: RequestInit) {
  const res = await fetch(`${new URL(url).toString()}/${path}`, reqInit)
  if (!res.ok) {
    const resText = await res.text()
    throw new Error(`Error pinning: ${resText}`)
  }
  const json = await res.json()
  return json
}
