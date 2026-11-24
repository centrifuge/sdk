import { ABIS_V3_3 } from '@centrifuge/protocol'
import { expect } from 'chai'
import { encodeFunctionData } from 'viem'
import { ctx, HUB, pool33Id, SPOKE, who } from '../tests/hubGroup.js'
import type { HexString } from '../types/index.js'
import { VaultUpdateKind, type OutOfPolicyBatchCall } from '../types/transaction.js'
import { deploymentTarget, deferredFlags } from './hubExecutionRules.js'
import { deriveHubCallMessages, parseHubCall } from './hubCallMessages.js'
import { AssetId } from './types.js'

// The rules say which instant calls a matured group rebuilds. The calls here are the ones an entity's batch holds, and
// `deferredFlags` answers which of them a scheduling transaction leaves for the execution.

const poolId = pool33Id.raw
const scId = `0x${'11'.repeat(16)}` as HexString
const otherScId = `0x${'22'.repeat(16)}` as HexString
const asset = AssetId.from(SPOKE, 1).raw
const otherAsset = AssetId.from(SPOKE, 2).raw
const hubAsset = AssetId.from(HUB, 1).raw
const call = (functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi: ABIS_V3_3.Hub, functionName, args } as any)

const updatePrice = (id = scId) => call('updateSharePrice', [poolId, id, 10n ** 18n, 1_700_000_000n])
const notifyPrice = (id = scId, centrifugeId = SPOKE) => call('notifySharePrice', [poolId, id, centrifugeId, who])
const notifyPool = (centrifugeId = SPOKE) => call('notifyPool', [poolId, centrifugeId, who])
const notifyAssetPrice = (id = scId, assetId = asset) => call('notifyAssetPrice', [poolId, id, assetId, who])
const word = `0x${'00'.repeat(32)}`
const notifyClass = (centrifugeId = SPOKE) =>
  call('notifyShareClass', [poolId, scId, centrifugeId, word, '0x', 0n, who])
const setRequestManager = (centrifugeId = SPOKE) => call('setRequestManager', [poolId, centrifugeId, who, word, who])
const updateVault = (kind: VaultUpdateKind, assetId = asset, id = scId) =>
  call('updateVault', [poolId, id, assetId, word, kind, '0x', 0n, who])
const metadata = () => call('setPoolMetadata', [poolId, '0x'])

type Entry = readonly [HexString, OutOfPolicyBatchCall['status']]
const flags = (...entries: Entry[]) => deferredFlags(entries.map(([data, status]) => ({ data, status })))

