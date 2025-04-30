import { parseAbi } from 'viem'
import AccountingAbi from './Accounting.abi.js'
import AsyncRequestsAbi from './AsyncRequestManager.abi.js'
import AsyncVaultAbit from './AsyncVault.abi.js'
import CurrencyAbi from './Currency.abi.js'
import HoldingsAbi from './Holdings.abi.js'
import HubAbi from './Hub.abi.js'
import HubRegistryAbi from './HubRegistry.abi.js'
import IERC7726Abi from './IERC7726.abi.js'
import MessageDispatcherAbi from './MessageDispatcher.abi.js'
import PoolManagerAbi from './PoolManager.abi.js'
import RestrictionManagerAbi from './RestrictionManager.abi.js'
import ShareClassManagerAbi from './ShareClassManager.abi.js'
import SyncRequestsAbi from './SyncRequestManager.abi.js'
import VaultRouterAbi from './VaultRouter.abi.js'

export const ABI = {
  Hub: parseAbi(HubAbi),
  ShareClassManager: parseAbi(ShareClassManagerAbi),
  HubRegistry: parseAbi(HubRegistryAbi),
  MessageDispatcher: parseAbi(MessageDispatcherAbi),
  Currency: parseAbi(CurrencyAbi),
  RestrictionManager: parseAbi(RestrictionManagerAbi),
  AsyncVault: parseAbi(AsyncVaultAbit),
  PoolManager: parseAbi(PoolManagerAbi),
  VaultRouter: parseAbi(VaultRouterAbi),
  Accounting: parseAbi(AccountingAbi),
  Holdings: parseAbi(HoldingsAbi),
  IERC7726: parseAbi(IERC7726Abi),
  SyncRequests: parseAbi(SyncRequestsAbi),
  AsyncRequests: parseAbi(AsyncRequestsAbi),
}
