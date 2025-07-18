import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { Balance } from '../utils/BigInt.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doSignMessage, doTransaction, signPermit, type Permit } from '../utils/transaction.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

// const ASYNC_OPERATOR_INTERFACE_ID = '0xe3bc4e65'
// const ASYNC_DEPOSIT_INTERFACE_ID = '0xce3bbe50'
// const ASYNC_REDEEM_INTERFACE_ID = '0x620ee8e4'
// const ASYNC_CANCEL_DEPOSIT_INTERFACE_ID = '0x8bf840e3'
// const ASYNC_CANCEL_REDEEM_INTERFACE_ID = '0xe76cffc7'

const ESCROW_HOOK_ID = '0x00000000000000000000000000000000000000ce'

/**
 * Query and interact with a vault, which is the main entry point for investing and redeeming funds.
 * A vault is the combination of a network, a pool, a share class and an investment currency.
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
    public shareClass: ShareClass,
    asset: HexString,
    address: HexString
  ) {
    super(_root, ['vault', network.chainId, shareClass.id.toString(), asset.toLowerCase()])
    this.chainId = network.chainId
    this.pool = network.pool
    this._asset = asset.toLowerCase() as HexString
    this.address = address.toLowerCase() as HexString
  }

  /**
   * Get the details of the vault.
   */
  details() {
    return this._query(null, () =>
      combineLatest([this._isSyncDeposit(), this._investmentCurrency(), this._shareCurrency()]).pipe(
        map(([isSyncInvest, investmentCurrency, shareCurrency]) => ({
          pool: this.pool,
          shareClass: this.shareClass,
          network: this.network,
          address: this.address,
          asset: this._asset,
          isSyncInvest,
          isSyncRedeem: false,
          investmentCurrency,
          shareCurrency,
        }))
      )
    )
  }

  /**
   * Get the details of the investment of an investor in the vault and any pending investments or redemptions.
   * @param investor - The address of the investor
   */
  investment(investor: HexString) {
    const address = investor.toLowerCase() as HexString
    return this._query(['investment', address], () =>
      combineLatest([
        this._investmentCurrency(),
        this._shareCurrency(),
        this._root._protocolAddresses(this.chainId),
        this._restrictionManager(),
        this._isSyncDeposit(),
      ]).pipe(
        switchMap(([investmentCurrency, shareCurrency, addresses, restrictionManagerAddress, isSyncInvest]) =>
          combineLatest([
            this._root.balance(investmentCurrency.address, address, this.chainId),
            this._root.balance(shareCurrency.address, address, this.chainId),
            this._allowance(address),
            defer(async () => {
              const client = this._root.getClient(this.chainId)!
              const vault = getContract({ address: this.address, abi: ABI.AsyncVault, client })
              const investmentManager = getContract({
                address: addresses.asyncRequestManager,
                abi: ABI.AsyncRequests,
                client,
              })
              const share = getContract({
                address: shareCurrency.address,
                abi: ABI.Currency,
                client,
              })

              const [isAllowedToInvest, maxDeposit, maxRedeem, investment, isAllowedToRedeem] = await Promise.all([
                vault.read.isPermissioned!([address]),
                vault.read.maxDeposit!([address]),
                vault.read.maxRedeem!([address]),
                investmentManager.read.investments!([this.address, address]),
                share.read.checkTransferRestriction!([address, ESCROW_HOOK_ID, 0n]),
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
                isAllowedToRedeem,
                isSyncInvest,
                maxInvest: new Balance(maxDeposit, investmentCurrency.decimals),
                claimableInvestShares: new Balance(isSyncInvest ? 0n : maxMint, shareCurrency.decimals),
                claimableInvestCurrencyEquivalent: new Balance(
                  isSyncInvest ? 0n : maxDeposit,
                  investmentCurrency.decimals
                ),
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
                  abi: [ABI.AsyncVault, ABI.RestrictionManager],
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
          shareBalance: shareBalance.balance,
          investmentCurrencyBalance: currencyBalance.balance,
          investmentCurrencyAllowance: allowance,
        }))
      )
    )
  }

  /**
   * Place an order to invest funds in the vault. If an order exists, it will increase the amount.
   * @param amount - The amount to invest in the vault
   */
  increaseInvestOrder(amount: Balance) {
    const self = this
    return this._transact(async function* ({ walletClient, publicClient, signer, signingAddress }) {
      const [estimate, investment, { vaultRouter }, isSyncDeposit] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(signingAddress),
        self._root._protocolAddresses(self.chainId),
        self._isSyncDeposit(),
      ])
      const { investmentCurrency, investmentCurrencyBalance, investmentCurrencyAllowance, isAllowedToInvest } =
        investment
      const supportsPermit = investmentCurrency.supportsPermit && 'send' in signer // eth-permit uses the deprecated send method
      const needsApproval = investmentCurrencyAllowance.lt(amount)

      if (!isAllowedToInvest) throw new Error('Not allowed to invest')
      if (investmentCurrency.decimals !== amount.decimals) throw new Error('Invalid amount decimals')
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
              isSyncDeposit ? vaultRouter : self.address,
              amount.toBigInt()
            )
          )
        } else {
          yield* doTransaction('Approve', publicClient, () =>
            walletClient.writeContract({
              address: investmentCurrency.address,
              abi: ABI.Currency,
              functionName: 'approve',
              // For async deposits, the vault is the spender, for sync deposits, the vault router is the spender
              args: [isSyncDeposit ? vaultRouter : self.address, amount.toBigInt()],
            })
          )
        }
      }

      if (isSyncDeposit) {
        yield* doTransaction('Invest', publicClient, () =>
          walletClient.writeContract({
            address: vaultRouter,
            abi: ABI.VaultRouter,
            functionName: 'deposit',
            args: [self.address, amount.toBigInt(), signingAddress, signingAddress],
          })
        )
      } else {
        const enableData = encodeFunctionData({
          abi: ABI.VaultRouter,
          functionName: 'enable',
          args: [self.address],
        })
        const requestData = encodeFunctionData({
          abi: ABI.VaultRouter,
          functionName: 'requestDeposit',
          args: [self.address, amount.toBigInt(), signingAddress, signingAddress],
        })
        const permitData =
          permit &&
          encodeFunctionData({
            abi: ABI.VaultRouter,
            functionName: 'permit',
            args: [
              investmentCurrency.address,
              vaultRouter,
              amount.toBigInt(),
              BigInt(permit.deadline),
              permit.v,
              permit.r as HexString,
              permit.s as HexString,
            ],
          })
        yield* doTransaction('Invest', publicClient, () =>
          walletClient.writeContract({
            address: vaultRouter,
            abi: ABI.VaultRouter,
            functionName: 'multicall',
            args: [[permitData!, enableData, requestData].filter(Boolean)],
            value: estimate, // only one message is sent as a result of the multicall
          })
        )
      }
    }, this.chainId)
  }

  /**
   * Cancel an open investment order.
   */
  cancelInvestOrder() {
    const self = this
    return this._transact(async function* ({ walletClient, signingAddress, publicClient }) {
      const [estimate, investment, { vaultRouter }] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])

      if (investment.pendingInvestCurrency.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel invest order', publicClient, () =>
        walletClient.writeContract({
          address: vaultRouter,
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
   * @param sharesAmount - The amount of shares to redeem
   */
  increaseRedeemOrder(sharesAmount: Balance) {
    const self = this
    return this._transact(async function* ({ walletClient, signingAddress, publicClient }) {
      const [estimate, investment, { vaultRouter }] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])

      if (!investment.isAllowedToRedeem) throw new Error('Not allowed to redeem')
      if (investment.shareCurrency.decimals !== sharesAmount.decimals) throw new Error('Invalid amount decimals')
      if (sharesAmount.gt(investment.shareBalance)) throw new Error('Insufficient balance')
      if (!sharesAmount.gt(0n)) throw new Error('Order amount must be greater than 0')

      yield* doTransaction('Redeem', publicClient, () =>
        walletClient.writeContract({
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName: 'requestRedeem',
          args: [self.address, sharesAmount.toBigInt(), signingAddress, signingAddress],
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
    return this._transact(async function* ({ walletClient, signingAddress, publicClient }) {
      const [estimate, investment, { vaultRouter }] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])

      if (investment.pendingRedeemShares.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel redeem order', publicClient, () =>
        walletClient.writeContract({
          address: vaultRouter,
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
   *  if the user has set the VaultRouter as an operator on the vault. If not provided, the investor's address is used.
   */
  claim(receiver?: HexString, controller?: HexString) {
    const self = this
    return this._transact(async function* ({ walletClient, signingAddress, publicClient }) {
      const [investment, { vaultRouter }] = await Promise.all([
        self.investment(signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])
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
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName,
          args: [self.address, receiverAddress, controllerAddress],
        })
      )
    }, this.chainId)
  }

  /** @internal */
  _isSyncDeposit() {
    return this._query(['isSyncDeposit'], () =>
      defer(() =>
        this._root
          .getClient(this.chainId)!
          .readContract({
            address: this.address,
            abi: ABI.AsyncVault,
            functionName: 'supportsInterface',
            args: ['0xce3bbe50'], // ASYNC_DEPOSIT_INTERFACE_ID
          })
          .then((val) => !val)
      )
    )
  }

  /**
   * Get the contract address of the restriction mananger.
   * @internal
   */
  _restrictionManager() {
    return this._query(['restrictionManager'], () =>
      this.network._share(this.shareClass.id).pipe(
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
   * @internal
   */
  _investmentCurrency() {
    return this._root.currency(this._asset, this.chainId)
  }

  /**
   * Get the details of the share token.
   * @internal
   */
  _shareCurrency() {
    return this.network.shareCurrency(this.shareClass.id)
  }

  /**
   * Get the allowance of the investment currency for the VaultRouter,
   * which is the contract that moves funds into the vault on behalf of the investor.
   * @param owner - The address of the owner
   * @internal
   */
  _allowance(owner: HexString) {
    return this._query(null, () =>
      combineLatest([this._investmentCurrency(), this._root._protocolAddresses(this.chainId)]).pipe(
        switchMap(([currency, { vaultRouter }]) =>
          this._root
            ._allowance(owner, vaultRouter, this.chainId, currency.address)
            .pipe(map((allowance) => new Balance(allowance, currency.decimals)))
        )
      )
    )
  }
}
