import { of } from 'rxjs'
import sinon from 'sinon'
import { sepolia } from 'viem/chains'
import type { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../types/index.js'
import { makeThenable } from '../utils/rx.js'

export function randomAddress(): HexString {
  return `0x${Math.random().toString(16).slice(2).padStart(40, '0')}`
}

/**
 * Stubs chain and client resolution so a real `_transact` build run needs no indexer or Tenderly fork.
 * Build mode never touches the wallet client, so these stubs are all the I/O it needs.
 */
export function stubChain(centrifuge: Centrifuge, client: object = {}) {
  // The real methods return awaitable queries; a bare `of(...)` is not awaitable.
  const thenable = <T>(value: T) => makeThenable(of(value))
  sinon.stub(centrifuge as any, '_idToChain').returns(thenable(sepolia.id))
  sinon.stub(centrifuge as any, 'getChainConfig').returns(thenable(sepolia))
  sinon.stub(centrifuge as any, 'getClient').returns(thenable(client as any))
}
