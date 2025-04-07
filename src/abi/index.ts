import { parseAbi } from 'viem'
import AccountingAbi from './Accounting.abi.js'
import CurrencyAbi from './Currency.abi.js'
import HoldingsAbi from './Holdings.abi.js'
import InvestmentManagerAbi from './InvestmentManager.abi.js'
import MessageDispatcherAbi from './MessageDispatcher.abi.js'
import PoolManagerAbi from './PoolManager.abi.js'
import PoolRegistryAbi from './PoolRegistry.abi.js'
import PoolRouterAbi from './PoolRouter.abi.js'
import RestrictionManagerAbi from './RestrictionManager.abi.js'
import ShareClassManagerAbi from './ShareClassManager.abi.js'
import VaultAbi from './Vault.abi.js'
import VaultRouterAbi from './VaultRouter.abi.js'

export const ABI = {
  PoolRouter: parseAbi(PoolRouterAbi),
  ShareClassManager: parseAbi(ShareClassManagerAbi),
  PoolRegistry: parseAbi(PoolRegistryAbi),
  MessageDispatcher: parseAbi(MessageDispatcherAbi),
  Currency: parseAbi(CurrencyAbi),
  RestrictionManager: parseAbi(RestrictionManagerAbi),
  InvestmentManager: parseAbi(InvestmentManagerAbi),
  Vault: parseAbi(VaultAbi),
  PoolManager: parseAbi(PoolManagerAbi),
  VaultRouter: parseAbi(VaultRouterAbi),
  Accounting: parseAbi(AccountingAbi),
  Holdings: parseAbi(HoldingsAbi),
}
