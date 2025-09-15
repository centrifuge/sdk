import { HexString } from '../types/index.js'

export class AddressMap<U> extends Map<HexString, U> {
  override get(key: HexString): U | undefined {
    return super.get(key.toLowerCase() as any)
  }

  override has(key: HexString): boolean {
    return super.has(key.toLowerCase() as any)
  }

  override set(key: HexString, value: U): this {
    return super.set(key.toLowerCase() as any, value)
  }
}
