import { expect } from 'chai'
import sinon from 'sinon'
import { decodeFunctionData } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { randomAddress } from '../tests/utils.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { Balance } from '../utils/BigInt.js'
import { AssetId, PoolId, ShareClassId } from '../utils/types.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { Vault } from './Vault.js'

// The vault's network is a spoke chain, distinct from the pool's hub chain, so
// the fee-estimate assertions can tell "chain this call originates on" apart
// from "chain the routed message is estimated for".
const walletChainId = 11155111
const sourceCentrifugeId = 2
const hubCentrifugeId = 1
const hubPoolId = PoolId.from(hubCentrifugeId, 1)
const scId = ShareClassId.from(hubPoolId, 1)
const assetId = AssetId.from(hubCentrifugeId, 1)

const assetDecimals = 6
const shareDecimals = 18

const signingAddress = randomAddress()
const vaultRouter = randomAddress()
const vaultAddress = randomAddress()
const assetAddress = randomAddress()

// Stubs the plumbing around the router-write methods so we can inspect the fee
// estimate and the broadcast call without a fork. `_transact` is stubbed to
// drain the async generator against a fake context, which is what triggers
// `wrapTransaction`'s estimate + send.
function buildVault(fee: bigint) {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  const sendTransaction = sinon.stub().resolves('0x1')
  const estimate = sinon.stub().resolves(fee)

  sinon.stub(centrifuge as any, '_protocolAddresses').resolves({ vaultRouter })
  sinon.stub(centrifuge as any, '_transact').callsFake(async (cb: any, centrifugeId: any) => {
    const gen = cb({
      centrifugeId,
      signingAddress,
      isBatching: false,
      root: { _estimate: estimate, _idToChain: async () => walletChainId },
      walletClient: { sendTransaction, getChainId: async () => walletChainId },
      publicClient: {
        getCode: async () => undefined,
        waitForTransactionReceipt: async () => ({ status: 'success' }),
      },
    })
    while (!(await gen.next()).done) {
      /* consume statuses */
    }
  })

  const pool = new Pool(centrifuge, hubPoolId.raw)
  const network = new PoolNetwork(centrifuge, pool, sourceCentrifugeId)
  const shareClass = new ShareClass(centrifuge, pool, scId.raw)
  const vault = new Vault(centrifuge, network, shareClass, assetAddress, vaultAddress, assetId)

  return { vault, sendTransaction, estimate }
}

// Decodes the outer `sendTransaction` calldata as a `multicall` and returns each inner
// call's function name and decoded arguments, in order. Comparing `args` (not just the
// function name) is what catches a call reaching the router with the wrong address in it —
// a malformed `enable` or `requestRedeem` still executes on-chain, so a name-only check
// would miss it.
function decodeMulticallSteps(data: HexString): { functionName: string; args: readonly unknown[] }[] {
  const outer = decodeFunctionData({ abi: ABI.VaultRouter, data })
  expect(outer.functionName).to.equal('multicall')
  const inner = outer.args![0] as readonly HexString[]
  return inner.map((call) => {
    const decoded = decodeFunctionData({ abi: ABI.VaultRouter, data: call })
    // Addresses decode checksummed; lowercase them so the fixtures above (all
    // lowercase, from `randomAddress`) compare on the address, not its casing.
    // `args` is typed as a union across every VaultRouter function signature; the call
    // actually decoded is only known at runtime, so widen to `unknown[]` for comparison.
    const rawArgs = (decoded.args ?? []) as unknown as unknown[]
    const args = rawArgs.map((arg) => (typeof arg === 'string' ? arg.toLowerCase() : arg))
    return { functionName: decoded.functionName, args }
  })
}

function expectFeeEstimateAndBroadcast(estimate: sinon.SinonStub, sendTransaction: sinon.SinonStub, fee: bigint) {
  expect(estimate.callCount).to.equal(1)
  const [from, to, messages] = estimate.firstCall.args
  expect(from).to.equal(sourceCentrifugeId)
  expect(to).to.equal(hubCentrifugeId)
  expect(messages).to.have.length(1)
  expect(messages[0].type).to.equal(MessageType.Request)

  const tx = sendTransaction.firstCall.args[0]
  expect(tx.to).to.equal(vaultRouter)
  expect(tx.value).to.equal(fee)
  return tx
}

