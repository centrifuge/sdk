import { combineLatest, defer, firstValueFrom, map, switchMap } from 'rxjs'
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodeFunctionData,
  getContract,
} from 'viem'
import {
  ABIS_V3_3,
  encodeSyncManagerPayload,
  getContractAbis,
  PROTOCOL_VERSION_V3_2,
  PROTOCOL_VERSION_V3_3,
  STANDARD_ABIS,
  type ContractAbis,
  type ProtocolVersion,
} from '@centrifuge/protocol'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { MessageType, MessageTypeV3_3, messageV3_3, type TransactionContext } from '../types/transaction.js'
import { addressesEqual } from '../utils/addresses.js'
import { Balance } from '../utils/BigInt.js'
import { assertCrosschainMessagingEnabled } from '../utils/crosschainHotfix.js'
import { addressToBytes32, encode } from '../utils/index.js'
import { Permit, signPermit } from '../utils/permit.js'
import {
  encodeHubManagerCall,
  isV3_3,
  requireContract,
} from '../utils/protocolVersion.js'
import { repeatOnEvents } from '../utils/rx.js'
import { doSignMessage, doTransaction, wrapTransaction } from '../utils/transaction.js'
import { AssetId } from '../utils/types.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'
import {
  PoolNetwork,
  requireRefundAddress,
  VaultManagerTrustedCall,
  type VaultWriteOptions,
} from './PoolNetwork.js'
import { ShareClass } from './ShareClass.js'

// const ASYNC_OPERATOR_INTERFACE_ID = '0xe3bc4e65'
// const ASYNC_DEPOSIT_INTERFACE_ID = '0xce3bbe50'
// const ASYNC_REDEEM_INTERFACE_ID = '0x620ee8e4'
// const ASYNC_CANCEL_DEPOSIT_INTERFACE_ID = '0x8bf840e3'
// const ASYNC_CANCEL_REDEEM_INTERFACE_ID = '0xe76cffc7'

// ESCROW_HOOK_ID used for redeem requests - same value for all environments
// Matches protocol constant: address(uint160(0x1CF60))
const ESCROW_HOOK_ID = '0x000000000000000000000000000000000001cf60'

/**
 * The token id of every vault's asset. The vault factories refuse any other
 * (`AsyncVaultFactory` and `SyncDepositVaultFactory` revert `UnsupportedTokenId`),
 * so a vault's asset is always an ERC-20 and its escrow and balance-sheet entries
 * sit at token id 0.
 */
const VAULT_ASSET_TOKEN_ID = 0n

/**
 * Query and interact with a vault, which is the main entry point for investing and redeeming funds.
 * A vault is the combination of a network, a pool, a share class and an investment currency.
 */
