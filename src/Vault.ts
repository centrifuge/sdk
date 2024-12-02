import { Decimal } from 'decimal.js-light'
import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, getContract } from 'viem'
import type { Centrifuge } from './Centrifuge.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ABI } from './abi/index.js'
import { lpConfig } from './config/lp.js'
import type { HexString } from './types/index.js'
import { Currency, DecimalWrapper, Token } from './utils/BigInt.js'
import { repeatOnEvents } from './utils/rx.js'
import { doSignMessage, doTransaction, signPermit, type Permit } from './utils/transaction.js'

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
                args: [address, lpConfig[this.chainId]!.centrifugeRouter],
              })
              .then((val: any) => new Currency(val, currency.decimals))
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
        this.network._investmentManager(),
        this._restrictionManager(),
      ]).pipe(
        switchMap(([investmentCurrency, shareCurrency, investmentManagerAddress, restrictionManagerAddress]) =>
          combineLatest([
            this._root.balance(investmentCurrency.address, address, this.chainId),
            this._root.balance(shareCurrency.address, address, this.chainId),
            this.allowance(address),
            defer(async () => {
              const client = this._root.getClient(this.chainId)!
              const vault = getContract({ address: this.address, abi: ABI.LiquidityPool, client })
              const investmentManager = getContract({
                address: investmentManagerAddress,
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
                claimableInvestShares: new Token(maxMint, shareCurrency.decimals),
                claimableInvestCurrencyEquivalent: new Currency(maxDeposit, investmentCurrency.decimals),
                claimableRedeemCurrency: new Currency(maxWithdraw, investmentCurrency.decimals),
                claimableRedeemSharesEquivalent: new Token(maxRedeem, shareCurrency.decimals),
                pendingInvestCurrency: new Currency(pendingInvest, investmentCurrency.decimals),
                pendingRedeemShares: new Token(pendingRedeem, shareCurrency.decimals),
                claimableCancelInvestCurrency: new Currency(claimableCancelInvestCurrency, investmentCurrency.decimals),
                claimableCancelRedeemShares: new Token(claimableCancelRedeemShares, shareCurrency.decimals),
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
                  abi: [ABI.LiquidityPool, ABI.RestrictionManager],
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
          shareBalance: new Token(shareBalance.toBigInt(), investment.shareCurrency.decimals),
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
      const amount = toCurrency(investAmount, investment.investmentCurrency.decimals)
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
              args: [centrifugeRouter, amount],
            })
          )
        }
      }

      const enableData = encodeFunctionData({
        abi: ABI.CentrifugeRouter,
        functionName: 'enableLockDepositRequest',
        args: [self.address, amount],
      })
      const requestData = encodeFunctionData({
        abi: ABI.CentrifugeRouter,
        functionName: 'executeLockedDepositRequest',
        args: [self.address, signingAddress, estimate],
      })
      const permitData =
        permit &&
        encodeFunctionData({
          abi: ABI.CentrifugeRouter,
          functionName: 'permit',
          args: [
            investmentCurrency.address,
            centrifugeRouter,
            amount.toString(),
            permit.deadline,
            permit.v,
            permit.r,
            permit.s,
          ],
        })
      yield* doTransaction('Invest', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.CentrifugeRouter,
          functionName: 'multicall',
          args: [[enableData, requestData, permitData].filter(Boolean)],
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
          abi: ABI.CentrifugeRouter,
          functionName: 'cancelDepositRequest',
          args: [self.address, estimate],
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
      const amount = toCurrency(redeemAmount, investment.shareCurrency.decimals)

      if (amount.gt(investment.shareBalance)) throw new Error('Insufficient balance')
      if (!amount.gt(0n)) throw new Error('Order amount must be greater than 0')

      yield* doTransaction('Redeem', publicClient, () =>
        walletClient.writeContract({
          address: centrifugeRouter,
          abi: ABI.CentrifugeRouter,
          functionName: 'requestRedeem',
          args: [self.address, amount.toBigInt(), signingAddress, signingAddress, estimate],
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
          abi: ABI.CentrifugeRouter,
          functionName: 'cancelRedeemRequest',
          args: [self.address, estimate],
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
          abi: ABI.CentrifugeRouter,
          functionName,
          args: [self.address, receiverAddress, controllerAddress],
        })
      )
    })
  }
}

type NumberInput = number | bigint | DecimalWrapper | Decimal
function toCurrency(val: NumberInput, decimals: number) {
  return typeof val === 'number'
    ? Currency.fromFloat(val, decimals!)
    : new Currency(val instanceof DecimalWrapper ? val.toBigInt() : val, decimals)
}
