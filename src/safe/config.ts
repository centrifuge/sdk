import { parseAbi } from 'viem'
import { SAFE_EXECUTION_ABI, SAFE_HUB_DECODE_ABI } from '../abi/Safe.abi.js'

export const SAFE_CLIENT_BASE_URL = 'https://safe-client.safe.global'

export const HUB_DECODE_ABI = parseAbi(SAFE_HUB_DECODE_ABI)

export const HUB_FUNCTION_LABELS: Record<string, string> = {
  updateSharePrice: 'Update share price',
  notifySharePrice: 'Notify share price',
  notifyShareClass: 'Notify share class',
  notifyPool: 'Notify pool',
  setRequestManager: 'Set request manager',
  updateHubManager: 'Update hub manager',
  updateBalanceSheetManager: 'Update balance sheet manager',
  updateGatewayManager: 'Update gateway manager',
}

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export const SAFE_EXEC_ABI = parseAbi(SAFE_EXECUTION_ABI)
