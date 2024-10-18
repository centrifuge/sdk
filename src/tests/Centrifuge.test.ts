import { expect } from 'chai';
import { Centrifuge } from '../Centrifuge.js';

describe('Centrifuge', () => {
  it('should be able to fetch account and balances', async () => {
    const centrifuge = new Centrifuge({
      environment: 'mainnet',
      rpcUrl: 'https://virtual.mainnet.rpc.tenderly.co/43639f5a-b12a-489b-aa15-45aba1d060c4',
    });
    const account = await centrifuge.account('0x423420Ae467df6e90291fd0252c0A8a637C1e03f');
    const balances = await account.balances();
    console.log('balances', balances);
    expect(balances).to.exist;
  });
});