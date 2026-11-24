import { expect } from 'chai'
import sinon from 'sinon'
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  custom,
  encodeErrorResult,
  RpcRequestError,
  toFunctionSelector,
  zeroAddress,
} from 'viem'
import { ABIS_V3_2 as ABI } from '@centrifuge/protocol'
import type { SdkProtocolContext } from '../Centrifuge.js'
import { isContractRevert, spokeAssets } from './spokeAssets.js'
import { AssetId } from './types.js'

const spoke = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const registry = '0xffffffffffffffffffffffffffffffffffffffff'
const token = '0xdddddddddddddddddddddddddddddddddddddddd'
const assetId = AssetId.from(13, 6)
const v3_2 = { protocolVersion: '3.2', spoke, contractAbis: ABI } as unknown as SdkProtocolContext
const v3_3 = { protocolVersion: '3.3', spoke, spokeRegistry: registry, contractAbis: ABI } as unknown as SdkProtocolContext

type ReadArgs = { address: string; functionName: string; args?: readonly unknown[] }

function revert(functionName: string, errorName?: 'UnknownAsset') {
  return new ContractFunctionRevertedError({
    abi: ABI.Spoke,
    functionName,
    data: errorName ? encodeErrorResult({ abi: ABI.Spoke, errorName }) : undefined,
    message: 'execution reverted',
  })
}

function clientFor(handler: (args: ReadArgs) => unknown) {
  return { readContract: sinon.stub().callsFake(async (args: ReadArgs) => handler(args)) }
}

describe('spokeAssets', () => {
  afterEach(() => sinon.restore())

  describe('v3.2 spoke (lookups on the spoke, reverting on an unknown asset)', () => {
    const legacy = (known: boolean) =>
      clientFor(({ address, functionName }) => {
        expect(address).to.equal(spoke)
        if (!known) throw revert(functionName, 'UnknownAsset')
        return functionName === 'assetToId' ? assetId.raw : [token, 0n]
      })

    it('reads a registered asset from the spoke', async () => {
      const assets = spokeAssets(legacy(true) as any, v3_2)

      expect((await assets.assetId(token, 1n))?.raw).to.equal(assetId.raw)
      expect(await assets.asset(assetId)).to.deep.equal({ address: token, tokenId: 0n })
    })

    it('maps an UnknownAsset revert to null', async () => {
      const assets = spokeAssets(legacy(false) as any, v3_2)

      expect(await assets.assetId(token, 1n)).to.equal(null)
      expect(await assets.asset(assetId)).to.equal(null)
    })

    it('rethrows a revert that is not UnknownAsset', async () => {
      const assets = spokeAssets(
        clientFor(() => {
          throw revert('assetToId')
        }) as any,
        v3_2
      )

      const error = await assets.assetId(token, 1n).catch((e: Error) => e)
      expect(error).to.be.instanceOf(ContractFunctionRevertedError)
    })
  })

  describe('v3.3 spoke (lookups through its SpokeRegistry)', () => {
    it('reads a registered asset from the registry the context names', async () => {
      const client = clientFor(({ address, functionName }) => {
        expect(address).to.equal(registry)
        return functionName === 'assetToId' ? assetId.raw : [token, 0n]
      })
      const assets = spokeAssets(client as any, v3_3)

      expect((await assets.assetId(token, 0n))?.raw).to.equal(assetId.raw)
      expect(await assets.asset(assetId)).to.deep.equal({ address: token, tokenId: 0n })
    })

    it('maps a zero result to null', async () => {
      const client = clientFor(({ functionName }) => (functionName === 'assetToId' ? 0n : [zeroAddress, 0n]))
      const assets = spokeAssets(client as any, v3_3)

      expect(await assets.assetId(token, 0n)).to.equal(null)
      expect(await assets.asset(assetId)).to.equal(null)
    })
  })

  it('propagates a transport failure instead of mapping it to an unknown asset', async () => {
    const assets = spokeAssets(
      clientFor(() => {
        throw new Error('fetch failed')
      }) as any,
      v3_2
    )

    const error = await assets.assetId(token, 0n).catch((e: Error) => e)
    expect((error as Error).message).to.equal('fetch failed')
  })
})

describe('isContractRevert', () => {
  it('recognizes a revert wrapped in a contract call error', () => {
    expect(isContractRevert(new BaseError('Contract call failed', { cause: revert('accountingToken') }))).to.equal(true)
  })

  it('does not classify an empty return as a revert, since it means no code at the address', () => {
    const cause = new ContractFunctionZeroDataError({ functionName: 'accountingToken' })
    expect(isContractRevert(new BaseError('Contract call failed', { cause }))).to.equal(false)
  })

  it('does not classify transport failures or arbitrary values as contract reverts', () => {
    expect(isContractRevert(new BaseError('fetch failed'))).to.equal(false)
    expect(isContractRevert(new Error('fetch failed'))).to.equal(false)
    expect(isContractRevert(null)).to.equal(false)
  })

  for (const code of [3, -32000]) {
    it(`recognizes a missing function reported by a node as error ${code} without data, through the viem pipeline`, async () => {
      const selector = toFunctionSelector('function accountingToken() view returns (address)')
      const client = createPublicClient({
        transport: custom({
          request: async ({ method, params }: { method: string; params: [{ data: string }] }) => {
            if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
            if (params[0].data.startsWith(selector)) {
              throw new RpcRequestError({ body: { method }, error: { code, message: 'execution reverted' }, url: '' })
            }
            throw new Error('unexpected call')
          },
        }),
      })

      const error = await client
        .readContract({ address: spoke, abi: ABI.OnOffRampManager, functionName: 'accountingToken' })
        .catch((e: unknown) => e)

      expect(isContractRevert(error)).to.equal(true)
    })
  }
})
