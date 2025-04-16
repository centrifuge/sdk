import type { HexString } from '../types/index.js'

export type ProtocolContracts = {
  root: HexString
  adminSafe: HexString
  guardian: HexString
  gasService: HexString
  gateway: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
  hubRegistry: HexString
  accounting: HexString
  holdings: HexString
  shareClassManager: HexString
  hub: HexString
  transientValuation: HexString
  identityValuation: HexString
  escrow: HexString
  routerEscrow: HexString
  restrictedTransfers: HexString
  freelyTransferable: HexString
  tokenFactory: HexString
  asyncRequests: HexString
  syncRequests: HexString
  asyncVaultFactory: HexString
  syncDepositVaultFactory: HexString
  poolManager: HexString
  vaultRouter: HexString
  currencies: HexString[]
}

export const currencies: Record<number, HexString[]> = {
  11155111: ['0x86eb50b22dd226fe5d1f0753a40e247fd711ad6e'],
}
