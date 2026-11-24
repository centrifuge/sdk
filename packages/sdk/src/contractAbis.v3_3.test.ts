import { expect } from 'chai'
import { ABIS_V3_2, ABIS_V3_3, getContractAbis } from '@centrifuge/protocol'

// `getContractAbis('3.3')` hands the SDK the v3.3 ABIs typed as the v3.2 set,
// which is a promise only for the calls v3.3 kept. These are the calls the SDK
// makes through that view without branching on the version. If a later v3.3
// set changes one, this fails here instead of at `AbiFunctionNotFoundError` on
// a live pool. A call that needs a v3.3 branch comes off this list when the
// branch is added.
const UNBRANCHED_CALLS: Record<string, readonly string[]> = {
  Accounting: ['exists'],
  AccountingToken: ['minters'],
  AsyncRequests: ['investments'],
  AsyncVault: ['isOperator', 'isPermissioned', 'maxDeposit', 'maxRedeem', 'supportsInterface'],
  BatchRequestManager: [
    'depositRequest',
    'maxDepositClaims',
    'maxRedeemClaims',
    'nowDepositEpoch',
    'nowIssueEpoch',
    'nowRedeemEpoch',
    'nowRevokeEpoch',
    'queuedDepositRequest',
    'queuedRedeemRequest',
    'redeemRequest',
  ],
  Currency: ['eip712Domain', 'name', 'nonces', 'version'],
  GasService: ['maxBatchGasLimit', 'messageOverallGasLimit'],
  Gateway: ['repay', 'retry', 'underpaid'],
  Holdings: ['accountId', 'amount', 'valuation', 'value'],
  Hub: [
    'addShareClass',
    'createAccount',
    'createPool',
    'multicall',
    'notifyAssetPrice',
    'notifyPool',
    'notifySharePrice',
    'setPoolMetadata',
    'setRequestManager',
    'updateHubManager',
    'updateRestriction',
    'updateShareClassMetadata',
  ],
  HubRegistry: ['currency', 'isRegistered', 'metadata'],
  MultiAdapter: ['estimate', 'quorum', 'threshold'],
  OnOffRampManager: ['accountingToken', 'deposit', 'withdraw'],
  OnOffRampManagerFactory: ['newManager'],
  OnchainPM: ['execute', 'multicall', 'policy'],
  OnchainPMFactory: ['getAddress', 'newOnchainPM'],
  PoolEscrow: ['holding'],
  PoolEscrowFactory: ['escrow'],
  RestrictionManager: ['isMember'],
  ShareClassManager: ['metadata', 'pricePoolPerShare', 'shareClassCount', 'totalIssuance'],
  Spoke: ['registerAsset'],
  SyncManager: ['maxReserve', 'valuation'],
  Valuation: ['getQuote'],
  VaultRouter: [
    'cancelDepositRequest',
    'cancelRedeemRequest',
    'claimCancelDepositRequest',
    'claimCancelRedeemRequest',
    'claimDeposit',
    'claimRedeem',
    'deposit',
    'enable',
    'permit',
    'requestDeposit',
    'requestRedeem',
  ],
}

type AbiItem = { type: string; name?: string; inputs?: { type: string }[]; outputs?: { type: string }[] }

function signatures(abi: readonly AbiItem[], name: string): string[] {
  return abi
    .filter((item) => item.type === 'function' && item.name === name)
    .map(
      (item) =>
        `${name}(${(item.inputs ?? []).map((i) => i.type).join(',')}) -> (${(item.outputs ?? [])
          .map((o) => o.type)
          .join(',')})`
    )
    .sort()
}

describe('v3.3 contract ABIs under the v3.2 names', () => {
  const v3_3 = getContractAbis('3.3') as unknown as Record<string, readonly AbiItem[]>
  const v3_2 = ABIS_V3_2 as unknown as Record<string, readonly AbiItem[]>

  for (const [contract, functions] of Object.entries(UNBRANCHED_CALLS)) {
    it(`${contract} keeps the inputs and outputs of every call the SDK makes without a version branch`, () => {
      for (const name of functions) {
        const before = signatures(v3_2[contract]!, name)
        expect(before, `${contract}.${name} is not in the v3.2 set`).to.not.be.empty
        expect(signatures(v3_3[contract]!, name), `${contract}.${name}`).to.deep.equal(before)
      }
    })
  }

  // `balanceSheetAbi` and `queueAbi` type the v3.3 Spoke and SnapshotQueue as the v3.2
  // BalanceSheet for the queue calls, which holds only while these signatures match.
  it('keeps the v3.2 BalanceSheet queue calls on the v3.3 Spoke and SnapshotQueue', () => {
    const balanceSheet = v3_2.BalanceSheet!
    const v3_3Contracts = ABIS_V3_3 as unknown as Record<string, readonly AbiItem[]>
    const moved: [string, string][] = [
      ['Spoke', 'submitQueuedAssets'],
      ['Spoke', 'submitQueuedShares'],
      ['SnapshotQueue', 'queuedAssets'],
      ['SnapshotQueue', 'queuedShares'],
    ]
    for (const [contract, name] of moved) {
      const before = signatures(balanceSheet, name)
      expect(before, `BalanceSheet.${name} is not in the v3.2 set`).to.not.be.empty
      expect(signatures(v3_3Contracts[contract]!, name), `${contract}.${name}`).to.deep.equal(before)
    }
  })
})
