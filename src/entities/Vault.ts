import { Decimal } from 'decimal.js-light'
import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import { lpConfig } from '../config/lp.js'
import type { HexString } from '../types/index.js'
import { Balance, DecimalWrapper } from '../utils/BigInt.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doSignMessage, doTransaction, signPermit, type Permit } from '../utils/transaction.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const ASYNC_OPERATOR_INTERFACE_ID = '0xe3bc4e65'
const ASYNC_DEPOSIT_INTERFACE_ID = '0xce3bbe50'
const ASYNC_REDEEM_INTERFACE_ID = '0x620ee8e4'
const ASYNC_CANCEL_DEPOSIT_INTERFACE_ID = '0x8bf840e3'
const ASYNC_CANCEL_REDEEM_INTERFACE_ID = '0xe76cffc7'

/**
 * Query and interact with a vault, which is the main entry point for investing and redeeming funds.
 * A vault is the combination of a network, a pool, a tranche and an investment currency.
 */
export class Vault extends Entity {
  pool: Pool
  chainId: number
  /**
   * The contract address of the investment currency.
   * @internal
   */
  _asset: HexString
  /**
   * The contract address of the vault.
   */
  address: HexString
  /** @internal */
  constructor(
    _root: Centrifuge,
    public network: PoolNetwork,
    public trancheId: string,
    asset: HexString,
    address: HexString
  ) {
    super(_root, ['vault', network.chainId, network.pool.id, trancheId, asset.toLowerCase()])
    this.chainId = network.chainId
    this.pool = network.pool
    this._asset = asset.toLowerCase() as HexString
    this.address = address.toLowerCase() as HexString
  }

  /**
   * Get the contract address of the restriction mananger.
   * @internal
   */
  _restrictionManager() {
    return this._query(['restrictionManager'], () =>
      this.network._share(this.trancheId).pipe(
        switchMap(
          (share) =>
            this._root.getClient(this.chainId)!.readContract({
              address: share,
              abi: ABI.Currency,
              functionName: 'hook',
            }) as Promise<HexString>
        )
      )
    )
  }

  /**
   * Get the details of the investment currency.
   */
  investmentCurrency() {
    return this._root.currency(this._asset, this.chainId)
  }

  /**
   * Get the details of the share token.
   */
  shareCurrency() {
    return this.network.shareCurrency(this.trancheId)
  }

