import { ABIS_V3_2 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { sepolia } from 'viem/chains'
import { ABIS_V3_2 as ABI } from '@centrifuge/protocol'
import { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { Balance } from '../utils/BigInt.js'
import { makeThenable } from '../utils/rx.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

/**
 * Upstream `38fb0d2` — `fix(vault): bundle router enable for all claim types`.
 *
 * Every `VaultRouter` claim ends in a call into the vault with the router as
 * `msg.sender`, and `BaseVault._validateController` accepts that only when the
 * router is an operator for the controller. An investor who requested directly
 * on the vault (a valid ERC-7540 interaction) never enabled the router, so
 * `claim()` bundles `enable` ahead of all four claim branches — sending a bare
 * router call on any one of them reverts with `InvalidController()` for
 * exactly this investor.
 *
 * `enable` sets the operator for `msg.sender`, so it may only be bundled when
 * the signer IS the controller. A third party claiming for someone else still
 * depends on that someone having enabled the router themselves.
 *
 * Offline: chain resolution, the protocol context, the public client and the
 * vault's own reads are stubbed; a fake EIP-1193 signer records the calldata
 * of every `eth_sendTransaction`.
 */

const centId = 1
const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)
const assetId = AssetId.from(centId, 1)

const VAULT = '0x0000000000000000000000000000000000000aaa' as HexString
const ASSET = '0x0000000000000000000000000000000000000bbb' as HexString
const VAULT_ROUTER = '0x0000000000000000000000000000000000000ccc' as HexString
const SIGNER = '0x1111111111111111111111111111111111111111' as HexString
const OTHER = '0x2222222222222222222222222222222222222222' as HexString
const RECEIVER = '0x3333333333333333333333333333333333333333' as HexString

const ZERO = new Balance(0n, 6)
const SOME = new Balance(1_000_000n, 6)

type ClaimFn = 'claimCancelDepositRequest' | 'claimCancelRedeemRequest' | 'claimDeposit' | 'claimRedeem'

/** The four claim kinds, each with the `investment()` field that selects it. */
const CLAIM_KINDS: { functionName: ClaimFn; field: string }[] = [
  { functionName: 'claimCancelDepositRequest', field: 'claimableCancelDepositAssets' },
  { functionName: 'claimCancelRedeemRequest', field: 'claimableCancelRedeemShares' },
  { functionName: 'claimDeposit', field: 'claimableDepositShares' },
  { functionName: 'claimRedeem', field: 'claimableRedeemAssets' },
]

function investmentWith(claimableField: string) {
  return {
    claimableCancelDepositAssets: ZERO,
    claimableCancelRedeemShares: ZERO,
    claimableDepositShares: ZERO,
    claimableRedeemAssets: ZERO,
    [claimableField]: SOME,
  }
}

type Setup = {
  vault: Vault
  /** Calldata of every `eth_sendTransaction`, in order. */
  sent: HexString[]
  /** The address `investment()` was called with. */
  investmentArgs: HexString[]
  /** The address `_isOperator()` was called with. */
  isOperatorArgs: HexString[]
}

function setup(opts: { claimableField: string; isOperator: boolean }): Setup {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const thenable = <T>(value: T) => makeThenable(of(value))

  sinon.stub(centrifuge as any, '_idToChain').returns(thenable(sepolia.id))
  sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
  sinon.stub(centrifuge as any, 'getClient').returns(
    thenable({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'hubPhase') return 0
        throw new Error(`unexpected read ${functionName}`)
      },
      // `doTransaction` checks for a Safe proxy, then waits for the receipt.
      getCode: async () => '0x',
      waitForTransactionReceipt: async ({ hash }: { hash: HexString }) => ({
        status: 'success',
        transactionHash: hash,
      }),
    } as any)
  )
  sinon.stub(centrifuge as any, 'protocolContext').returns(
    thenable({
      centrifugeId: centId,
      chainId: sepolia.id,
      protocolVersion: '3.2',
      contractAbis: ABIS_V3_2,
      vaultRouter: VAULT_ROUTER,
    } as any)
  )

  const sent: HexString[] = []
  const signer = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [SIGNER]
      if (method === 'eth_chainId') return `0x${sepolia.id.toString(16)}`
      if (method === 'eth_sendTransaction') {
        sent.push(params![0].data as HexString)
        return '0x'.padEnd(66, 'f') as HexString
      }
      throw new Error(`unexpected signer request: ${method}`)
    },
  }
  centrifuge.setSigner(signer as any)

  const pool = new Pool(centrifuge, poolId.raw)
  const network = new PoolNetwork(centrifuge, pool, centId)
  const shareClass = new ShareClass(centrifuge, pool, scId)
  const vault = new Vault(centrifuge, network, shareClass, ASSET, VAULT, assetId)

  const investmentArgs: HexString[] = []
  const isOperatorArgs: HexString[] = []
  sinon.stub(vault, 'investment').callsFake(((address: HexString) => {
    investmentArgs.push(address)
    return thenable(investmentWith(opts.claimableField)) as any
  }) as any)
  sinon.stub(vault, '_isOperator').callsFake(((address: HexString) => {
    isOperatorArgs.push(address)
    return thenable(opts.isOperator) as any
  }) as any)

  return { vault, sent, investmentArgs, isOperatorArgs }
}

