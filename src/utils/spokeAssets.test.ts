import { expect } from 'chai'
import sinon from 'sinon'
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeErrorResult,
  RpcRequestError,
  toFunctionSelector,
  zeroAddress,
} from 'viem'
import { ABI } from '../abi/index.js'
import { isContractRevert, spokeAssets } from './spokeAssets.js'
import { AssetId } from './types.js'

const spoke = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const registry = '0xffffffffffffffffffffffffffffffffffffffff'
const token = '0xdddddddddddddddddddddddddddddddddddddddd'
const assetId = AssetId.from(13, 6)

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

  describe('v3.1 / v3.2 spoke (lookups on the spoke, reverting on an unknown asset)', () => {
    const legacy = (known: boolean) =>
      clientFor(({ address, functionName }) => {
        expect(address).to.equal(spoke)
        if (functionName === 'spokeRegistry') throw revert('spokeRegistry')
        if (!known) throw revert(functionName, 'UnknownAsset')
        return functionName === 'assetToId' ? assetId.raw : [token, 0n]
      })

    it('reads a registered asset from the spoke', async () => {
      const assets = await spokeAssets(legacy(true) as any, spoke)

      expect((await assets.assetId(token, 1n))?.raw).to.equal(assetId.raw)
      expect(await assets.asset(assetId)).to.deep.equal({ address: token, tokenId: 0n })
    })

    it('maps an UnknownAsset revert to null', async () => {
      const assets = await spokeAssets(legacy(false) as any, spoke)

      expect(await assets.assetId(token, 1n)).to.equal(null)
      expect(await assets.asset(assetId)).to.equal(null)
    })

    it('maps a zero result to null as well', async () => {
      const client = clientFor(({ functionName }) => {
        if (functionName === 'spokeRegistry') throw revert('spokeRegistry')
        return functionName === 'assetToId' ? 0n : [zeroAddress, 0n]
      })
      const assets = await spokeAssets(client as any, spoke)

      expect(await assets.assetId(token, 1n)).to.equal(null)
      expect(await assets.asset(assetId)).to.equal(null)
    })

    it('rethrows a revert that is not UnknownAsset', async () => {
      const client = clientFor(({ functionName }) => {
        throw revert(functionName)
      })
      const assets = await spokeAssets(client as any, spoke)

      const error = await assets.assetId(token, 1n).catch((e: Error) => e)
      expect(error).to.be.instanceOf(ContractFunctionRevertedError)
    })
  })

  describe('v3.3 spoke (lookups on its SpokeRegistry, zero for an unknown asset)', () => {
    const v33 = (known: boolean) =>
      clientFor(({ address, functionName }) => {
        if (functionName === 'spokeRegistry') {
          expect(address).to.equal(spoke)
          return registry
        }
        expect(address).to.equal(registry)
        if (functionName === 'assetToId') return known ? assetId.raw : 0n
        return known ? [token, 0n] : [zeroAddress, 0n]
      })

    it('reads a registered asset from the registry the spoke points to', async () => {
      const assets = await spokeAssets(v33(true) as any, spoke)

      expect((await assets.assetId(token, 1n))?.raw).to.equal(assetId.raw)
      expect(await assets.asset(assetId)).to.deep.equal({ address: token, tokenId: 0n })
    })

    it('maps a zero result to null', async () => {
      const assets = await spokeAssets(v33(false) as any, spoke)

      expect(await assets.assetId(token, 1n)).to.equal(null)
      expect(await assets.asset(assetId)).to.equal(null)
    })
  })

  it('propagates a transport failure instead of guessing the spoke version', async () => {
    const client = clientFor(() => {
      throw new Error('fetch failed')
    })

    const error = await spokeAssets(client as any, spoke).catch((e: Error) => e)

    expect((error as Error).message).to.equal('fetch failed')
  })
})

describe('isContractRevert', () => {
  it('recognizes a revert wrapped in a contract call error', () => {
    expect(isContractRevert(new BaseError('Contract call failed', { cause: revert('spokeRegistry') }))).to.equal(true)
  })

  it('does not classify an empty return as a revert, since it means no code at the address', () => {
    const cause = new ContractFunctionZeroDataError({ functionName: 'spokeRegistry' })
    expect(isContractRevert(new BaseError('Contract call failed', { cause }))).to.equal(false)
  })

  it('does not classify transport failures or arbitrary values as contract reverts', () => {
    expect(isContractRevert(new BaseError('fetch failed'))).to.equal(false)
    expect(isContractRevert(new Error('fetch failed'))).to.equal(false)
    expect(isContractRevert(null)).to.equal(false)
  })

  for (const code of [3, -32000]) {
    it(`uses the legacy spoke when a node reports the missing spokeRegistry() as error ${code} without data`, async () => {
      const spokeRegistrySelector = toFunctionSelector('function spokeRegistry() view returns (address)')
      const client = createPublicClient({
        transport: custom({
          request: async ({ method, params }: { method: string; params: [{ data: string }] }) => {
            if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
            if (params[0].data.startsWith(spokeRegistrySelector)) {
              throw new RpcRequestError({ body: { method }, error: { code, message: 'execution reverted' }, url: '' })
            }
            return encodeAbiParameters([{ type: 'uint128' }], [assetId.raw])
          },
        }),
      })

      const assets = await spokeAssets(client, spoke)

      expect((await assets.assetId(token, 0n))?.raw).to.equal(assetId.raw)
    })
  }

  it('propagates an empty return from spokeRegistry instead of assuming a legacy spoke', async () => {
    const client = clientFor(({ functionName }) => {
      if (functionName === 'spokeRegistry') throw new ContractFunctionZeroDataError({ functionName })
      return assetId.raw
    })
    const error = await spokeAssets(client as any, spoke).catch((e: Error) => e)
    expect(error).to.be.instanceOf(ContractFunctionZeroDataError)
  })
})
