import { hexToNumber, maxUint256, slice } from 'viem';
import { ABI } from '../abi/index.js';
export async function signPermit(ctx, currencyAddress, spender, amount) {
    let domainOrCurrency = currencyAddress;
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    if (currencyAddress.toLowerCase() === USDC) {
        // USDC has a custom version
        domainOrCurrency = { name: 'USD Coin', version: '2', chainId: ctx.chainId, verifyingContract: currencyAddress };
    }
    else if (ctx.root.getChainConfig(ctx.chainId).testnet) {
        // Assume that the currencies used on testnets have our custom domain
        domainOrCurrency = { name: 'Centrifuge', version: '1', chainId: ctx.chainId, verifyingContract: currencyAddress };
    }
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const permit = await signERC2612Permit(ctx, domainOrCurrency, spender, amount, deadline);
    return permit;
}
export async function signERC2612Permit(ctx, currencyOrDomain, spender, value, deadline, nonce) {
    const types = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };
    const domainData = typeof currencyOrDomain === 'string'
        ? {
            name: await getName(ctx.publicClient, currencyOrDomain),
            version: '1',
            chainId: ctx.chainId,
            verifyingContract: currencyOrDomain,
        }
        : currencyOrDomain;
    const owner = ctx.signingAddress;
    const message = {
        owner,
        spender,
        value: value ? BigInt(value) : maxUint256,
        nonce: nonce ?? (await getNonce(ctx.publicClient, domainData.verifyingContract, owner)),
        deadline: deadline ? BigInt(deadline) : maxUint256,
    };
    const signature = await ctx.walletClient.signTypedData({
        message,
        domain: domainData,
        primaryType: 'Permit',
        types,
    });
    return {
        ...splitSignature(signature),
        deadline: message.deadline,
    };
}
function splitSignature(signature) {
    const r = slice(signature, 0, 32);
    const s = slice(signature, 32, 64);
    const v = hexToNumber(slice(signature, 64, 65));
    return {
        r,
        s,
        v: v < 27 ? v + 27 : v,
    };
}
async function getName(publicClient, contractAddress) {
    const name = await publicClient.readContract({
        address: contractAddress,
        abi: ABI.Currency,
        functionName: 'name',
    });
    return name;
}
async function getNonce(publicClient, contractAddress, ownerAddress) {
    const nonce = await publicClient.readContract({
        address: contractAddress,
        abi: ABI.Currency,
        functionName: 'nonces',
        args: [ownerAddress],
    });
    return nonce;
}
//# sourceMappingURL=permit.js.map