import { parseAbi } from 'viem'
import CentrifugeRouter from './CentrifugeRouter.abi.json'
import Currency from './Currency.abi.json'
import Gateway from './Gateway.abi.json'
import InvestmentManager from './InvestmentManager.abi.json'
import LiquidityPool from './LiquidityPool.abi.json'
import Permit from './Permit.abi.json'
import PoolManager from './PoolManager.abi.json'
import Router from './Router.abi.json'

export const ABI = {
  CentrifugeRouter: parseAbi(CentrifugeRouter),
  Currency: parseAbi(Currency),
  Gateway: parseAbi(Gateway),
  InvestmentManager: parseAbi(InvestmentManager),
  LiquidityPool: parseAbi(LiquidityPool),
  Permit: parseAbi(Permit),
  PoolManager: parseAbi(PoolManager),
  Router: parseAbi(Router),
}