/** Decode one outer router call into `{ functionName, args }`. */
function decodeRouterCall(data: HexString) {
  return decodeFunctionData({ abi: ABI.VaultRouter, data })
}

/** viem decodes addresses checksummed; compare on the lowercase form. */
function lower(args: unknown) {
  return (args as readonly unknown[]).map((a) => (typeof a === 'string' ? a.toLowerCase() : a))
}

describe('Vault.claim router enable (upstream 38fb0d2)', () => {
  afterEach(() => {
    sinon.restore()
  })

  CLAIM_KINDS.forEach(({ functionName, field }) => {
    it(`bundles enable + ${functionName} when the router is not yet an operator`, async () => {
      const { vault, sent } = setup({ claimableField: field, isOperator: false })

      await vault.claim(RECEIVER)

      expect(sent).to.have.lengthOf(1)
      const outer = decodeRouterCall(sent[0]!)
      expect(outer.functionName, `${functionName} must be bundled, not sent bare`).to.equal('multicall')

      const inner = (outer.args as readonly HexString[][])[0]!
      expect(inner).to.have.lengthOf(2)

      const enableCall = decodeRouterCall(inner[0]!)
      expect(enableCall.functionName).to.equal('enable')
      expect(lower(enableCall.args)).to.deep.equal([VAULT])

      const claimCall = decodeRouterCall(inner[1]!)
      expect(claimCall.functionName).to.equal(functionName)
      expect(lower(claimCall.args)).to.deep.equal([VAULT, RECEIVER, SIGNER])
    })

    it(`sends a bare ${functionName} when the router is already an operator`, async () => {
      const { vault, sent } = setup({ claimableField: field, isOperator: true })

      await vault.claim(RECEIVER)

      expect(sent).to.have.lengthOf(1)
      const outer = decodeRouterCall(sent[0]!)
      expect(outer.functionName).to.equal(functionName)
      expect(lower(outer.args)).to.deep.equal([VAULT, RECEIVER, SIGNER])
    })
  })

  it('selects the branch and checks the operator against the CONTROLLER, not the signer', async () => {
    const { vault, investmentArgs, isOperatorArgs } = setup({
      claimableField: 'claimableRedeemAssets',
      isOperator: true,
    })

    await vault.claim(RECEIVER, OTHER)

    expect(investmentArgs).to.deep.equal([OTHER])
    expect(isOperatorArgs).to.deep.equal([OTHER])
  })

  it('does not bundle enable when a third party claims for another controller', async () => {
    // `enable` sets the operator for `msg.sender`, so bundling it here would
    // enable the router for the SIGNER and leave the controller's claim still
    // reverting. Unchanged behaviour: the controller must have enabled it.
    const { vault, sent } = setup({ claimableField: 'claimableRedeemAssets', isOperator: false })

    await vault.claim(RECEIVER, OTHER)

    expect(sent).to.have.lengthOf(1)
    const outer = decodeRouterCall(sent[0]!)
    expect(outer.functionName).to.equal('claimRedeem')
    expect(lower(outer.args)).to.deep.equal([VAULT, RECEIVER, OTHER])
  })

  it('throws when nothing is claimable, without sending', async () => {
    const { vault, sent } = setup({ claimableField: 'nothing', isOperator: false })

    let error: unknown
    try {
      await vault.claim(RECEIVER)
    } catch (e) {
      error = e
    }

    expect((error as Error).message).to.equal('No claimable funds')
    expect(sent).to.have.lengthOf(0)
  })
})
