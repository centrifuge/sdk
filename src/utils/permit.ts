import type { PublicClient, TypedDataDomain } from 'viem'
import { hexToNumber, maxUint256, slice } from 'viem'
import { ABI } from '../abi/index.js'
import { HexString } from '../types/index.js'
import { TransactionContext } from '../types/transaction.js'

export type Permit = {
  r: HexString
  s: HexString
  v: number
  deadline: bigint
}

export type Domain = Required<Pick<TypedDataDomain, 'name' | 'version' | 'chainId' | 'verifyingContract'>>

export async function signPermit(
  ctx: TransactionContext,
  currencyAddress: HexString,
  spender: HexString,
  amount: bigint
) {
  const chainId = await ctx.root._idToChain(ctx.centrifugeId)
  const domain = await resolvePermitDomain(ctx, currencyAddress, chainId)

  const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour
  const permit = await signERC2612Permit(ctx, chainId, domain, spender, amount, deadline)
  return permit
}

async function resolvePermitDomain(
  ctx: TransactionContext,
  currencyAddress: HexString,
  chainId: number
): Promise<Domain> {
  // Prefer EIP-5267 eip712Domain() — authoritative when the token implements it (e.g. Circle's FiatTokenV2).
  try {
    const result = await ctx.publicClient.readContract({
      address: currencyAddress,
      abi: ABI.Currency,
      functionName: 'eip712Domain',
    })

    const name = result[1]
    const version = result[2]
    const verifyingContract = result[4]

    if (name && version) {
      return { name, version, chainId, verifyingContract: verifyingContract ?? currencyAddress }
    }
  } catch {}

  // Fallback for tokens that don't implement eip712Domain(). Centrifuge's own ERC20
  // (used for testnet mock currencies) hardcodes the domain to name="Centrifuge", version="1"
  // and doesn't expose version() or eip712Domain(), so we apply that domain on testnets.
  const chainConfig = await ctx.root.getChainConfig(ctx.centrifugeId)
  if (chainConfig.testnet) {
    return { name: 'Centrifuge', version: '1', chainId, verifyingContract: currencyAddress }
  }

  // Mainnet fallback: read name() and version() individually; default version to '1'.
  const [name, version] = await Promise.all([
    getName(ctx.publicClient, currencyAddress),
    ctx.publicClient
      .readContract({ address: currencyAddress, abi: ABI.Currency, functionName: 'version' })
      .catch(() => '1'),
  ])
  return { name, version, chainId, verifyingContract: currencyAddress }
}

export async function signERC2612Permit(
  ctx: TransactionContext,
  chainId: number,
  currencyOrDomain: HexString | Domain,
  spender: HexString,
  value?: string | number | bigint,
  deadline?: number,
  nonce?: number
): Promise<Permit> {
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  }
  const domainData =
    typeof currencyOrDomain === 'string'
      ? {
          name: await getName(ctx.publicClient, currencyOrDomain),
          version: '1',
          chainId,
          verifyingContract: currencyOrDomain,
        }
      : currencyOrDomain
  const owner = ctx.signingAddress
  const message = {
    owner,
    spender,
    value: value ? BigInt(value) : maxUint256,
    nonce: nonce ?? (await getNonce(ctx.publicClient, domainData.verifyingContract as HexString, owner)),
    deadline: deadline ? BigInt(deadline) : maxUint256,
  }

  const signature = await ctx.walletClient.signTypedData({
    message,
    domain: domainData,
    primaryType: 'Permit',
    types,
  })
  return {
    ...splitSignature(signature),
    deadline: message.deadline,
  }
}

function splitSignature(signature: HexString): Omit<Permit, 'deadline'> {
  const r = slice(signature, 0, 32)
  const s = slice(signature, 32, 64)
  const v = hexToNumber(slice(signature, 64, 65))
  return {
    r,
    s,
    v: v < 27 ? v + 27 : v,
  }
}

async function getName(publicClient: PublicClient, contractAddress: HexString) {
  const name = await publicClient.readContract({
    address: contractAddress,
    abi: ABI.Currency,
    functionName: 'name',
  })
  return name
}

async function getNonce(publicClient: PublicClient, contractAddress: HexString, ownerAddress: HexString) {
  const nonce = await publicClient.readContract({
    address: contractAddress,
    abi: ABI.Currency,
    functionName: 'nonces',
    args: [ownerAddress],
  })
  return nonce
}
