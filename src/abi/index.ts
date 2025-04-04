import { parseAbi } from 'viem'
import CentrifugeRouter from './CentrifugeRouter.abi.json' assert { type: 'json' }
import Currency from './Currency.abi.json' assert { type: 'json' }
import Gateway from './Gateway.abi.json' assert { type: 'json' }
import InvestmentManager from './InvestmentManager.abi.json' assert { type: 'json' }
import LiquidityPool from './LiquidityPool.abi.json' assert { type: 'json' }
import PoolManager from './PoolManager.abi.json' assert { type: 'json' }
import RestrictionManager from './RestrictionManager.abi.json' assert { type: 'json' }
import Router from './Router.abi.json' assert { type: 'json' }

export const ABI = {
  CentrifugeRouter: parseAbi(CentrifugeRouter),
  Currency: parseAbi(Currency),
  RestrictionManager: parseAbi(RestrictionManager),
  Gateway: parseAbi(Gateway),
  InvestmentManager: parseAbi(InvestmentManager),
  LiquidityPool: parseAbi(LiquidityPool),
  PoolManager: parseAbi(PoolManager),
  Router: parseAbi(Router),
}