export class Vault extends Entity {
  pool: Pool
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
    public shareClass: ShareClass,
    asset: HexString,
    address: HexString,
    public assetId: AssetId
  ) {
    super(_root, ['vault', network.centrifugeId, shareClass.id.toString(), asset.toLowerCase(), address.toLowerCase()])
    this.pool = network.pool
    this._asset = asset.toLowerCase() as HexString
    this.address = address.toLowerCase() as HexString
  }

  get centrifugeId() {
    return this.network.centrifugeId
  }

  #gate(action: string) {
    return { poolId: this.pool.id.toString(), action, targets: [{ centrifugeId: this.centrifugeId }] }
  }

  /**
   * Get the details of the vault.
   */
  details() {
    return this._query(['details'], () =>
      combineLatest([
        this.isLinked(),
        this._isSyncDeposit(),
        this._investmentCurrency(),
        this._shareCurrency(),
        this._maxReserve(),
        this._availableBalance(),
      ]).pipe(
        map(([isLinked, isSyncDeposit, assetDetails, share, maxReserve, availableBalance]) => {
          const maxDepositValue = maxReserve.toBigInt() - availableBalance.toBigInt()
          const maxDeposit = new Balance(maxDepositValue > 0n ? maxDepositValue : 0n, assetDetails.decimals)

          return {
            pool: this.pool,
            shareClass: this.shareClass,
            network: this.network,
            address: this.address,
            asset: assetDetails,
            isLinked,
            isSyncDeposit,
            isSyncRedeem: false,
            share,
            maxDeposit,
          }
        })
      )
    )
  }

  /**
   * @returns Whether the vault is linked and can be used for investments.
   */
  isLinked() {
    return this._query(['linked'], () =>
      combineLatest([this.network._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) => {
          // v3.3 folded VaultRegistry into SpokeRegistry with the same link events;
          // a pre-3.3 vault on a 3.3 pool is linked there too.
          const registry = isV3_3(ctx) ? requireContract(ctx, 'spokeRegistry') : requireContract(ctx, 'vaultRegistry')
          return defer(async () => {
            const details = isV3_3(ctx)
              ? await client.readContract({
                  address: registry,
                  abi: ABIS_V3_3.SpokeRegistry,
                  functionName: 'vaultDetails',
                  args: [this.address],
                })
              : await client.readContract({
                  address: registry,
                  abi: ctx.contractAbis.VaultRegistry,
                  functionName: 'vaultDetails',
                  args: [this.address],
                })
            return details.isLinked
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: registry,
                eventName: ['LinkVault', 'UnlinkVault'],
                filter: (events) => events.some((event) => event.args.vault.toLowerCase() === this.address),
              },
              this.centrifugeId,
              ctx.protocolVersion
            )
          )
        })
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
        this.network._protocolContext(),
        this._restrictionManager(),
        this._isSyncDeposit(),
        this.pool._escrow(this.centrifugeId),
        this._isOperator(investorAddress),
        this._root.getClient(this.centrifugeId),
        this._vaultVersion(),
      ]).pipe(
        switchMap(
          ([
            asset,
            share,
            addresses,
            restrictionManagerAddress,
            isSyncDeposit,
            escrowAddress,
            isOperatorEnabled,
            client,
            vaultVersion,
          ]) =>
            combineLatest([
              this._root.balance(asset.address, investorAddress, this.centrifugeId),
              this._root.balance(share.address, investorAddress, this.centrifugeId),
              this._allowance(investorAddress),
              defer(async () => {
                const ABI = addresses.contractAbis
                // The manager is the pool's (a pre-3.3 vault runs against the 3.3 managers);
                // the vault is read with its own version's ABI.
                const vault = getContract({ address: this.address, abi: getContractAbis(vaultVersion).AsyncVault, client })
                const investmentManager = getContract({
                  address: addresses.asyncRequestManager,
                  abi: ABI.AsyncRequests,
                  client,
                })
                const shareToken = getContract({
                  address: share.address,
                  abi: STANDARD_ABIS.Currency,
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
                  escrow.read.holding([this.shareClass.id.raw, this._asset, VAULT_ASSET_TOKEN_ID]),
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
                  this.centrifugeId,
                  addresses.protocolVersion
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
    return this._gatedTransact(this.#gate('syncDeposit'), this.centrifugeId, async function* (ctx) {
      const [investment, { vaultRouter, contractAbis: ABI }, isSyncDeposit, signingAddressCode] = await Promise.all([
        self.investment(ctx.signingAddress),
        self.network._protocolContext(),
        self._isSyncDeposit(),
        ctx.publicClient.getCode({ address: ctx.signingAddress }),
      ])

      if (!isSyncDeposit) throw new Error('Vault does not support synchronous deposits')

      const { asset, assetBalance, assetAllowance, isAllowedToDeposit } = investment
      const supportsPermit = asset.supportsPermit && signingAddressCode === undefined && !self._root.permitDisabled
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
              abi: STANDARD_ABIS.Currency,
              functionName: 'approve',
              args: [spender, amount.toBigInt()],
            })
          )
        }
      }

      yield* wrapTransaction('Invest', ctx, {
        contract: vaultRouter,
        data: encodeFunctionData({
          abi: ABI.VaultRouter,
          functionName: 'deposit',
          args: [self.address, amount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
        }),
      })
    })
  }

  /**
   * Place an asynchronous deposit request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
   * @param amount - The amount to deposit in the vault
   * @throws Error if the vault does not support asynchronous deposits
   */
  asyncDeposit(amount: Balance) {
    const self = this
    return this._gatedTransact(this.#gate('requestDeposit'), this.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const [investment, { vaultRouter, contractAbis: ABI, protocolVersion }, isSyncDeposit, signingAddressCode] = await Promise.all([
        self.investment(ctx.signingAddress),
        self.network._protocolContext(),
        self._isSyncDeposit(),
        ctx.publicClient.getCode({ address: ctx.signingAddress }),
      ])

      if (isSyncDeposit) throw new Error('Vault does not support asynchronous deposits')

      const { asset, assetBalance, assetAllowance, isAllowedToDeposit } = investment
      const supportsPermit = asset.supportsPermit && signingAddressCode === undefined && !self._root.permitDisabled
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
              abi: STANDARD_ABIS.Currency,
              functionName: 'approve',
              args: [spender, amount.toBigInt()],
            })
          )
        }
      }

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

      yield* self._sendRouterFeeTransaction(
        'Invest',
        ctx,
        vaultRouter,
        [permitData, self._enableRouterData(ABI), requestData].filter((d): d is HexString => d !== null),
        protocolVersion
      )
    })
  }

  /**
   * Cancel an open deposit request.
   */
  cancelDepositRequest() {
    const self = this
    return this._gatedTransact(this.#gate('cancelDepositRequest'), this.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const [investment, { vaultRouter, contractAbis: ABI, protocolVersion }, isOperator] = await Promise.all([
        self.investment(ctx.signingAddress),
        self.network._protocolContext(),
        self._isOperator(ctx.signingAddress),
      ])

      if (investment.pendingDepositAssets.isZero()) throw new Error('No order to cancel')

      const cancelData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'cancelDepositRequest',
        args: [self.address],
      })

      yield* self._sendRouterFeeTransaction(
        'Cancel deposit request',
        ctx,
        vaultRouter,
        self._bundleEnableIfNeeded([cancelData], isOperator, ABI),
        protocolVersion
      )
    })
  }

  /**
   * Place an asynchronous redeem request (ERC-7540 style) in the vault. If an order exists, it will increase the amount.
   * @param sharesAmount - The amount of shares to redeem
   */
  asyncRedeem(sharesAmount: Balance) {
    const self = this
    return this._gatedTransact(this.#gate('requestRedeem'), this.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const [investment, { vaultRouter, contractAbis: ABI, protocolVersion }, isOperator] = await Promise.all([
        self.investment(ctx.signingAddress),
        self.network._protocolContext(),
        self._isOperator(ctx.signingAddress),
      ])

      if (!investment.isAllowedToRedeem) throw new Error('Not allowed to redeem')
      if (investment.share.decimals !== sharesAmount.decimals) throw new Error('Invalid amount decimals')
      if (sharesAmount.gt(investment.shareBalance)) throw new Error('Insufficient balance')
      if (!sharesAmount.gt(0n)) throw new Error('Order amount must be greater than 0')

      const redeemData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'requestRedeem',
        args: [self.address, sharesAmount.toBigInt(), ctx.signingAddress, ctx.signingAddress],
      })

      yield* self._sendRouterFeeTransaction(
        'Redeem',
        ctx,
        vaultRouter,
        self._bundleEnableIfNeeded([redeemData], isOperator, ABI),
        protocolVersion
      )
    })
  }

  /**
   * Cancel an open redemption request.
   */
  cancelRedeemRequest() {
    const self = this
    return this._gatedTransact(this.#gate('cancelRedeemRequest'), this.centrifugeId, async function* (ctx) {
      assertCrosschainMessagingEnabled(self.centrifugeId)

      const [investment, { vaultRouter, contractAbis: ABI, protocolVersion }, isOperator] = await Promise.all([
        self.investment(ctx.signingAddress),
        self.network._protocolContext(),
        self._isOperator(ctx.signingAddress),
      ])

      if (investment.pendingRedeemShares.isZero()) throw new Error('No order to cancel')

      const cancelData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName: 'cancelRedeemRequest',
        args: [self.address],
      })

      yield* self._sendRouterFeeTransaction(
        'Cancel redeem request',
        ctx,
        vaultRouter,
        self._bundleEnableIfNeeded([cancelData], isOperator, ABI),
        protocolVersion
      )
    })
  }

  /**
   * Claim any outstanding fund shares after an investment has gone through, or funds after an redemption has gone through.
   * @param receiver - The address that should receive the funds. If not provided, the investor's address is used.
   * @param controller - The address of the user that has invested. Allows someone else to claim on behalf of the user
   *  if the user has set the VaultRouter as an operator on the vault. If not provided, the investor's address is used.
   */
  claim(receiver?: HexString, controller?: HexString) {
    const self = this
    return this._gatedTransact(this.#gate('investorClaim'), this.centrifugeId, async function* (ctx) {
      const receiverAddress = receiver || ctx.signingAddress
      const controllerAddress = controller || ctx.signingAddress
      const [investment, { vaultRouter, contractAbis: ABI }, isOperator] = await Promise.all([
        self.investment(controllerAddress),
        self.network._protocolContext(),
        self._isOperator(controllerAddress),
      ])

      let functionName: 'claimCancelDepositRequest' | 'claimCancelRedeemRequest' | 'claimDeposit' | 'claimRedeem'

      if (investment.claimableCancelDepositAssets.gt(0n)) {
        functionName = 'claimCancelDepositRequest'
      } else if (investment.claimableCancelRedeemShares.gt(0n)) {
        functionName = 'claimCancelRedeemRequest'
      } else if (investment.claimableDepositShares.gt(0n)) {
        functionName = 'claimDeposit'
      } else if (investment.claimableRedeemAssets.gt(0n)) {
        functionName = 'claimRedeem'
      } else {
        throw new Error('No claimable funds')
      }

      const claimData = encodeFunctionData({
        abi: ABI.VaultRouter,
        functionName,
        args: [self.address, receiverAddress, controllerAddress],
      })

      // `enable` sets the operator for the sender, so bundling it here only helps when the
      // signer is the controller themselves.
      const needsEnable = !isOperator && addressesEqual(controllerAddress, ctx.signingAddress)
      const data = needsEnable ? [self._enableRouterData(ABI), claimData] : claimData

      yield* wrapTransaction('Claim', ctx, { contract: vaultRouter, data })
    })
  }

  /**
   * Update the maximum deposit reserve for this vault.
   * @param maxReserve - The maximum reserve amount
   * @param options.refundAddress - Where unspent cross-chain gas payment is
   * returned. Defaults to the signing address on the local path, which is what
   * this method has always encoded; REQUIRED in backend mode. See
   * {@link VaultWriteOptions.refundAddress}.
   *
   * ## Routing
   *
   * Routed to the `maxReserve` part of the backend's batched `updateVaults`
   * action, alongside `poolNetwork.linkVaults()` and `.unlinkVaults()` which
   * fill the other two. Two differences from the local path, both the
   * backend's design:
   *
   * - The ASSET ID is not sent. `Hub.updateContract` addresses the sync manager
   *   by `(scId, assetId)` and not by vault address at all, so the backend
   *   resolves the pair from the projected vault this call names and refuses a
   *   mismatch (422 `UNKNOWN_VAULT`). A caller-supplied asset could name one
   *   vault in the audit row while changing a different holding's reserve.
   * - `this.address` travels instead, which the local path never puts on the
   *   wire because it already knows the asset.
   *
   * The decimals check stays on both paths. It is a caller-error guard — "this
   * `Balance` is not scaled to the investment currency" — rather than an
   * addressing one, and dropping it on the backend route would let a
   * mis-scaled reserve reach the chain as a plausible number.
   *
   * A reserve of ZERO is accepted here as it always has been, and by the
   * backend too: a reserve is a ceiling, so zero pauses new deposits into a
   * linked sync-deposit vault, which is materially different from unlinking it.
   */
  updateMaxReserve(maxReserve: Balance, options: VaultWriteOptions = {}) {
    return this._root._routeDeferredTransaction(
      'updateVaults',
      this.pool.id.toString(),
      async () => {
        const asset = await firstValueFrom(this._investmentCurrency())
        if (asset.decimals !== maxReserve.decimals) {
          throw new Error('Invalid maxReserve decimals')
        }
        return {
          poolId: this.pool.id.toString(),
          centrifugeId: String(this.centrifugeId),
          refundAddress: requireRefundAddress(options, 'vault.updateMaxReserve()'),
          maxReserve: {
            scId: this.shareClass.id.raw,
            vaultAddress: this.address,
            amount: maxReserve.toBigInt().toString(),
          },
        }
      },
      {
        title: 'Update max reserve',
        centrifugeId: this.pool.centrifugeId,
        gate: [{ centrifugeId: this.centrifugeId }],
        local: () => this.#updateMaxReserveLocal(maxReserve, options),
      }
    )
  }

  #updateMaxReserveLocal(maxReserve: Balance, options: VaultWriteOptions = {}) {
    const self = this
    return this._transact(async function* (ctx) {
      const [hubCtx, spokeCtx, asset] = await Promise.all([
        self._root.protocolContext(self.pool.id),
        self.network._protocolContext(),
        self._investmentCurrency(),
      ])
      const { hub, syncManager, contractAbis: ABI } = hubCtx

      if (asset.decimals !== maxReserve.decimals) {
        throw new Error('Invalid maxReserve decimals')
      }

      const refundAddress = options.refundAddress ?? ctx.signingAddress

      if (isV3_3(hubCtx)) {
        yield* wrapTransaction('Update max reserve', ctx, {
          contract: hub,
          policy: { poolId: self.pool.id },
          data: encodeHubManagerCall(hubCtx, {
            centrifugeId: self.centrifugeId,
            target: spokeCtx.syncManager,
            payload: encodeSyncManagerPayload({
              kind: 'maxReserve',
              scId: self.shareClass.id.raw,
              assetId: self.assetId.toString(),
              maxReserve: maxReserve.toBigInt().toString(),
            }),
            label: 'SyncManager.MaxReserve',
            refund: refundAddress,
          }),
          messages: { [self.centrifugeId]: [messageV3_3(MessageTypeV3_3.ManagerCallFromHub, self.pool.id)] },
        })
        return
      }

      yield* wrapTransaction('Update max reserve', ctx, {
        contract: hub,
        policy: { poolId: self.pool.id },
        data: encodeFunctionData({
          abi: ABI.Hub,
          functionName: 'updateContract',
          args: [
            self.pool.id.raw,
            self.shareClass.id.raw,
            self.centrifugeId,
            addressToBytes32(syncManager),
            encode([VaultManagerTrustedCall.MaxReserve, self.assetId.raw, maxReserve.toBigInt()]),
            0n,
            refundAddress,
          ],
        }),
        messages: { [self.centrifugeId]: [{ type: MessageType.TrustedContractUpdate, poolId: self.pool.id }] },
      })
    }, this.pool.centrifugeId)
  }

  /**
   * Find if the vault router is enabled to manage the investor funds in the vault,
   * which is required to be able to operate on their behalf and claim investments or redemptions.
   * @param investorAddress - The address of the investor
   * @internal
   */
  _isOperator(investorAddress: HexString) {
    const investor = investorAddress.toLowerCase() as HexString
    return this._query(['isOperator', investor], () =>
      combineLatest([
        this.network._protocolContext(),
        this._root.getClient(this.centrifugeId),
        this._vaultVersion(),
      ]).pipe(
        switchMap(([{ vaultRouter }, client, protocolVersion]) =>
          defer(() =>
            client
              .readContract({
                address: this.address,
                abi: getContractAbis(protocolVersion).AsyncVault,
                functionName: 'isOperator',
                args: [investor, vaultRouter],
              })
              .then((val) => val)
          ).pipe(
            repeatOnEvents(
              this._root,
              {
                address: this.address,
                eventName: ['OperatorSet'],
                filter: (events) =>
                  events.some(
                    (event) =>
                      event.args.controller.toLowerCase() === investor &&
                      event.args.operator.toLowerCase() === vaultRouter.toLowerCase()
                  ),
              },
              this.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /** @internal */
  _enableRouterData(ABI: ContractAbis): HexString {
    return encodeFunctionData({
      abi: ABI.VaultRouter,
      functionName: 'enable',
      args: [this.address],
    })
  }

  /**
   * A router call into the vault only succeeds if the router is an endorsed operator for the
   * controller (`BaseVaults._validateController`), which a request made directly on the vault
   * never sets up.
   * @internal
   */
  _bundleEnableIfNeeded(data: HexString[], isOperator: boolean, ABI: ContractAbis): HexString[] {
    return isOperator ? data : [this._enableRouterData(ABI), ...data]
  }

  /**
   * The router forwards `msg.value` to its inner calls only through `multicall`, so a
   * fee-bearing call always batches; sent directly, the fee stays in the router for good.
   * @internal
   */
  _sendRouterFeeTransaction(
    title: string,
    ctx: TransactionContext,
    vaultRouter: HexString,
    data: HexString[],
    protocolVersion: ProtocolVersion
  ) {
    // v3.3 sends requests unpaid and pays them from the SubsidyManager, and its
    // router forwards no value to the vault, so a fee attached here would be
    // stranded in the router: the request goes with zero value.
    if (protocolVersion === PROTOCOL_VERSION_V3_3) {
      return wrapTransaction(title, ctx, { contract: vaultRouter, data })
    }
    return wrapTransaction(title, ctx, {
      contract: vaultRouter,
      data,
      alwaysBatch: true,
      messages: { [this.pool.id.centrifugeId]: [{ type: MessageType.Request, poolId: this.pool.id }] },
    })
  }

  /**
   * The protocol version the vault itself was deployed at. A pre-3.3 vault is
   * unchanged on a pool that moved to v3.3 and runs against the v3.3 managers
   * (decision 2026-10-06), so its own calls use its own version's ABI while
   * every manager, router and escrow comes from the pool's context.
   *
   * On a v3.2 pool that is v3.2. On a v3.3 pool, a v3.2 vault answers
   * `vaultKind()`, which v3.3 vaults dropped; read once and cached.
   * @internal
   */
  _vaultVersion() {
    return this._query(['vaultVersion'], () =>
      combineLatest([this.network._protocolContext(), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(([ctx, client]) =>
          defer(async (): Promise<ProtocolVersion> => {
            if (!isV3_3(ctx)) return ctx.protocolVersion
            try {
              await client.readContract({
                address: this.address,
                abi: getContractAbis(PROTOCOL_VERSION_V3_2).AsyncVault,
                functionName: 'vaultKind',
              })
              return PROTOCOL_VERSION_V3_2
            } catch (error) {
              // Only the vault refusing the call says it is a v3.3 vault; a failed read is an error.
              const reverted =
                error instanceof BaseError &&
                !!error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError)
              if (!reverted) throw error
              return ctx.protocolVersion
            }
          })
        )
      )
    )
  }

  /** @internal */
  _isSyncDeposit() {
    return this._query(['isSyncDeposit'], () =>
      combineLatest([this._root.getClient(this.centrifugeId), this._vaultVersion()]).pipe(
        switchMap(([client, vaultVersion]) =>
          defer(() =>
            client
              .readContract({
                address: this.address,
                abi: getContractAbis(vaultVersion).AsyncVault,
                functionName: 'supportsInterface',
                args: ['0xce3bbe50'], // ASYNC_DEPOSIT_INTERFACE_ID
              })
              .then((val) => !val)
          )
        )
      )
    )
  }

  /**
   * Get the contract address of the restriction mananger.
   * @internal
   */
  _restrictionManager() {
    return this._query(['restrictionManager'], () =>
      combineLatest([this.network._share(this.shareClass.id), this._root.getClient(this.centrifugeId)]).pipe(
        switchMap(
          ([share, client]) =>
            client.readContract({
              address: share,
              abi: STANDARD_ABIS.Currency,
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
    return this._root.currency(this._asset, this.centrifugeId)
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
        this.network._protocolContext(),
        this._isSyncDeposit(),
      ]).pipe(
        switchMap(([asset, { vaultRouter }, isSyncDeposit]) =>
          this._root
            ._allowance(owner, isSyncDeposit ? vaultRouter : this.address, this.centrifugeId, asset.address)
            .pipe(map((allowance) => new Balance(allowance, asset.decimals)))
        )
      )
    )
  }

  /**
   * Get the maximum reserve for this vault.
   * @internal
   */
  _maxReserve() {
    return this._query(['maxReserve'], () =>
      combineLatest([
        this._root.getClient(this.centrifugeId),
        this.network._protocolContext(),
        this._investmentCurrency(),
      ]).pipe(
        switchMap(([client, { syncManager, contractAbis: ABI, protocolVersion }, asset]) =>
          defer(async () => {
            const maxReserve = await client.readContract({
              address: syncManager,
              abi: ABI.SyncManager,
              functionName: 'maxReserve',
              args: [this.pool.id.raw, this.shareClass.id.raw, this._asset, VAULT_ASSET_TOKEN_ID],
            })
            return new Balance(maxReserve, asset.decimals)
          }).pipe(
            repeatOnEvents(
              this._root,
              {
                address: syncManager,
                eventName: ['SetMaxReserve'],
                filter: (events) =>
                  events.some(
                    (event) =>
                      event.args.poolId === this.pool.id.raw &&
                      event.args.scId === this.shareClass.id.raw &&
                      event.args.asset?.toLowerCase() === this._asset
                  ),
              },
              this.centrifugeId,
              protocolVersion
            )
          )
        )
      )
    )
  }

  /**
   * Get the available balance for this vault from the BalanceSheet. Reads it for the vault's own
   * asset rather than re-resolving `assetId`, which a pre-3.3 vault on a migrated pool may resolve
   * differently in the pool's current registry.
   * @internal
   */
  _availableBalance() {
    return this._query(['availableBalance'], () =>
      combineLatest([this.network.balanceSheet(this.shareClass.id), this._investmentCurrency()]).pipe(
        switchMap(([balanceSheet, currency]) =>
          balanceSheet._availableBalanceOf({
            address: this._asset,
            tokenId: VAULT_ASSET_TOKEN_ID,
            decimals: currency.decimals,
          })
        )
      )
    )
  }
}
