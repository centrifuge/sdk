import { expect } from 'chai'
import { isObservable, lastValueFrom, of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABIS_V3_3, resolveProtocolContext, STANDARD_ABIS } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import { SAFE_PROXY_BYTECODE } from '../constants.js'
import { stubChain, stubMigrationRows } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { Balance } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { BalanceSheet } from './BalanceSheet.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

// A deposit that needs an approval first: approve and deposit in one `wallet_sendCalls` prompt when the
// wallet takes it, otherwise two transactions. Built against the bundled testnet registry.

const CENT_ID = 1
const POOL_ID = PoolId.from(CENT_ID, 33)
const SC_ID = ShareClassId.from(POOL_ID, 1)
const ASSET_ID = AssetId.from(CENT_ID, 2)
const TOKEN = '0x7777777777777777777777777777777777777777' as HexString
const SIGNER = '0x6bcb240d3e1f1c4321ecaffdacb45691dc03be5d' as HexString
const SEPOLIA = 11155111
// A chain the Safe transaction service does not cover.
const BSC_TESTNET = 97
const HASH_1 = `0x${'11'.repeat(32)}` as HexString
const HASH_2 = `0x${'22'.repeat(32)}` as HexString
const AMOUNT = Balance.fromFloat(100, 6)
const SAFE_TX_HASH = `0x${'5a'.repeat(32)}` as HexString

const thenable = <T>(value: T) => makeThenable(of(value))
// On v3.3 the balance sheet is part of the spoke.
const balanceSheetAddress = () =>
  resolveProtocolContext(POOL_ID.raw.toString(), '3.3', { environment: 'testnet' }).addresses.spoke!

/**
 * A browser wallet recording what it is asked. `capabilities` is its `wallet_getCapabilities` entry for the chain,
 * or `null` when it does not know the method. `wallet_sendCalls` answers `bundleId`, by default an opaque id, not a
 * transaction hash; the bundle is pending on the first status poll, with the approval mined, and ends on the second
 * with `outcome`: done, failed with nothing landed (500), or failed after the approval landed (600).
 */
function wallet(
  capabilities: object | null = { atomic: { status: 'supported' } },
  {
    bundleId = 'bundle-1',
    chainId = SEPOLIA,
    outcome = 200,
  }: { bundleId?: string; chainId?: number; outcome?: 200 | 500 | 600 } = {}
) {
  const requests: { method: string; params: any }[] = []
  const sendTransaction = sinon.stub()
  sendTransaction.onFirstCall().resolves(HASH_1)
  sendTransaction.resolves(HASH_2)
  const receipt = (transactionHash: HexString, status = '0x1') => ({
    status,
    blockNumber: '0x1',
    gasUsed: '0x1',
    transactionHash,
    logs: [],
  })
  const request = async ({ method, params }: { method: string; params: any }) => {
    requests.push({ method, params })
    if (method === 'wallet_getCapabilities') {
      if (!capabilities) throw new Error('Method not found')
      return { [`0x${chainId.toString(16)}`]: capabilities }
    }
    if (method === 'wallet_sendCalls') return { id: bundleId }
    if (method === 'wallet_getCallsStatus') {
      const polls = requests.filter((r) => r.method === 'wallet_getCallsStatus').length
      if (polls === 1) return { status: 100, receipts: [receipt(HASH_1)] }
      if (outcome === 500) return { status: 500, receipts: [receipt(HASH_1, '0x0'), receipt(HASH_2, '0x0')] }
      if (outcome === 600) return { status: 600, receipts: [receipt(HASH_1), receipt(HASH_2, '0x0')] }
      return { status: 200, receipts: [receipt(HASH_1), receipt(HASH_2)] }
    }
    throw new Error(`unexpected wallet request ${method}`)
  }
  const client = {
    uid: 'wallet',
    pollingInterval: 1,
    account: { address: SIGNER, type: 'json-rpc' },
    chain: { id: chainId },
    request,
    getChainId: async () => chainId,
    sendTransaction,
  }
  return { client, requests, sendTransaction }
}

