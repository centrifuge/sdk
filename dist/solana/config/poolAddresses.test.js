import { describe, it } from 'mocha';
import { expect } from 'chai';
import { getSolanaPoolConfig, getUsdcMintAddress, hasSolanaPoolAddress } from './poolAddresses.js';
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
            const config = getSolanaPoolConfig(testShareClassId, 'devnet');
            expect(config).to.not.be.undefined;
            expect(config?.environment).to.include('devnet');
            expect(config?.solanaAddress.devnet).to.equal('BdvsupcBZ3odJvWvLKZPGTQwPjpShuWVpmnTq3gfdCbN');
            expect(config?.poolName).to.equal('AAA_CLO');
            expect(config?.poolId).to.equal(281474976710662);
        });
        it('should find pool config for mainnet environment', () => {
            const config = getSolanaPoolConfig(testShareClassId, 'mainnet');
            expect(config).to.not.be.undefined;
            expect(config?.environment).to.include('mainnet');
            expect(config?.solanaAddress.mainnet).to.equal('');
        });
        it('should not find pool config for testnet environment', () => {
            // The pool is configured for mainnet and devnet, not testnet
            const config = getSolanaPoolConfig(testShareClassId, 'testnet');
            expect(config).to.be.undefined;
        });
        it('should correctly check if pool has Solana address', () => {
            expect(hasSolanaPoolAddress(testShareClassId, 'devnet')).to.be.true;
            expect(hasSolanaPoolAddress(testShareClassId, 'mainnet')).to.be.true;
            expect(hasSolanaPoolAddress(testShareClassId, 'testnet')).to.be.false;
        });
        it('should have correct structure for pool config', () => {
            const config = getSolanaPoolConfig(testShareClassId, 'devnet');
            expect(config).to.have.property('poolId');
            expect(config).to.have.property('poolName');
            expect(config).to.have.property('environment');
            expect(config).to.have.property('solanaAddress');
            expect(config?.solanaAddress).to.have.property('mainnet');
            expect(config?.solanaAddress).to.have.property('testnet');
            expect(config?.solanaAddress).to.have.property('devnet');
        });
    });
});
//# sourceMappingURL=poolAddresses.test.js.map