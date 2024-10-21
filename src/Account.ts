import { defer, switchMap } from 'rxjs'
import { ABI } from './abi/index.js'
import type { Centrifuge } from './Centrifuge.js'
import { NULL_ADDRESS } from './constants.js'
import { Entity } from './Entity.js'
import type { HexString } from './types/index.js'
import { repeatOnEvents } from './utils/rx.js'
import { doSignMessage, doTransaction, signPermit } from './utils/transaction.js'

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
      async ({ walletClient }) =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to, amount],
        }),
      this.chainId
    )
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
    return this._transact(async function* ({ walletClient, publicClient, chainId, signingAddress, signer }) {
      const permit = yield* doSignMessage('Sign Permit', () => {
        return signPermit(walletClient, signer, chainId, signingAddress, tUSD, NULL_ADDRESS, amount)
      })
      console.log('permit', permit)
      yield* doTransaction('Transfer', publicClient, () =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to, amount],
        })
      )
    }, this.chainId)
  }

  transfer4(to: HexString, amount: bigint) {
    return this._transact(
      ({ walletClient, publicClient }) =>
        this.balances().pipe(
          switchMap(async function* (balance) {
            console.log('balance', balance)
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
}