/**
 * A testnet SDK that knows pool 33 as v3.3 and the signer as a balance sheet manager with no allowance. `tokenId` is
 * the asset's ERC-6909 id (0 for an ERC-20); `code` is the signer's bytecode; `chainId` is the network's chain;
 * `reverted` makes every mined transaction revert. The node is a block behind the wallet: it has no receipt to read
 * yet, only one to wait for.
 */
function setup(
  walletClient: object,
  {
    tokenId = 0n,
    code,
    chainId = SEPOLIA,
    reverted = false,
  }: { tokenId?: bigint; code?: HexString; chainId?: number; reverted?: boolean } = {}
) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const statuses: any[] = []
  const waitedFor: unknown[] = []
  // Entities bind `_transact` at construction, so the signing stub goes in before any is built.
  sinon.stub(centrifuge, '_transact').callsFake(((callback: any, centrifugeId: number) =>
    (async () => {
      const generator = callback({
        isBatching: false,
        signingAddress: SIGNER,
        centrifugeId,
        signal: new AbortController().signal,
        walletClient,
        publicClient: {
          getCode: async () => code,
          getTransactionReceipt: async ({ hash }: { hash: HexString }) => {
            throw new Error(`Transaction receipt with hash "${hash}" could not be found.`)
          },
          waitForTransactionReceipt: async ({ hash }: { hash: unknown }) => {
            waitedFor.push(hash)
            return { status: reverted ? 'reverted' : 'success', transactionHash: hash, logs: [] }
          },
        },
        root: centrifuge,
      })
      if (isObservable(generator)) {
        await lastValueFrom(generator, { defaultValue: undefined })
        return
      }
      for await (const status of generator) statuses.push(status)
    })()) as any)
  sinon
    .stub(centrifuge as any, '_poolRows')
    .returns(of([{ id: POOL_ID.toString(), protocolVersion: '3.3', migrationStatus: 'live' }]))
  stubMigrationRows(centrifuge)
  stubChain(centrifuge, {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'idToAsset') return [TOKEN, tokenId]
      throw new Error(`unexpected read ${functionName}`)
    },
  })
  ;(centrifuge._idToChain as unknown as sinon.SinonStub).returns(thenable(chainId))
  sinon.stub(centrifuge, '_allowance').resolves(0n)
  const pool = new Pool(centrifuge, POOL_ID)
  sinon.stub(pool, 'isBalanceSheetManager').returns(thenable(true) as any)
  const balanceSheet = new BalanceSheet(
    centrifuge,
    new PoolNetwork(centrifuge, pool, CENT_ID),
    new ShareClass(centrifuge, pool, SC_ID.raw)
  )
  return { balanceSheet, statuses, waitedFor }
}

const deposit = (balanceSheet: BalanceSheet) => balanceSheet.deposit(ASSET_ID, AMOUNT)

// On v3.3 the spoke takes the balance sheet's `deposit`.
const decodeDeposit = (data: HexString) => {
  const decoded = decodeFunctionData({ abi: ABIS_V3_3.Spoke, data })
  expect(decoded.functionName).to.equal('deposit')
  return decoded.args
}

