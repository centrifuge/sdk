import { parseAbi } from 'viem'
import CentrifugeRouter from './CentrifugeRouter.abi.js'
import Currency from './Currency.abi.js'
import Gateway from './Gateway.abi.js'
import InvestmentManager from './InvestmentManager.abi.js'
import LiquidityPool from './LiquidityPool.abi.js'
import Permit from './Permit.abi.js'
import PoolManager from './PoolManager.abi.js'
import Router from './Router.abi.js'

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
