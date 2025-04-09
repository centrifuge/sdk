import { expect } from 'chai';
import { Centrifuge } from '../Centrifuge.js';

describe('Centrifuge contracts', () => {
  it('should fetch the contract addresses when the environment is demo', async () => {
    const centrifuge = new Centrifuge({ environment: 'demo' });
    const addresses = await centrifuge.contracts();

    const expectedKeys = [
      'root',
      'adminSafe',
      'guardian',
      'gasService',
      'gateway',
      'messageProcessor',
      'messageDispatcher',
      'poolRegistry',
      'assetRegistry',
      'accounting',
      'holdings',
      'multiShareClass',
      'poolRouter',
      'transientValuation',
      'identityValuation',
      'escrow',
      'routerEscrow',
      'restrictionManager',
      'restrictedRedemptions',
      'tokenFactory',
      'investmentManager',
      'vaultFactory',
      'poolManager',
      'vaultRouter'
    ];

    expect(addresses).to.be.an('object');

    expectedKeys.forEach((key) => {
      expect(addresses).to.have.property(key);
      expect(addresses[key as keyof typeof addresses]).to.be.a('string');
    });
  });
});
