import { EIP1193ProviderLike } from '../types/transaction.js'

export function isEIP1193ProviderLike(signer: unknown): signer is EIP1193ProviderLike {
  return signer !== null && typeof signer === 'object' && 'request' in signer
}