describe('BalanceSheet.deposit with an approval', () => {
  afterEach(() => sinon.restore())

  it('confirms with the mined deposit when the wallet answers wallet_sendCalls with a bundle id', async () => {
    const { client, requests, sendTransaction } = wallet()
    const { balanceSheet, statuses, waitedFor } = setup(client)

    await deposit(balanceSheet)

    expect(sendTransaction.callCount).to.equal(0)
    const sent = requests.filter((r) => r.method === 'wallet_sendCalls')
    expect(sent).to.have.length(1)
    // The EVM chain id, not the Centrifuge id 1.
    expect(sent[0]!.params[0].chainId).to.equal(`0x${SEPOLIA.toString(16)}`)
    const calls = sent[0]!.params[0].calls as { to: HexString; data: HexString }[]
    expect(calls.map((call) => call.to.toLowerCase())).to.deep.equal([
      TOKEN.toLowerCase(),
      balanceSheetAddress().toLowerCase(),
    ])
    const approve = decodeFunctionData({ abi: STANDARD_ABIS.Currency, data: calls[0]!.data })
    expect(approve.functionName).to.equal('approve')
    expect(approve.args).to.deep.equal([balanceSheetAddress(), AMOUNT.toBigInt()])
    expect(decodeDeposit(calls[1]!.data)).to.deep.equal([POOL_ID.raw, SC_ID.raw, TOKEN, 0n, AMOUNT.toBigInt()])
    // The bundle id is never waited on as a transaction hash; the deposit's receipt is.
    expect(waitedFor).to.deep.equal([HASH_2])
    expect(statuses.map((s) => [s.type, s.hash])).to.deep.equal([
      ['SigningTransaction', undefined],
      ['TransactionPending', HASH_1],
      ['TransactionConfirmed', HASH_2],
    ])
  })

  it('approves and then deposits in two transactions when the wallet does not take wallet_sendCalls', async () => {
    const { client, requests, sendTransaction } = wallet(null)
    const { balanceSheet, statuses } = setup(client)

    await deposit(balanceSheet)

    expect(requests.map((r) => r.method)).to.not.include('wallet_sendCalls')
    expect(sendTransaction.callCount).to.equal(2)
    expect(sendTransaction.firstCall.args[0].to).to.equal(TOKEN)
    expect(sendTransaction.secondCall.args[0].to).to.equal(balanceSheetAddress())
    expect(statuses.filter((s) => s.type === 'TransactionConfirmed').map((s) => [s.title, s.hash])).to.deep.equal([
      ['Approve', HASH_1],
      ['Deposit', HASH_2],
    ])
  })

  it('does not re-send a rejected wallet_sendCalls prompt as two transactions', async () => {
    const { client, sendTransaction } = wallet()
    const request = client.request
    client.request = async (args: { method: string; params: any }) => {
      if (args.method === 'wallet_sendCalls')
        throw Object.assign(new Error('User rejected the request'), { code: 4001 })
      return request(args)
    }
    const { balanceSheet } = setup(client)

    let error: Error | undefined
    try {
      await deposit(balanceSheet)
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).to.match(/rejected/i)
    expect(sendTransaction.callCount).to.equal(0)
  })

  it('approves an ERC-6909 asset with its token id before depositing it', async () => {
    const { client, requests } = wallet()
    const { balanceSheet } = setup(client, { tokenId: 7n })

    await deposit(balanceSheet)

    const calls = requests.find((r) => r.method === 'wallet_sendCalls')!.params[0].calls as {
      to: HexString
      data: HexString
    }[]
    expect(calls[0]!.to.toLowerCase()).to.equal(TOKEN.toLowerCase())
    const approve = decodeFunctionData({ abi: STANDARD_ABIS.ERC6909, data: calls[0]!.data })
    expect(approve.functionName).to.equal('approve')
    expect(approve.args).to.deep.equal([balanceSheetAddress(), 7n, AMOUNT.toBigInt()])
    expect(decodeDeposit(calls[1]!.data)).to.deep.equal([POOL_ID.raw, SC_ID.raw, TOKEN, 7n, AMOUNT.toBigInt()])
  })

  it('follows a Safe bundle through the Safe transaction service, which outlasts the wallet call status', async () => {
    const { client, requests } = wallet(undefined, { bundleId: SAFE_TX_HASH })
    const fetch = sinon
      .stub(globalThis, 'fetch')
      .resolves(new Response(JSON.stringify({ isExecuted: true, transactionHash: HASH_2 }), { status: 200 }))
    const { balanceSheet, statuses, waitedFor } = setup(client, { code: SAFE_PROXY_BYTECODE as HexString })

    await deposit(balanceSheet)

    expect(requests.map((r) => r.method)).to.not.include('wallet_getCallsStatus')
    expect(String(fetch.firstCall.args[0])).to.equal(
      `https://safe-transaction-sepolia.safe.global/api/v1/multisig-transactions/${SAFE_TX_HASH}`
    )
    expect(waitedFor).to.deep.equal([HASH_2])
    expect(statuses.map((s) => [s.type, s.hash, s.receipt?.transactionHash])).to.deep.equal([
      ['SigningTransaction', undefined, undefined],
      ['TransactionPending', SAFE_TX_HASH, undefined],
      ['TransactionConfirmed', SAFE_TX_HASH, HASH_2],
    ])
  })

  it('follows a Safe bundle through the wallet call status on a chain the Safe transaction service does not cover', async () => {
    const { client, requests } = wallet(undefined, { bundleId: SAFE_TX_HASH, chainId: BSC_TESTNET })
    const fetch = sinon.stub(globalThis, 'fetch')
    const { balanceSheet, statuses } = setup(client, {
      code: SAFE_PROXY_BYTECODE as HexString,
      chainId: BSC_TESTNET,
    })

    await deposit(balanceSheet)

    expect(fetch.callCount).to.equal(0)
    expect(requests.filter((r) => r.method === 'wallet_getCallsStatus')).to.have.length(2)
    expect(statuses.map((s) => [s.type, s.hash])).to.deep.equal([
      ['SigningTransaction', undefined],
      ['TransactionPending', HASH_1],
      ['TransactionConfirmed', HASH_2],
    ])
  })

  it('fails a bundle the wallet reports failed with nothing landed, saying so, without sending again', async () => {
    const { client, sendTransaction } = wallet(undefined, { outcome: 500 })
    const { balanceSheet } = setup(client)

    const error = await deposit(balanceSheet).then(
      () => undefined,
      (e: Error) => e
    )

    expect(error?.message).to.contain('bundle-1')
    expect(error?.message).to.contain('status 500')
    expect(error?.message).to.contain('none of its calls landed')
    expect(sendTransaction.callCount).to.equal(0)
  })

  it('fails a partly executed bundle, naming the approval that landed and the deposit that did not', async () => {
    const { client, sendTransaction } = wallet(undefined, { outcome: 600 })
    const { balanceSheet } = setup(client)

    const error = await deposit(balanceSheet).then(
      () => undefined,
      (e: Error) => e
    )

    expect(error?.message).to.contain('status 600')
    expect(error?.message).to.contain('"Approve" landed and "Deposit" did not')
    expect(sendTransaction.callCount).to.equal(0)
  })

  it('fails a Safe bundle the Safe transaction service reports executed but failed', async () => {
    const { client } = wallet(undefined, { bundleId: SAFE_TX_HASH })
    sinon
      .stub(globalThis, 'fetch')
      .resolves(
        new Response(JSON.stringify({ isExecuted: true, isSuccessful: false, transactionHash: HASH_2 }), {
          status: 200,
        })
      )
    const { balanceSheet, statuses } = setup(client, { code: SAFE_PROXY_BYTECODE as HexString })

    const error = await deposit(balanceSheet).then(
      () => undefined,
      (e: Error) => e
    )

    expect(error?.message).to.contain(`Safe transaction ${SAFE_TX_HASH} was executed in ${HASH_2} but failed`)
    expect(statuses.map((s) => s.type)).to.not.include('TransactionConfirmed')
  })

  it('fails a Safe bundle whose executing transaction reverted', async () => {
    const { client } = wallet(undefined, { bundleId: SAFE_TX_HASH })
    sinon
      .stub(globalThis, 'fetch')
      .resolves(
        new Response(JSON.stringify({ isExecuted: true, isSuccessful: true, transactionHash: HASH_2 }), { status: 200 })
      )
    const { balanceSheet } = setup(client, { code: SAFE_PROXY_BYTECODE as HexString, reverted: true })

    const error = await deposit(balanceSheet).then(
      () => undefined,
      (e: Error) => e
    )

    expect(error?.name).to.equal('TransactionError')
  })
})
