import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { MessageType, VaultUpdateKind, emptyMessage } from '../types/transaction.js'
import { PoolId } from './types.js'

/**
 * The SDK half of the cross-package byte-parity fixture.
 *
 * `emptyMessage` moved into `@centrifuge/protocol` so the backend and the SDK
 * cannot drift, and this file asserts the half that did NOT move: the
 * translation of this package's descriptor union (a discriminated object
 * carrying a `PoolId` instance) into the package's `(type, poolId, subtype)`
 * arguments. That mapping is the remaining place the two sides could disagree —
 * a `poolId` read off the wrong field, or an `UpdateVault` subtype dropped —
 * and it is invisible to a test that only checks the package's own function.
 *
 * Why bytes and not behaviour: `MultiAdapter.estimate` takes the payload and
 * its answer depends on the payload's CONTENT. Measured live, the same message
 * padded with `0xff` instead of zero cost 50,815,112,882 wei more. So the
 * crosschain fee is deterministic only as a convention of these exact bytes,
 * and a behavioural test ("encodes a type byte, then a pool id") would pass for
 * two implementations that priced the same transaction differently.
 *
 * The fixture is read from `@centrifuge/protocol`'s source rather than copied,
 * on purpose: one file, two readers. It was generated from THIS file's
 * pre-move implementation (at `fa32208`), so it records what shipped rather
 * than what either side happens to produce now. Regenerating it to make a test
 * pass would silently reprice every crosschain transaction on both sides.
 */
type Vector = {
  type: string
  ordinal: number
  poolId: string | null
  subtype: number | null
  subtypeName?: string
  hex: string
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../protocol/src/messages/__fixtures__/empty-message-bytes.json', import.meta.url), 'utf8')
) as { ordinals: Record<string, number>; vaultUpdateKinds: Record<string, number>; vectors: Vector[] }

describe('emptyMessage cross-package byte parity', () => {
  it('has a non-empty fixture (a silently empty one would assert nothing)', () => {
    expect(fixture.vectors.length).to.be.greaterThan(0)
  })

  it('reproduces every fixture vector through the SDK descriptor form', () => {
    for (const vector of fixture.vectors) {
      const context = `${vector.type} poolId=${vector.poolId} subtype=${vector.subtypeName ?? vector.subtype}`

      if (vector.poolId === null) {
        expect(emptyMessage(vector.ordinal as any), context).to.equal(vector.hex)
        continue
      }

      const poolId = new PoolId(BigInt(vector.poolId))
      const descriptor =
        vector.type === 'UpdateVault'
          ? // `subtype: null` in the fixture means the SDK caller omitted it,
            // which must still produce the DeployAndLink bytes — the `??`
            // default now lives on the package side, so this is the case that
            // proves both sides share it.
            ({ type: MessageType.UpdateVault, poolId, subtype: vector.subtype ?? undefined } as any)
          : ({ type: vector.ordinal, poolId } as any)

      expect(emptyMessage(descriptor), context).to.equal(vector.hex)
    }
  })

  it('agrees with the fixture on the re-exported enum ordinals', () => {
    // The ordinals ARE the wire values (the first payload byte is the type), so
    // a member inserted mid-enum would renumber and reprice everything after
    // it. `MessageType` is now re-exported from @centrifuge/protocol; this is
    // what pins the re-export to the numbers that shipped.
    for (const [name, ordinal] of Object.entries(fixture.ordinals)) {
      expect(MessageType[name as keyof typeof MessageType], name).to.equal(ordinal)
    }
  })

  it('agrees with the fixture on VaultUpdateKind, which is the subtype byte', () => {
    expect(VaultUpdateKind.DeployAndLink).to.equal(fixture.vaultUpdateKinds.DeployAndLink)
    expect(VaultUpdateKind.Link).to.equal(fixture.vaultUpdateKinds.Link)
    expect(VaultUpdateKind.Unlink).to.equal(fixture.vaultUpdateKinds.Unlink)
  })
})
