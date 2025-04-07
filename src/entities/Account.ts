import { defer } from 'rxjs'
import { ABI } from '../abi/index.js'
import type { Centrifuge } from '../Centrifuge.js'
import type { HexString } from '../types/index.js'
import { repeatOnEvents } from '../utils/rx.js'
import { Entity } from './Entity.js'

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

  transfer(to: string, amount: bigint) {
    return this._transact(
      'Transfer',
      ({ walletClient }) =>
        walletClient.writeContract({
          address: tUSD,
          abi: ABI.Currency,
          functionName: 'transfer',
          args: [to as any, amount],
        }),
      this.chainId
    )
  }
}
