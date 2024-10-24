import { concat, defer, first, switchMap, type ObservableInput } from 'rxjs'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { NULL_ADDRESS } from './constants.js'
import { Entity } from './Entity.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'
import { doSignMessage, doTransaction, getTransactionObservable, signPermit } from './utils/transaction.js'

const tUSD = '0x8503b4452Bf6238cC76CdbEE223b46d7196b1c93'

export class Account extends Entity {
  constructor(
    _root: Centrifuge,
    public accountId: HexString,
    public chainId: number
  ) {
    super(_root, ['account', accountId, chainId])
  }

  balances() {
    return this._query(['balances'], () => {
      return defer(async () => {
        const client = this._root.getClient(this.chainId)!
        const balance = (await client.readContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'balanceOf',
          args: [this.accountId],
        })) as bigint
        return balance
      }).pipe(
        repeatOnEvents(
          this._root,
          {
            address: tUSD,
            abi: ABI.Currency,
            eventName: 'Transfer',
            filter: (events) => {
              return events.some((event) => {
                return event.args.from === this.accountId || event.args.to === this.accountId
              })
            },
          },
          this.chainId
        )
      )
    })
  }

  transfer(to: HexString, amount: bigint) {
    return this._transact(
      'Transfer',
      ({ walletClient }) =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to, amount],
        }),
      this.chainId
    )
  }

  transfer1b(to: HexString, amount: bigint) {
    return this._transactSequence(async function* ({ walletClient, publicClient }) {
      yield* doTransaction('Transfer', publicClient, () =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to, amount],
        })
      )
      yield* doTransaction('Transfer2', publicClient, () =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to, amount],
        })
      )
    }, this.chainId)
  }

  transfer2(to: HexString, amount: bigint) {
    return this._transact(
      'Transfer',
      ({ walletClient }) =>
        this.balances().pipe(
          switchMap((balance) => {
            console.log('balance', balance)
            return walletClient.writeContract({
              address: tUSD,
              abi: ABI.Currency,
              functionName: 'transfer',
              args: [to, amount],
            })
          })
        ),
      this.chainId
    )
  }

  transfer3(to: HexString, amount: bigint) {
    return this._transactSequence(
      ({ walletClient, publicClient }) =>
        this.balances().pipe(
          first(),
          switchMap((balance) => {
            const needsApproval = true

            let $approval: ObservableInput<any> | null = null
            if (needsApproval) {
              $approval = getTransactionObservable('Approve', publicClient, () =>
                walletClient.writeContract({
                  address: tUSD,
                  abi: ABI.Currency,
                  functionName: 'approve',
                  args: [tUSD, amount],
                })
              )
            }

            const $transfer = getTransactionObservable('Transfer', publicClient, () =>
              walletClient.writeContract({
                address: tUSD,
                abi: ABI.Currency,
                functionName: 'transfer',
                args: [to, amount],
              })
            )

            return $approval ? concat($approval, $transfer) : $transfer
          })
        ),
      this.chainId
    )
  }

  transfer4(to: HexString, amount: bigint) {
    return this._transactSequence(
      ({ walletClient, publicClient }) =>
        this.balances().pipe(
          first(),
          switchMap(async function* (balance) {
            const needsApproval = true

            if (needsApproval) {
              yield* doTransaction('Approve', publicClient, () =>
                walletClient.writeContract({
                  address: tUSD,
                  abi: ABI.Currency,
                  functionName: 'approve',
                  args: [tUSD, amount],
                })
              )
            }

            yield* doTransaction('Transfer', publicClient, () =>
              walletClient.writeContract({
                address: tUSD,
                abi: ABI.Currency,
                functionName: 'transfer',
                args: [to, amount],
              })
            )
          })
        ),
      this.chainId
    )
  }

  transfer5(to: HexString, amount: bigint) {
    return this._transactSequence(
      ({ walletClient, publicClient, signer, chainId, signingAddress }) =>
        this.balances().pipe(
          first(),
          switchMap((balance) => {
            const needsApproval = true
            const supportsPermit = true

            let $approval: ObservableInput<any> | null = null
            let permit: any = null
            if (needsApproval) {
              if (supportsPermit) {
                $approval = doSignMessage('Sign Permit', async () => {
                  permit = await signPermit(walletClient, signer, chainId, signingAddress, tUSD, NULL_ADDRESS, amount)
                  return permit
                })
              } else {
                $approval = doTransaction('Approve', publicClient, () =>
                  walletClient.writeContract({
                    address: tUSD,
                    abi: ABI.Currency,
                    functionName: 'approve',
                    args: [tUSD, amount],
                  })
                )
              }
            }

            const $transfer = defer(() => {
              if (permit) {
                return doTransaction('Transfer', publicClient, () =>
                  walletClient.writeContract({
                    address: tUSD,
                    abi: ABI.Currency,
                    functionName: 'transfer',
                    args: [to, amount],
                  })
                )
              }
              return doTransaction('Transfer', publicClient, () =>
                walletClient.writeContract({
                  address: tUSD,
                  abi: ABI.Currency,
                  functionName: 'transfer',
                  args: [to, amount],
                })
              )
            })

            return $approval ? concat($approval, $transfer) : $transfer
          })
        ),
      this.chainId
    )
  }

  transfer6(to: HexString, amount: bigint) {
    return this._transactSequence(
      ({ walletClient, publicClient, signer, chainId, signingAddress }) =>
        this.balances().pipe(
          first(),
          switchMap(async function* (balance) {
            const needsApproval = true
            const supportsPermit = true

            let permit: any = null
            if (needsApproval) {
              if (supportsPermit) {
                permit = yield* doSignMessage('Sign Permit', () =>
                  signPermit(walletClient, signer, chainId, signingAddress, tUSD, NULL_ADDRESS, amount)
                )
              } else {
                yield* doTransaction('Approve', publicClient, () =>
                  walletClient.writeContract({
                    address: tUSD,
                    abi: ABI.Currency,
                    functionName: 'approve',
                    args: [tUSD, amount],
                  })
                )
              }
            }

            if (permit) {
              yield* doTransaction('Transfer', publicClient, () =>
                walletClient.writeContract({
                  address: tUSD,
                  abi: ABI.Currency,
                  functionName: 'transfer',
                  args: [to, amount],
                })
              )
            } else {
              yield* doTransaction('Transfer', publicClient, () =>
                walletClient.writeContract({
                  address: tUSD,
                  abi: ABI.Currency,
                  functionName: 'transfer',
                  args: [to, amount],
                })
              )
            }
          })
        ),
      this.chainId
    )
  }

  // transfer3(to: HexString, amount: bigint) {
  //   return this._transact(async function* ({ walletClient, publicClient, chainId, signingAddress, signer }) {
  //     const permit = yield* doSignMessage('Sign Permit', () => {
  //       return signPermit(walletClient, signer, chainId, signingAddress, tUSD, NULL_ADDRESS, amount)
  //     })
  //     console.log('permit', permit)
  //     yield* doTransaction('Transfer', publicClient, () =>
  //       walletClient.writeContract({
  //         address: tUSD,
  //         abi: ABI.Currency,
  //         functionName: 'transfer',
  //         args: [to, amount],
  //       })
  //     )
  //   }, this.chainId)
  // }

  // transfer4(to: HexString, amount: bigint) {
  //   return this._transact(
  //     ({ walletClient, publicClient }) =>
  //       this.balances().pipe(
  //         switchMap(async function* (balance) {
  //           console.log('balance', balance)
  //           yield* doTransaction('Transfer', publicClient, () =>
  //             walletClient.writeContract({
  //               address: tUSD,
  //               abi: ABI.Currency,
  //               functionName: 'transfer',
  //               args: [to, amount],
  //             })
  //           )
  //         })
  //       ),
  //     this.chainId
  //   )
  // }
}
