import { parseAbi } from 'viem'
import AccountingAbi from './Accounting.abi.js'
import CurrencyAbi from './Currency.abi.js'
import GatewayAbi from './Gateway.abi.js'
import HoldingsAbi from './Holdings.abi.js'
import InvestmentManagerAbi from './InvestmentManager.abi.js'
import MessageProcessorAbi from './MessageProcessor.abi.js'
import PoolManagerAbi from './PoolManager.abi.js'
import PoolRegistryAbi from './PoolRegistry.abi.js'
import PoolRouterAbi from './PoolRouter.abi.js'
import RestrictionManagerAbi from './RestrictionManager.abi.js'
import RouterAbi from './Router.abi.js'
import ShareClassManagerAbi from './ShareClassManager.abi.js'
import VaultAbi from './Vault.abi.js'
import VaultRouterAbi from './VaultRouter.abi.js'

export const ABI = {
  PoolRouter: parseAbi(PoolRouterAbi),
  ShareClassManager: parseAbi(ShareClassManagerAbi),
  PoolRegistry: parseAbi(PoolRegistryAbi),
  MessageProcessor: parseAbi(MessageProcessorAbi),
  Currency: parseAbi(CurrencyAbi),
  RestrictionManager: parseAbi(RestrictionManagerAbi),
  Gateway: parseAbi(GatewayAbi),
  InvestmentManager: parseAbi(InvestmentManagerAbi),
  Vault: parseAbi(VaultAbi),
  PoolManager: parseAbi(PoolManagerAbi),
  Router: parseAbi(RouterAbi),
  VaultRouter: parseAbi(VaultRouterAbi),
  Accounting: parseAbi(AccountingAbi),
  Holdings: parseAbi(HoldingsAbi),
}
