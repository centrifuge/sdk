import { combineLatest, defer, map, switchMap } from 'rxjs'
import { encodeFunctionData, encodePacked, getContract } from 'viem'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MessageType } from '../types/transaction.js'
import { Balance } from '../utils/BigInt.js'
import { Permit, signPermit } from '../utils/permit.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doSignMessage, doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'
import { addressToBytes32 } from '../utils/index.js'

// const ASYNC_OPERATOR_INTERFACE_ID = '0xe3bc4e65'
// const ASYNC_DEPOSIT_INTERFACE_ID = '0xce3bbe50'
// const ASYNC_REDEEM_INTERFACE_ID = '0x620ee8e4'
// const ASYNC_CANCEL_DEPOSIT_INTERFACE_ID = '0x8bf840e3'
// const ASYNC_CANCEL_REDEEM_INTERFACE_ID = '0xe76cffc7'

const ESCROW_HOOK_ID = '0x000000000000000000000000000000000001cf60'

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
    address: HexString,
    public assetId: AssetId
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
    return this._query(['details'], () =>
      combineLatest([this.isLinked(), this._isSyncDeposit(), this._investmentCurrency(), this._shareCurrency()]).pipe(
        map(([isLinked, isSyncDeposit, assetDetails, share]) => ({
          pool: this.pool,
          shareClass: this.shareClass,
          network: this.network,
          address: this.address,
          asset: assetDetails,
          isLinked,
          isSyncDeposit,
          isSyncRedeem: false,
          share,
        }))
      )
    )
  }

  /**
   * @returns Whether the vault is linked and can be used for investments.
   */
  isLinked() {
    return this._query(['linked'], () =>
      this._root._protocolAddresses(this.chainId).pipe(
        switchMap(({ spoke }) =>
          defer(async () => {
            const details = await this._root.getClient(this.chainId).readContract({
              address: spoke,
              abi: ABI.Spoke,
              functionName: 'vaultDetails',
              args: [this.address],
            })
            return details.isLinked
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: spoke,
                eventName: ['LinkVault', 'UnlinkVault'],
                filter: (events) => events.some((event) => event.args.vault.toLowerCase() === this.address),
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
  investment(investor: HexString) {
    const investorAddress = investor.toLowerCase() as HexString
    return this._query(['investment', investorAddress], () =>
      combineLatest([
        this._investmentCurrency(),
        this._shareCurrency(),
        this._root._protocolAddresses(this.chainId),
        this._restrictionManager(),
        this._isSyncDeposit(),
        this.pool._escrow(),
        this._isOperator(investorAddress),
      ]).pipe(
        switchMap(
          ([asset, share, addresses, restrictionManagerAddress, isSyncDeposit, escrowAddress, isOperatorEnabled]) =>
            combineLatest([
              this._root.balance(asset.address, investorAddress, this.chainId),
              this._root.balance(share.address, investorAddress, this.chainId),
              this._allowance(investorAddress),
              defer(async () => {
                const client = this._root.getClient(this.chainId)
                const vault = getContract({ address: this.address, abi: ABI.AsyncVault, client })
                const investmentManager = getContract({
                  address: addresses.asyncRequestManager,
                  abi: ABI.AsyncRequests,
                  client,
                })
                const shareToken = getContract({
                  address: share.address,
                  abi: ABI.Currency,
                  client,
                })
                const escrow = getContract({
                  address: escrowAddress,
                  abi: ABI.PoolEscrow,
                  client,
                })

                const [
                  isAllowedToDeposit,
                  maxDeposit,
                  maxRedeem,
                  investment,
                  isAllowedToRedeem,
                  [escrowTotal, escrowReserved],
                ] = await Promise.all([
                  vault.read.isPermissioned!([investorAddress]),
                  vault.read.maxDeposit!([investorAddress]),
                  vault.read.maxRedeem!([investorAddress]),
                  investmentManager.read.investments!([this.address, investorAddress]),
                  shareToken.read.checkTransferRestriction!([investorAddress, ESCROW_HOOK_ID, 0n]),
                  escrow.read.holding([this.shareClass.id.raw, this._asset, 0n]),
                ])

                const [
                  maxMint,
                  maxWithdraw,
                  ,
                  ,
                  pendingDeposit,
                  pendingRedeem,
                  claimableCancelDepositAssets,
                  claimableCancelRedeemShares,
                  hasPendingCancelDepositRequest,
                  hasPendingCancelRedeemRequest,
                ] = investment

                let actualMaxWithdraw = maxWithdraw
                let actualMaxRedeem = maxRedeem
                if (maxWithdraw > escrowTotal - (escrowReserved - maxWithdraw)) {
                  actualMaxWithdraw = 0n
                  actualMaxRedeem = 0n
                }

                return {
                  isAllowedToDeposit,
                  isAllowedToRedeem,
                  isSyncDeposit,
                  isOperatorEnabled,
                  maxDeposit: new Balance(maxDeposit, asset.decimals),
                  claimableDepositShares: new Balance(isSyncDeposit ? 0n : maxMint, share.decimals),
                  claimableDepositAssetEquivalent: new Balance(isSyncDeposit ? 0n : maxDeposit, asset.decimals),
                  claimableRedeemAssets: new Balance(actualMaxWithdraw, asset.decimals),
                  claimableRedeemSharesEquivalent: new Balance(actualMaxRedeem, share.decimals),
                  pendingDepositAssets: new Balance(pendingDeposit, asset.decimals),
                  pendingRedeemShares: new Balance(pendingRedeem, share.decimals),
                  claimableCancelDepositAssets: new Balance(claimableCancelDepositAssets, asset.decimals),
                  claimableCancelRedeemShares: new Balance(claimableCancelRedeemShares, share.decimals),
                  hasPendingCancelDepositRequest,
                  hasPendingCancelRedeemRequest,
                  asset,
                  share,
                }
              }).pipe(
                repeatOnEvents(
                  this._root,
                  {
                    address: [this.address, restrictionManagerAddress, escrowAddress],
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
                          event.args.receiver?.toLowerCase() === investorAddress ||
                          event.args.controller?.toLowerCase() === investorAddress ||
                          event.args.sender?.toLowerCase() === investorAddress ||
                          event.args.owner?.toLowerCase() === investorAddress ||
                          // UpdateMember event
                          (event.args.user?.toLowerCase() === investorAddress &&
                            event.args.token?.toLowerCase() === share.address) ||
                          // PoolEscrow events
                          (event.args.scId === this.shareClass.id.raw && event.args.asset.toLowerCase() === this._asset)
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
          assetBalance: currencyBalance.balance,
          assetAllowance: allowance,
        }))
      )
    )
  }

  /**
   * Place a synchronous deposit (ERC-4626 style) in the vault.
   * @param amount - The amount to deposit in the vault
   * @throws Error if the vault does not support synchronous deposits
   */
  syncDeposit(amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [investment, { vaultRouter }, isSyncDeposit, signingAddressCode] = await Promise.all([
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
        self._isSyncDeposit(),
        ctx.publicClient.getCode({ address: ctx.signingAddress }),
      ])

      if (!isSyncDeposit) throw new Error('Vault does not support synchronous deposits')

      const { asset, assetBalance, assetAllowance, isAllowedToDeposit } = investment
      const supportsPermit = asset.supportsPermit && signingAddressCode === undefined
      const needsApproval = assetAllowance.lt(amount)

      if (!isAllowedToDeposit) throw new Error('Not allowed to deposit')
      if (asset.decimals !== amount.decimals) throw new Error('Invalid amount decimals')
      if (amount.gt(assetBalance)) throw new Error('Insufficient balance')
      if (!amount.gt(0n)) throw new Error('Order amount must be greater than 0')

      const spender = vaultRouter
      let permit: Permit | null = null
      if (needsApproval) {
        if (supportsPermit) {
          try {
            permit = yield* doSignMessage('Sign Permit', () =>
              signPermit(ctx, asset.address, spender, amount.toBigInt())
            )
          } catch (e) {
            console.warn('Permit signing failed, falling back to approval transaction', e)
          }
        }
        if (!permit) {
          // Doesn't support permits or permit signing failed, go for a regular approval instead
          yield* doTransaction('Approve', ctx, () =>
            ctx.walletClient.writeContract({
              address: asset.address,
              abi: ABI.Currency,
              functionName: 'approve',
              args: [spender, amount.toBigInt()],
            })
          )
        }
      }

      yield* doTransaction('Invest', ctx, () =>
        ctx.walletClient.writeContract({
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName: 'deposit',
          args: [self.address, amount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
        })
      )
    }, this.chainId)
  }

  /**
   * Place an asynchronous deposit request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
   * @param amount - The amount to deposit in the vault
   * @throws Error if the vault does not support asynchronous deposits
   */
  asyncDeposit(amount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [estimate, investment, { vaultRouter }, isSyncDeposit, signingAddressCode] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
        self._isSyncDeposit(),
        ctx.publicClient.getCode({ address: ctx.signingAddress }),
      ])

      if (isSyncDeposit) throw new Error('Vault does not support asynchronous deposits')

      const { asset, assetBalance, assetAllowance, isAllowedToDeposit } = investment
      const supportsPermit = asset.supportsPermit && signingAddressCode === undefined
      const needsApproval = assetAllowance.lt(amount)

      if (!isAllowedToDeposit) throw new Error('Not allowed to deposit')
      if (asset.decimals !== amount.decimals) throw new Error('Invalid amount decimals')
      if (amount.gt(assetBalance)) throw new Error('Insufficient balance')
      if (!amount.gt(0n)) throw new Error('Order amount must be greater than 0')

      const spender = self.address
      let permit: Permit | null = null
      if (needsApproval) {
        // For async deposits, the vault is the spender
        if (supportsPermit) {
          try {
            permit = yield* doSignMessage('Sign Permit', () =>
              signPermit(ctx, asset.address, spender, amount.toBigInt())
            )
          } catch (e) {
            console.warn('Permit signing failed, falling back to approval transaction', e)
          }
        }
        if (!permit) {
          // Doesn't support permits or permit signing failed, go for a regular approval instead
          yield* doTransaction('Approve', ctx, () =>
            ctx.walletClient.writeContract({
              address: asset.address,
              abi: ABI.Currency,
              functionName: 'approve',
              args: [spender, amount.toBigInt()],
            })
          )
        }
      }

      const enableData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'enable',
        args: [self.address],
      })
      const requestData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'requestDeposit',
        args: [self.address, amount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
      })
      const permitData =
        permit &&
        encodeFunctionData({
          abi: ABI.VaultRouter,
          functionName: 'permit',
          args: [asset.address, spender, amount.toBigInt(), permit.deadline, permit.v, permit.r, permit.s],
        })
      yield* doTransaction('Invest', ctx, () =>
        ctx.walletClient.writeContract({
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName: 'multicall',
          args: [[permitData!, enableData, requestData].filter(Boolean)],
          value: estimate, // only one message is sent as a result of the multicall
        })
      )
    }, this.chainId)
  }

  /**
   * Cancel an open deposit request.
   */
  cancelDepositRequest() {
    const self = this
    return this._transact(async function* (ctx) {
      const [estimate, investment, { vaultRouter }] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])

      if (investment.pendingDepositAssets.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel deposit request', ctx, () =>
        ctx.walletClient.writeContract({
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
   * Place an asynchronous redeem request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
   * @param sharesAmount - The amount of shares to redeem
   */
  asyncRedeem(sharesAmount: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [estimate, investment, { vaultRouter }, isOperator] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
        self._isOperator(ctx.signingAddress),
      ])

      if (!investment.isAllowedToRedeem) throw new Error('Not allowed to redeem')
      if (investment.share.decimals !== sharesAmount.decimals) throw new Error('Invalid amount decimals')
      if (sharesAmount.gt(investment.shareBalance)) throw new Error('Insufficient balance')
      if (!sharesAmount.gt(0n)) throw new Error('Order amount must be greater than 0')

      if (isOperator) {
        yield* doTransaction('Redeem', ctx, () =>
          ctx.walletClient.writeContract({
            address: vaultRouter,
            abi: ABI.VaultRouter,
            functionName: 'requestRedeem',
            args: [self.address, sharesAmount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
            value: estimate,
          })
        )
        return
      }

      const enableData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'enable',
        args: [self.address],
      })
      const redeemData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'requestRedeem',
        args: [self.address, sharesAmount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
      })
      yield* doTransaction('Redeem', ctx, () =>
        ctx.walletClient.writeContract({
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName: 'multicall',
          args: [[enableData, redeemData]],
          value: estimate,
        })
      )
    }, this.chainId)
  }

  /**
   * Cancel an open redemption request.
   */
  cancelRedeemRequest() {
    const self = this
    return this._transact(async function* (ctx) {
      const [estimate, investment, { vaultRouter }] = await Promise.all([
        self._root._estimate(self.chainId, { centId: self.pool.id.centrifugeId }, MessageType.Request),
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
      ])

      if (investment.pendingRedeemShares.isZero()) throw new Error('No order to cancel')

      yield* doTransaction('Cancel redeem request', ctx, () =>
        ctx.walletClient.writeContract({
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
    return this._transact(async function* (ctx) {
      const [investment, { vaultRouter }, isOperator] = await Promise.all([
        self.investment(ctx.signingAddress),
        self._root._protocolAddresses(self.chainId),
        self._isOperator(ctx.signingAddress),
      ])
      const receiverAddress = receiver || ctx.signingAddress
      const controllerAddress = controller || ctx.signingAddress

      let functionName: 'claimCancelDepositRequest' | 'claimCancelRedeemRequest' | 'claimDeposit' | 'claimRedeem'

      if (investment.claimableCancelDepositAssets.gt(0n)) {
        functionName = 'claimCancelDepositRequest'
      } else if (investment.claimableCancelRedeemShares.gt(0n)) {
        functionName = 'claimCancelRedeemRequest'
      } else if (investment.claimableDepositShares.gt(0n)) {
        if (isOperator) {
          functionName = 'claimDeposit'
        } else {
          const enableData = encodeFunctionData({
            abi: ABI.VaultRouter,
            functionName: 'enable',
            args: [self.address],
          })
          const claimData = encodeFunctionData({
            abi: ABI.VaultRouter,
            functionName: 'claimDeposit',
            args: [self.address, receiverAddress, controllerAddress],
          })
          yield* doTransaction('Claim', ctx, () =>
            ctx.walletClient.writeContract({
              address: vaultRouter,
              abi: ABI.VaultRouter,
              functionName: 'multicall',
              args: [[enableData, claimData]],
            })
          )
          return
        }
      } else if (investment.claimableRedeemAssets.gt(0n)) {
        functionName = 'claimRedeem'
      } else {
        throw new Error('No claimable funds')
      }

      yield* doTransaction('Claim', ctx, () =>
        ctx.walletClient.writeContract({
          address: vaultRouter,
          abi: ABI.VaultRouter,
          functionName,
          args: [self.address, receiverAddress, controllerAddress],
        })
      )
    }, this.chainId)
  }

  /**
   * Update the pricing oracle valuation for this vault.
   * @param valuation - The valuation
   */
  updateValuation(valuation: HexString) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub }] = await Promise.all([
        self._root.id(self.chainId),
        self._root._protocolAddresses(self.chainId),
      ])

      yield* wrapTransaction('Update valuation', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(self.address),
            encodePacked(['uint8', 'bytes32'], [/* UpdateContractType.Valuation */ 1, addressToBytes32(valuation)]),
            0n,
          ],
        }),
      })
    }, this.chainId)
  }

  /**
   * Update the maximum deposit reserve for this vault.
   * @param maxReserve - The maximum reserve amount as a Balance
   */
  updateMaxReserve(maxReserve: Balance) {
    const self = this
    return this._transact(async function* (ctx) {
      const [id, { hub, syncManager }, asset] = await Promise.all([
        self._root.id(self.chainId),
        self._root._protocolAddresses(self.chainId),
        self._investmentCurrency(),
      ])

      if (asset.decimals !== maxReserve.decimals) {
        throw new Error('Invalid maxReserve decimals')
      }

      yield* wrapTransaction('Update max reserve', ctx, {
        contract: hub,
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.shareClass.id.raw,
            id,
            addressToBytes32(syncManager),
            encodePacked(
              ['uint8', 'uint128', 'uint128'],
              [/* UpdateContractType.SyncDepositMaxReserve */ 2, self.assetId.raw, maxReserve.toBigInt()]
            ),
            0n,
          ],
        }),
      })
    }, this.chainId)
  }

  /**
   * Find if the vault router is enabled to manage the investor funds in the vault,
   * which is required to be able to operate on their behalf and claim investments or redemptions.
   * @param investorAddress - The address of the investor
   * @internal
   */
  _isOperator(investorAddress: HexString) {
    return this._query(['isOperator', investorAddress], () =>
      defer(() =>
        this._root
          .getClient(this.chainId)
          .readContract({
            address: this.address,
            abi: ABI.AsyncVault,
            functionName: 'isOperator',
            args: [investorAddress, this.address],
          })
          .then((val) => val)
      )
    )
  }

  /** @internal */
  _isSyncDeposit() {
    return this._query(['isSyncDeposit'], () =>
      defer(() =>
        this._root
          .getClient(this.chainId)
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
            this._root.getClient(this.chainId).readContract({
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
    return this._query(['allowance', owner.toLowerCase()], () =>
      combineLatest([
        this._investmentCurrency(),
        this._root._protocolAddresses(this.chainId),
        this._isSyncDeposit(),
      ]).pipe(
        switchMap(([asset, { vaultRouter }, isSyncDeposit]) =>
          this._root
            ._allowance(owner, isSyncDeposit ? vaultRouter : this.address, this.chainId, asset.address)
            .pipe(map((allowance) => new Balance(allowance, asset.decimals)))
        )
      )
    )
  }
}
