import { expect } from 'chai';
import { ABI } from '../abi/index.js';
import { context } from '../tests/setup.js';
import { randomAddress } from '../tests/utils.js';
import { Balance } from '../utils/BigInt.js';
import { doTransaction } from '../utils/transaction.js';
import { AssetId, PoolId, ShareClassId } from '../utils/types.js';
import { OnOffRampManager } from './OnOffRampManager.js';
import { Pool } from './Pool.js';
import { PoolNetwork } from './PoolNetwork.js';
import { ShareClass } from './ShareClass.js';
const chainId = 11155111;
const centId = 1;
const poolId = PoolId.from(centId, 1);
const scId = ShareClassId.from(poolId, 1);
const assetId = AssetId.from(centId, 1);
const rampManager = '0x8c0E6DC2461c6190A3e5703B714942cacfCb3C14';
const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f';
const receiver = '0x0000000000000000000000000000a3df6c4f8fcf';
describe('OnOffRampManager', () => {
    let pool;
    let poolNetwork;
    let shareClass;
    let onOffRampManager;
    before(async () => {
        const { centrifuge } = context;
        pool = new Pool(centrifuge, poolId.raw, chainId);
        poolNetwork = new PoolNetwork(centrifuge, pool, 11155111);
        shareClass = new ShareClass(centrifuge, pool, scId.raw);
        context.tenderlyFork.impersonateAddress = fundManager;
        context.centrifuge.setSigner(context.tenderlyFork.signer);
        onOffRampManager = new OnOffRampManager(context.centrifuge, poolNetwork, shareClass, rampManager);
    });
    describe('receivers', () => {
        it('should set receiver', async () => {
            const address = randomAddress();
            const result = await onOffRampManager.setReceiver(assetId, address);
            expect(result.type).to.equal('TransactionConfirmed');
            const setReceiver = await context.centrifuge.getClient(chainId).readContract({
                address: rampManager,
                abi: ABI.OnOffRampManager,
                functionName: 'offramp',
                args: ['0x3aaaa86458d576bafcb1b7ed290434f0696da65c', address],
            });
            expect(setReceiver).to.be.true;
        });
        it.skip('should disable receiver', async () => {
            const address = randomAddress();
            await onOffRampManager.setReceiver(assetId, address);
            const result = await onOffRampManager.setReceiver(assetId, address, false);
            expect(result.type).to.equal('TransactionConfirmed');
            const disabledReceiver = await context.centrifuge.getClient(chainId).readContract({
                address: rampManager,
                abi: ABI.OnOffRampManager,
                functionName: 'offramp',
                args: ['0x3aaaa86458d576bafcb1b7ed290434f0696da65c', address],
            });
            expect(disabledReceiver).to.be.false;
        });
    });
    describe('relayers', () => {
        it.skip('should return relayers', async () => {
            const relayers = await onOffRampManager.relayers();
            expect(relayers.length).to.equal(4);
            expect(relayers[0].address).to.equal('0x000000000000000000000000000ffc2d83c1400c');
        });
        it.skip('should set relayer', async () => {
            const address = randomAddress();
            const result = await onOffRampManager.setRelayer(address);
            expect(result.type).to.equal('TransactionConfirmed');
            const setRelayer = await context.centrifuge.getClient(chainId).readContract({
                address: rampManager,
                abi: ABI.OnOffRampManager,
                functionName: 'onramp',
                args: ['0x3aaaa86458d576bafcb1b7ed290434f0696da65c'],
            });
            expect(setRelayer).to.be.true;
        });
        it.skip('should disable relayer', async () => {
            const address = randomAddress();
            await onOffRampManager.setRelayer(address);
            const result = await onOffRampManager.setRelayer(address, false);
            expect(result.type).to.equal('TransactionConfirmed');
        });
    });
    describe('assets', () => {
        it('should return assets', async () => {
            const result = await onOffRampManager.assets();
            expect(result.length).to.be.equal(2);
            expect(result[0]).to.deep.equal({
                assetAddress: '0x3aaaa86458d576bafcb1b7ed290434f0696da65c',
                assetId: new AssetId('0x3aaaa86458d576bafcb1b7ed290434f0696da65c'),
            });
        });
        it('should set asset', async () => {
            const result = await onOffRampManager.setAsset(assetId);
            expect(result.type).to.equal('TransactionConfirmed');
        });
    });
    describe('balances', () => {
        it.skip('should return balances per asset', async () => {
            const result = await onOffRampManager.balances();
            console.log({ result });
            // TODO: assert once the data is available, with balance greater than 0
            // Currently it returns only one balance with 0 value, which gets filtered out
            // balance: Balance { value: 0n, decimals: 6 },
            // currency: {
            // address: '0x3aaaa86458d576bafcb1b7ed290434f0696da65c',
            // tokenId: 0n,
            // decimals: 6,
            // name: 'USD Coin',
            // symbol: 'USDC',
            // chainId: 11155111,
            // supportsPermit: true
            // }
        });
    });
    describe('deposit and withdraw', () => {
        it.skip('should deposit', async () => {
            const assetAddress = '0x3aaaa86458d576bafcb1b7ed290434f0696da65c';
            const allowance = new Balance(100n, 6);
            const amount = new Balance(56n, 6);
            await pool.updateBalanceSheetManagers([{ chainId, address: onOffRampManager.onrampAddress, canManage: true }]);
            await context.centrifuge._transact(async function* (ctx) {
                yield* doTransaction('Approve transfer', ctx, async () => {
                    return ctx.walletClient.writeContract({
                        address: assetAddress,
                        abi: ABI.Currency,
                        functionName: 'transfer',
                        args: [onOffRampManager.onrampAddress, allowance.toBigInt()],
                    });
                });
            }, chainId);
            const result = await onOffRampManager.deposit(assetAddress, amount, receiver);
            expect(result.type).to.equal('TransactionConfirmed');
            const balance = await context.centrifuge.getClient(chainId).readContract({
                address: assetAddress,
                abi: ABI.Currency,
                functionName: 'balanceOf',
                args: [onOffRampManager.onrampAddress],
            });
            expect(balance).to.equal(allowance.sub(amount).toBigInt());
        });
        it.skip('should withdraw', async () => {
            const assetAddress = '0x3aaaa86458d576bafcb1b7ed290434f0696da65c';
            const allowance = new Balance(100n, 6);
            const amount = new Balance(56n, 6);
            const relayer = randomAddress();
            await context.centrifuge._transact(async function* (ctx) {
                yield* doTransaction('Approve transfer', ctx, async () => {
                    return ctx.walletClient.writeContract({
                        address: assetAddress,
                        abi: ABI.Currency,
                        functionName: 'transfer',
                        args: [onOffRampManager.onrampAddress, allowance.toBigInt()],
                    });
                });
            }, chainId);
            await context.tenderlyFork.fundAccountEth(relayer, 10n ** 18n);
            await pool.updateBalanceSheetManagers([{ chainId, address: onOffRampManager.onrampAddress, canManage: true }]);
            await onOffRampManager.setReceiver(assetId, receiver);
            await onOffRampManager.setRelayer(relayer);
            context.tenderlyFork.impersonateAddress = relayer;
            context.centrifuge.setSigner(context.tenderlyFork.signer);
            const receiverBalanceBefore = await context.centrifuge.getClient(chainId).readContract({
                address: assetAddress,
                abi: ABI.Currency,
                functionName: 'balanceOf',
                args: [receiver],
            });
            expect(receiverBalanceBefore).to.equal(1000000000n);
            const result = await onOffRampManager.withdraw(assetAddress, amount, receiver);
            expect(result.type).to.equal('TransactionConfirmed');
            const receiverBalanceAfter = await context.centrifuge.getClient(chainId).readContract({
                address: assetAddress,
                abi: ABI.Currency,
                functionName: 'balanceOf',
                args: [receiver],
            });
            expect(receiverBalanceAfter).to.equal(1000000056n);
        });
    });
});
//# sourceMappingURL=OnOffRampManager.test.js.map