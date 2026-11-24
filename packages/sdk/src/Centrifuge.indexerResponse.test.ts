import { expect } from 'chai'
import { firstValueFrom } from 'rxjs'
import sinon from 'sinon'
import { DataSourceResponseError } from '@centrifuge/queries/core'
import { Centrifuge } from './Centrifuge.js'
import { IndexerResponseError } from './errors.js'

const QUERY = '{ blockchains(first: 1) { nodes { id } } }'

function answer(status: number, body: string, contentType = 'text/plain') {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('indexer responses', () => {
  let centrifuge: Centrifuge
  let fetchStub: sinon.SinonStub

  beforeEach(() => {
    centrifuge = new Centrifuge({ environment: 'testnet' })
    fetchStub = sinon.stub(globalThis, 'fetch')
  })
  afterEach(() => sinon.restore())

  it('_executeGraphql names the status and the indexer on a non-JSON error body', async () => {
    fetchStub.resolves(answer(502, 'Bad Gateway'))
    const error = await rejection(centrifuge._executeGraphql(QUERY))
    expect(error).to.be.instanceOf(IndexerResponseError)
    expect(error).to.be.instanceOf(DataSourceResponseError)
    const indexerError = error as IndexerResponseError
    expect(indexerError.status).to.equal(502)
    expect(indexerError.url).to.equal(centrifuge.config.indexerUrl)
    expect(indexerError.body).to.equal('Bad Gateway')
    expect(indexerError.message).to.contain('502').and.contain(new URL(centrifuge.config.indexerUrl).origin).and.contain('Bad Gateway')
  })

  it('_getIndexerObservable names the status and the indexer on a non-JSON error body', async () => {
    fetchStub.resolves(answer(502, '<html><body>Bad Gateway</body></html>', 'text/html'))
    const error = await rejection(firstValueFrom(centrifuge._getIndexerObservable(QUERY)))
    expect(error).to.be.instanceOf(IndexerResponseError)
    expect((error as IndexerResponseError).status).to.equal(502)
    expect((error as IndexerResponseError).message).to.contain('502')
  })

  it('both transports send the same request', async () => {
    fetchStub.resolves(answer(200, JSON.stringify({ data: {} }), 'application/json'))
    await centrifuge._executeGraphql(QUERY, { a: 1 })
    fetchStub.resolves(answer(200, JSON.stringify({ data: {} }), 'application/json'))
    await firstValueFrom(centrifuge._getIndexerObservable(QUERY, { a: 1 }))
    const calls = fetchStub.args as [string, RequestInit][]
    const [urlA, initA] = calls[0]!
    const [urlB, initB] = calls[1]!
    expect(urlA).to.equal(urlB)
    expect(initA.method).to.equal(initB.method)
    expect(initA.headers).to.deep.equal(initB.headers)
    expect(initA.body).to.equal(initB.body)
  })

  it('keeps the excerpt short and single-line', async () => {
    fetchStub.resolves(answer(503, `line one\n${'x'.repeat(500)}`))
    const error = (await rejection(centrifuge._executeGraphql(QUERY))) as IndexerResponseError
    expect(error.body).to.have.length(200)
    expect(error.body).to.not.contain('\n')
  })

  it('cuts the excerpt between characters, not inside a surrogate pair', async () => {
    fetchStub.resolves(answer(503, '😀'.repeat(300)))
    const error = (await rejection(centrifuge._executeGraphql(QUERY))) as IndexerResponseError
    expect(Array.from(error.body)).to.have.length(200)
    expect(error.body).to.equal('😀'.repeat(200))
  })

  it('keeps credentials and the query string out of the message', async () => {
    centrifuge = new Centrifuge({ environment: 'testnet', indexerUrl: 'https://user:secret@indexer.test/graphql?key=abc' })
    fetchStub.resolves(answer(502, 'Bad Gateway'))
    const error = (await rejection(centrifuge._executeGraphql(QUERY))) as IndexerResponseError
    expect(error.message).to.contain('https://indexer.test/graphql')
    expect(error.message).to.not.contain('secret').and.not.contain('key=abc')
    expect(error.url).to.equal('https://user:secret@indexer.test/graphql?key=abc')
  })

  it('still throws the GraphQL errors of a 4xx as the array', async () => {
    fetchStub.resolves(answer(400, JSON.stringify({ errors: [{ message: 'Syntax Error' }] }), 'application/json'))
    const errors = await rejection(centrifuge._executeGraphql(QUERY))
    expect(errors).to.deep.equal([{ message: 'Syntax Error' }])
  })

  it('wraps a 2xx whose body is not JSON', async () => {
    fetchStub.resolves(answer(200, '<html>captive portal</html>', 'text/html'))
    const error = await rejection(centrifuge._executeGraphql(QUERY))
    expect(error).to.be.instanceOf(IndexerResponseError)
    expect((error as IndexerResponseError).status).to.equal(200)
    expect((error as IndexerResponseError).message).to.contain('not JSON').and.contain('captive portal')

    fetchStub.resolves(answer(200, 'null', 'application/json'))
    expect(await rejection(firstValueFrom(centrifuge._getIndexerObservable(QUERY)))).to.be.instanceOf(IndexerResponseError)
  })

  it('still surfaces GraphQL errors from a 200 and still returns data', async () => {
    fetchStub.onFirstCall().resolves(answer(200, JSON.stringify({ errors: [{ message: 'boom' }] }), 'application/json'))
    const errors = await rejection(centrifuge._executeGraphql(QUERY))
    expect(errors).to.deep.equal([{ message: 'boom' }])

    fetchStub.onSecondCall().resolves(answer(200, JSON.stringify({ data: { ok: true } }), 'application/json'))
    expect(await firstValueFrom(centrifuge._getIndexerObservable<{ ok: boolean }>(QUERY))).to.deep.equal({ ok: true })
  })
})