describe('deferredFlags', () => {
  describe('a share price update that is not ready', () => {
    it('defers the notification of the same share class and no other', () => {
      expect(
        flags(
          [updatePrice(), 'needs-authorization'],
          [notifyPrice(scId, SPOKE), 'ready'],
          [notifyPrice(scId, HUB), 'ready'],
          [notifyPrice(otherScId), 'ready']
        )
      ).to.deep.equal([false, true, true, false])
    })

    it('defers nothing when the update is ready, since the entity’s own notification is then sent with it', () => {
      expect(flags([updatePrice(), 'ready'], [notifyPrice(), 'ready'])).to.deep.equal([false, false])
    })

    it('defers a notification for a pending, expired or undetermined update as well', () => {
      for (const status of ['pending', 'expired', 'undetermined', 'forbidden'] as const) {
        expect(flags([updatePrice(), status], [notifyPrice(), 'ready']), status).to.deep.equal([false, true])
      }
    })

    it('does not defer a notification that is not ready itself', () => {
      expect(flags([updatePrice(), 'needs-authorization'], [notifyPrice(), 'needs-authorization'])).to.deep.equal([
        false,
        false,
      ])
    })

    it('reads the update without a timestamp the same way', () => {
      const update = call('updateSharePrice', [poolId, scId, 10n ** 18n])

      expect(flags([update, 'needs-authorization'], [notifyPrice(), 'ready'])).to.deep.equal([false, true])
    })
  })

  describe('a deployment leg that is not ready', () => {
    const legs: [string, HexString][] = [
      ['a notifyShareClass', notifyClass()],
      ['a setRequestManager', setRequestManager()],
      ['an updateVault that deploys a vault', updateVault(VaultUpdateKind.DeployAndLink)],
    ]

    for (const [name, leg] of legs) {
      it(`defers the notifyPool to the network of ${name}`, () => {
        expect(flags([leg, 'needs-authorization'], [notifyPool(SPOKE), 'ready'])).to.deep.equal([false, true])
      })

      it(`does not defer the notifyPool to another network than the one of ${name}`, () => {
        expect(flags([leg, 'needs-authorization'], [notifyPool(HUB), 'ready'])).to.deep.equal([false, false])
      })

      it(`does not defer the notifyPool when ${name} is ready`, () => {
        expect(flags([leg, 'ready'], [notifyPool(SPOKE), 'ready'])).to.deep.equal([false, false])
      })
    }

    it('does not count a link or an unlink as a deployment', () => {
      for (const kind of [VaultUpdateKind.Link, VaultUpdateKind.Unlink]) {
        expect(
          flags([updateVault(kind), 'needs-authorization'], [notifyPool(SPOKE), 'ready']),
          String(kind)
        ).to.deep.equal([false, false])
      }
    })

    it('does not count a call bound for the network that deploys nothing as a deployment', () => {
      const restriction = call('updateRestriction', [poolId, scId, SPOKE, '0x', 0n, who])

      expect(flags([restriction, 'needs-authorization'], [notifyPool(SPOKE), 'ready'])).to.deep.equal([false, false])
    })
  })

  describe('a vault that is deployed and not ready', () => {
    it('defers the asset price of the same share class and asset', () => {
      expect(
        flags(
          [updateVault(VaultUpdateKind.DeployAndLink), 'needs-authorization'],
          [notifyAssetPrice(scId, asset), 'ready']
        )
      ).to.deep.equal([false, true])
    })

    it('does not defer the price of another asset or another share class', () => {
      expect(
        flags(
          [updateVault(VaultUpdateKind.DeployAndLink), 'needs-authorization'],
          [notifyAssetPrice(scId, otherAsset), 'ready'],
          [notifyAssetPrice(otherScId, asset), 'ready']
        )
      ).to.deep.equal([false, false, false])
    })

    it('defers nothing for a link or an unlink, or once the update is ready', () => {
      expect(
        flags([updateVault(VaultUpdateKind.Link), 'needs-authorization'], [notifyAssetPrice(), 'ready'])
      ).to.deep.equal([false, false])
      expect(flags([updateVault(VaultUpdateKind.DeployAndLink), 'ready'], [notifyAssetPrice(), 'ready'])).to.deep.equal(
        [false, false]
      )
    })

    it('defers the pool and asset notifications of one deployment together', () => {
      expect(
        flags(
          [notifyPool(SPOKE), 'ready'],
          [notifyClass(SPOKE), 'needs-authorization'],
          [notifyAssetPrice(), 'ready'],
          [updateVault(VaultUpdateKind.DeployAndLink), 'needs-authorization']
        )
      ).to.deep.equal([true, false, true, false])
    })
  })

  describe('a call no rule rebuilds', () => {
    it('is not deferred, whatever the batch holds', () => {
      expect(
        flags(
          [updatePrice(), 'needs-authorization'],
          [notifyClass(), 'needs-authorization'],
          [metadata(), 'ready'],
          [call('notifyShareMetadata', [poolId, scId, SPOKE, 0n, who]), 'ready']
        )
      ).to.deep.equal([false, false, false, false])
    })

    it('is not deferred when the batch holds no call that is not ready', () => {
      expect(flags([notifyPrice(), 'ready'], [notifyPool(), 'ready'], [notifyAssetPrice(), 'ready'])).to.deep.equal([
        false,
        false,
        false,
      ])
    })

    it('answers false for calldata that is none of a Hub function, instead of throwing', () => {
      expect(flags(['0xabc' as HexString, 'needs-authorization'], ['0xdeadbeef' as HexString, 'ready'])).to.deep.equal([
        false,
        false,
      ])
      expect(
        flags([`${updatePrice().slice(0, 10)}00` as HexString, 'needs-authorization'], [notifyPrice(), 'ready'])
      ).to.deep.equal([false, false])
    })

    it('answers an empty batch with no flags', () => {
      expect(deferredFlags([])).to.deep.equal([])
    })
  })

  it('treats a hub asset like any other: the notification waits for the vault deployed there', () => {
    expect(
      flags(
        [updateVault(VaultUpdateKind.DeployAndLink, hubAsset), 'needs-authorization'],
        [notifyAssetPrice(scId, hubAsset), 'ready']
      )
    ).to.deep.equal([false, true])
  })
})

describe('deploymentTarget', () => {
  const scope = { poolId: pool33Id, batchRequestManager: ctx(pool33Id, '3.3').addresses.batchRequestManager! }

  it('names the one network the derived messages of a deployment leg go to', () => {
    for (const data of [
      notifyClass(SPOKE),
      setRequestManager(SPOKE),
      updateVault(VaultUpdateKind.DeployAndLink, asset),
      updateVault(VaultUpdateKind.DeployAndLink, hubAsset),
    ]) {
      const parsed = parseHubCall(data, pool33Id)

      expect([deploymentTarget(parsed)], parsed.functionName).to.deep.equal(
        Object.keys(deriveHubCallMessages(parsed, scope)).map(Number)
      )
    }
  })

  it('names none for a call that deploys nothing', () => {
    for (const data of [
      updateVault(VaultUpdateKind.Link),
      updateVault(VaultUpdateKind.Unlink),
      notifyPool(),
      updatePrice(),
      metadata(),
    ]) {
      expect(deploymentTarget(parseHubCall(data, pool33Id))).to.equal(null)
    }
  })
})