  /**
   * Get the allowance of the investment currency for the CentrifugeRouter,
   * which is the contract that moves funds into the vault on behalf of the investor.
   * @param owner - The address of the owner
   */
  allowance(owner: string) {
    const address = owner.toLowerCase()
    return this._query(['allowance', address], () =>
      this.investmentCurrency().pipe(
        switchMap((currency) =>
          defer(() =>
            this._root
              .getClient(this.chainId)!
              .readContract({
                address: this._asset,
                abi: ABI.Currency,
                functionName: 'allowance',
                args: [address as any, lpConfig[this.chainId]!.centrifugeRouter],
              })
              .then((val: any) => new Balance(val, currency.decimals))
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: this._asset,
                abi: ABI.Currency,
                eventName: ['Approval', 'Transfer'],
                filter: (events) => {
                  return events.some((event) => {
                    return (
                      event.args.owner?.toLowerCase() === address ||
                      event.args.spender?.toLowerCase() === this._asset ||
                      event.args.from?.toLowerCase() === address
                    )
                  })
                },
              },
              this.chainId
            )
          )
        )
      )
    )
  }

  /**
   * Get the details of the investment of an investor in the vault and any pending investments or redemptions.
   * @param investor - The address of the investor
   */
  investment(investor: string) {
    const address = investor.toLowerCase() as HexString
    return this._query(['investment', address], () =>
      combineLatest([
        this.investmentCurrency(),
        this.shareCurrency(),
        this._root._protocolAddresses(this.chainId),
        this._restrictionManager(),
      ]).pipe(
        switchMap(([investmentCurrency, shareCurrency, addresses, restrictionManagerAddress]) =>
          combineLatest([
            this._root.balance(investmentCurrency.address, address, this.chainId),
            this._root.balance(shareCurrency.address, address, this.chainId),
            this.allowance(address),
            defer(async () => {
              const client = this._root.getClient(this.chainId)!
              const vault = getContract({ address: this.address, abi: ABI.Vault, client })
              const investmentManager = getContract({
                address: addresses.investmentManager,
                abi: ABI.InvestmentManager,
                client,
              })

              const [isAllowedToInvest, maxDeposit, maxRedeem, investment] = await Promise.all([
                vault.read.isPermissioned!([address]) as Promise<boolean>,
                vault.read.maxDeposit!([address]) as Promise<bigint>,
                vault.read.maxRedeem!([address]) as Promise<bigint>,
                investmentManager.read.investments!([this.address, address]) as Promise<
                  [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean]
                >,
              ])

              const [
                maxMint,
                maxWithdraw,
                ,
                ,
                pendingInvest,
                pendingRedeem,
                claimableCancelInvestCurrency,
                claimableCancelRedeemShares,
                hasPendingCancelInvestRequest,
                hasPendingCancelRedeemRequest,
              ] = investment
              return {
                isAllowedToInvest,
                claimableInvestShares: new Balance(maxMint, shareCurrency.decimals),
                claimableInvestCurrencyEquivalent: new Balance(maxDeposit, investmentCurrency.decimals),
                claimableRedeemCurrency: new Balance(maxWithdraw, investmentCurrency.decimals),
                claimableRedeemSharesEquivalent: new Balance(maxRedeem, shareCurrency.decimals),
                pendingInvestCurrency: new Balance(pendingInvest, investmentCurrency.decimals),
                pendingRedeemShares: new Balance(pendingRedeem, shareCurrency.decimals),
                claimableCancelInvestCurrency: new Balance(claimableCancelInvestCurrency, investmentCurrency.decimals),
                claimableCancelRedeemShares: new Balance(claimableCancelRedeemShares, shareCurrency.decimals),
                hasPendingCancelInvestRequest,
                hasPendingCancelRedeemRequest,
                investmentCurrency,
                shareCurrency,
              }
            }).pipe(
              repeatOnEvents(
                this._root,
                {
                  address: [this.address, restrictionManagerAddress],
                  abi: [ABI.Vault, ABI.RestrictionManager],
                  eventName: [
                    'UpdateMember',
                    'CancelDepositClaim',
                    'CancelDepositClaimable',
                    'CancelDepositRequest',
                    'CancelRedeemClaim',
                    'CancelRedeemClaimable',
                    'CancelRedeemRequest',
                    'Deposit',
                    'DepositClaimable',
                    'DepositRequest',
                    'RedeemClaimable',
                    'RedeemRequest',
                    'Withdraw',
                  ],
                  filter: (events) =>
                    events.some(
                      (event) =>
                        event.args.receiver?.toLowerCase() === address ||
                        event.args.controller?.toLowerCase() === address ||
                        event.args.sender?.toLowerCase() === address ||
                        event.args.owner?.toLowerCase() === address ||
                        // UpdateMember event
                        (event.args.user?.toLowerCase() === address &&
                          event.args.token?.toLowerCase() === shareCurrency.address)
                    ),
                },
                this.chainId
              )
            ),
          ])
        ),
        map(([currencyBalance, shareBalance, allowance, investment]) => ({
          ...investment,
          shareBalance: new Balance(shareBalance.toBigInt(), investment.shareCurrency.decimals),
          investmentCurrencyBalance: currencyBalance,
          investmentCurrencyAllowance: allowance,
        }))
      )
    )
  }

  /**
   * Place an order to invest funds in the vault. If an order exists, it will increase the amount.
   * @param investAmount - The amount to invest in the vault
   */
  increaseInvestOrder(investAmount: NumberInput) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, publicClient, signer, signingAddress }) {
      const { centrifugeRouter } = lpConfig[self.chainId]!
      const [estimate, investment] = await Promise.all([self.network._estimate(), self.investment(signingAddress)])
      const amount = toBalance(investAmount, investment.investmentCurrency.decimals)
      const { investmentCurrency, investmentCurrencyBalance, investmentCurrencyAllowance, isAllowedToInvest } =
        investment
      const supportsPermit = investmentCurrency.supportsPermit && 'send' in signer // eth-permit uses the deprecated send method
      const needsApproval = investmentCurrencyAllowance.lt(amount)

      if (!isAllowedToInvest) throw new Error('Not allowed to invest')
      if (amount.gt(investmentCurrencyBalance)) throw new Error('Insufficient balance')
      if (!amount.gt(0n)) throw new Error('Order amount must be greater than 0')

      let permit: Permit | null = null
      if (needsApproval) {
        if (supportsPermit) {
          permit = yield* doSignMessage('Sign Permit', () =>
            signPermit(
              walletClient,
              signer,
              self.chainId,
              signingAddress,
              investmentCurrency.address,
              centrifugeRouter,
              amount.toBigInt()
            )
          )
        } else {
          yield* doTransaction('Approve', publicClient, () =>
            walletClient.writeContract({
              address: investmentCurrency.address,
              abi: ABI.Currency,
              functionName: 'approve',
              args: [centrifugeRouter, amount.toBigInt()],
            })
          )
        }
      }

      const enableData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'enableLockDepositRequest',
        args: [self.address, amount.toBigInt()],
      })
      const requestData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'executeLockedDepositRequest',
        args: [self.address, signingAddress],
      })
      const permitData =
        permit &&
        encodeFunctionData({
          abi: ABI.VaultRouter,
          functionName: 'permit',
          args: [
            investmentCurrency.address,
            centrifugeRouter,
            amount.toString() as any,
            permit.deadline as any,
            permit.v,
            permit.r as any,
            permit.s as any,
          ],
        })
      yield* doTransaction('Invest', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName: 'multicall',
          args: [[enableData as any, requestData, permitData].filter(Boolean)],
          value: estimate,
        })
      )
    }, this.chainId)
  }

  /**
   * Cancel an open investment order.
   */
  cancelInvestOrder() {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const { centrifugeRouter } = lpConfig[self.chainId]!
      const [estimate, investment] = await Promise.all([self.network._estimate(), self.investment(signingAddress)])

      if (investment.pendingInvestCurrency.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel invest order', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName: 'cancelDepositRequest',
          args: [self.address],
          value: estimate,
        })
      )
    }, this.chainId)
  }

  /**
   * Place an order to redeem funds from the vault. If an order exists, it will increase the amount.
   * @param redeemAmount - The amount of shares to redeem
   */
  increaseRedeemOrder(redeemAmount: NumberInput) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const { centrifugeRouter } = lpConfig[self.chainId]!
      const [estimate, investment] = await Promise.all([self.network._estimate(), self.investment(signingAddress)])
      const amount = toBalance(redeemAmount, investment.shareCurrency.decimals)

      if (amount.gt(investment.shareBalance)) throw new Error('Insufficient balance')
      if (!amount.gt(0n)) throw new Error('Order amount must be greater than 0')

      yield* doTransaction('Redeem', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName: 'requestRedeem',
          args: [self.address, amount.toBigInt(), signingAddress, signingAddress],
          value: estimate,
        })
      )
    }, this.chainId)
  }

  /**
   * Cancel an open redemption order.
   */
  cancelRedeemOrder() {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const { centrifugeRouter } = lpConfig[self.chainId]!
      const [estimate, investment] = await Promise.all([self.network._estimate(), self.investment(signingAddress)])

      if (investment.pendingRedeemShares.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel redeem order', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName: 'cancelRedeemRequest',
          args: [self.address],
          value: estimate,
        })
      )
    }, this.chainId)
  }

  /**
   * Claim any outstanding fund shares after an investment has gone through, or funds after an redemption has gone through.
   * @param receiver - The address that should receive the funds. If not provided, the investor's address is used.
   * @param controller - The address of the user that has invested. Allows someone else to claim on behalf of the user
   *  if the user has set the CentrifugeRouter as an operator on the vault. If not provided, the investor's address is used.
   */
  claim(receiver?: string, controller?: string) {
    const self = this
    return this._transactSequence(async function* ({ walletClient, signingAddress, publicClient }) {
      const { centrifugeRouter } = lpConfig[self.chainId]!
      const investment = await self.investment(signingAddress)
      const receiverAddress = receiver || signingAddress
      const controllerAddress = controller || signingAddress
      const functionName = investment.claimableCancelInvestCurrency.gt(0n)
        ? 'claimCancelDepositRequest'
        : investment.claimableCancelRedeemShares.gt(0n)
          ? 'claimCancelRedeemRequest'
          : investment.claimableInvestShares.gt(0n)
            ? 'claimDeposit'
            : investment.claimableRedeemCurrency.gt(0n)
              ? 'claimRedeem'
              : ''

      if (!functionName) throw new Error('No claimable funds')

      yield* doTransaction('Claim', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.VaultRouter,
          functionName,
          args: [self.address, receiverAddress as any, controllerAddress as any],
        })
      )
    })
  }
}

type NumberInput = number | bigint | DecimalWrapper | Decimal
function toBalance(val: NumberInput, decimals: number) {
  return typeof val === 'number'
    ? Balance.fromFloat(val, decimals!)
    : new Balance(val instanceof DecimalWrapper ? val.toBigInt() : val, decimals)
}
