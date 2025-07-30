import { parseAbi } from 'viem'
import AccountingAbi from './Accounting.abi.js'
import AsyncRequestsAbi from './AsyncRequestManager.abi.js'
import AsyncVaultAbit from './AsyncVault.abi.js'
import BalanceSheetAbi from './BalanceSheet.abi.js'
import CurrencyAbi from './Currency.abi.js'
import ERC6909Abi from './ERC6909.abi.js'
import GasServiceAbi from './GasService.abi.js'
import HoldingsAbi from './Holdings.abi.js'
import HubAbi from './Hub.abi.js'
import HubRegistryAbi from './HubRegistry.abi.js'
import MessageDispatcherAbi from './MessageDispatcher.abi.js'
import MultiAdapterAbi from './MultiAdapter.abi.js'
import PoolEscrowAbi from './PoolEscrow.abi.js'
import PoolEscrowFactoryAbi from './PoolEscrowFactory.abi.js'
import RestrictionManagerAbi from './RestrictionManager.abi.js'
import ShareClassManagerAbi from './ShareClassManager.abi.js'
import SpokeAbi from './Spoke.abi.js'
import SyncRequestsAbi from './SyncRequestManager.abi.js'
import ValuationAbi from './Valuation.abi.js'
import VaultRouterAbi from './VaultRouter.abi.js'

export const ABI = {
  Hub: parseAbi(HubAbi),
  ShareClassManager: parseAbi(ShareClassManagerAbi),
  HubRegistry: parseAbi(HubRegistryAbi),
  MessageDispatcher: parseAbi(MessageDispatcherAbi),
  Currency: parseAbi(CurrencyAbi),
  ERC6909: parseAbi(ERC6909Abi),
  RestrictionManager: parseAbi(RestrictionManagerAbi),
  AsyncVault: parseAbi(AsyncVaultAbit),
  Spoke: parseAbi(SpokeAbi),
  VaultRouter: parseAbi(VaultRouterAbi),
  Accounting: parseAbi(AccountingAbi),
  Holdings: parseAbi(HoldingsAbi),
  Valuation: parseAbi(ValuationAbi),
  SyncRequests: parseAbi(SyncRequestsAbi),
  AsyncRequests: parseAbi(AsyncRequestsAbi),
  MultiAdapter: parseAbi(MultiAdapterAbi),
  BalanceSheet: parseAbi(BalanceSheetAbi),
  GasService: parseAbi(GasServiceAbi),
  PoolEscrow: parseAbi(PoolEscrowAbi),
  PoolEscrowFactory: parseAbi(PoolEscrowFactoryAbi),
}
