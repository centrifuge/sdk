import { describe, it } from 'mocha';
import { expect } from 'chai';
import { getSolanaPoolAddress, getUsdcMintAddress, hasSolanaPoolAddress } from './poolAddresses.js';
describe('Solana Environment Configuration', () => {
    describe('Environment Types', () => {
        it('should accept mainnet environment', () => {
            const usdcAddress = getUsdcMintAddress('mainnet');
            expect(usdcAddress).to.equal('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        });
        it('should accept testnet environment', () => {
            const usdcAddress = getUsdcMintAddress('testnet');
            expect(usdcAddress).to.equal('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
        });
        it('should accept devnet environment', () => {
            const usdcAddress = getUsdcMintAddress('devnet');
            expect(usdcAddress).to.equal('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
        });
        it('should have same USDC address for testnet and devnet', () => {
            const testnetAddress = getUsdcMintAddress('testnet');
            const devnetAddress = getUsdcMintAddress('devnet');
            expect(testnetAddress).to.equal(devnetAddress);
        });
    });
    describe('Pool Address Mapping', () => {
        const testShareClassId = '0x00010000000000060000000000000001';
        it('should find pool config for devnet environment', () => {
            const config = getSolanaPoolAddress(testShareClassId, 'devnet');
            expect(config).to.not.be.undefined;
            expect(config?.environment).to.equal('devnet');
            expect(config?.address).to.equal('BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN');
        });
        it('should not find pool config for mainnet environment (not configured yet)', () => {
            const config = getSolanaPoolAddress(testShareClassId, 'mainnet');
            expect(config).to.be.undefined;
        });
        it('should not find pool config for testnet environment', () => {
            // The pool is configured for devnet, not testnet
            const config = getSolanaPoolAddress(testShareClassId, 'testnet');
            expect(config).to.be.undefined;
        });
        it('should correctly check if pool has Solana address', () => {
            expect(hasSolanaPoolAddress(testShareClassId, 'devnet')).to.be.true;
            expect(hasSolanaPoolAddress(testShareClassId, 'mainnet')).to.be.false;
            expect(hasSolanaPoolAddress(testShareClassId, 'testnet')).to.be.false;
        });
    });
});
//# sourceMappingURL=environment.test.js.map