describe('Vault router calls', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('asyncDeposit', () => {
    it('multicalls enable + requestDeposit with the fee attached', async () => {
      const { vault, sendTransaction, estimate } = buildVault(1_000n)
      const amount = Balance.fromFloat(100, assetDecimals)

      sinon.stub(vault as any, '_isSyncDeposit').resolves(false)
      sinon.stub(vault as any, 'investment').resolves({
        asset: { decimals: assetDecimals, supportsPermit: false, address: assetAddress },
        assetBalance: amount,
        assetAllowance: amount,
        isAllowedToDeposit: true,
      })

      await vault.asyncDeposit(amount)

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 1_000n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'enable', args: [vaultAddress] },
        {
          functionName: 'requestDeposit',
          args: [vaultAddress, amount.toBigInt(), signingAddress, signingAddress],
        },
      ])
    })
  })

  describe('cancelDepositRequest', () => {
    function stubInvestment(vault: Vault, isOperator: boolean) {
      sinon.stub(vault as any, 'investment').resolves({ pendingDepositAssets: Balance.fromFloat(10, assetDecimals) })
      sinon.stub(vault as any, '_isOperator').resolves(isOperator)
    }

    it('bundles enable when the router is not yet an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(500n)
      stubInvestment(vault, false)

      await vault.cancelDepositRequest()

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 500n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'enable', args: [vaultAddress] },
        { functionName: 'cancelDepositRequest', args: [vaultAddress] },
      ])
    })

    it('sends a single-call multicall when the router is already an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(500n)
      stubInvestment(vault, true)

      await vault.cancelDepositRequest()

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 500n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'cancelDepositRequest', args: [vaultAddress] },
      ])
    })
  })

  describe('asyncRedeem', () => {
    function stubInvestment(vault: Vault, isOperator: boolean) {
      sinon.stub(vault as any, 'investment').resolves({
        isAllowedToRedeem: true,
        share: { decimals: shareDecimals },
        shareBalance: Balance.fromFloat(1_000, shareDecimals),
      })
      sinon.stub(vault as any, '_isOperator').resolves(isOperator)
    }

    it('bundles enable when the router is not yet an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(750n)
      stubInvestment(vault, false)

      const sharesAmount = Balance.fromFloat(100, shareDecimals)
      await vault.asyncRedeem(sharesAmount)

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 750n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'enable', args: [vaultAddress] },
        {
          functionName: 'requestRedeem',
          args: [vaultAddress, sharesAmount.toBigInt(), signingAddress, signingAddress],
        },
      ])
    })

    it('sends a single-call multicall when the router is already an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(750n)
      stubInvestment(vault, true)

      const sharesAmount = Balance.fromFloat(100, shareDecimals)
      await vault.asyncRedeem(sharesAmount)

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 750n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        {
          functionName: 'requestRedeem',
          args: [vaultAddress, sharesAmount.toBigInt(), signingAddress, signingAddress],
        },
      ])
    })
  })

  describe('cancelRedeemRequest', () => {
    function stubInvestment(vault: Vault, isOperator: boolean) {
      sinon.stub(vault as any, 'investment').resolves({ pendingRedeemShares: Balance.fromFloat(10, shareDecimals) })
      sinon.stub(vault as any, '_isOperator').resolves(isOperator)
    }

    it('bundles enable when the router is not yet an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(250n)
      stubInvestment(vault, false)

      await vault.cancelRedeemRequest()

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 250n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'enable', args: [vaultAddress] },
        { functionName: 'cancelRedeemRequest', args: [vaultAddress] },
      ])
    })

    it('sends a single-call multicall when the router is already an operator', async () => {
      const { vault, sendTransaction, estimate } = buildVault(250n)
      stubInvestment(vault, true)

      await vault.cancelRedeemRequest()

      const tx = expectFeeEstimateAndBroadcast(estimate, sendTransaction, 250n)
      expect(decodeMulticallSteps(tx.data)).to.deep.equal([
        { functionName: 'cancelRedeemRequest', args: [vaultAddress] },
      ])
    })
  })
})
