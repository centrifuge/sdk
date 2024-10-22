import { expect } from 'chai';
import  { Centrifuge } from '../Centrifuge.js';

describe('Centrifuge', () => {
  let centrifuge: Centrifuge

  before(async () => {
    centrifuge = new Centrifuge({
      environment: 'demo',
      rpcUrls: {
        11155111: 'https://virtual.sepolia.rpc.tenderly.co/ce7949c5-e956-4913-93bf-83b171163bdb',
      },
    });
  });
  it("should be connected to sepolia", async () => {
    const client = centrifuge.getClient();
    expect(client?.chain.id).to.equal(11155111);
    const chains = centrifuge.chains
    expect(chains).to.include(11155111);
  });
  it('should fetch account and balances', async () => {
    const account = await centrifuge.account('0x423420Ae467df6e90291fd0252c0A8a637C1e03f');
    const balances = await account.balances();
    expect(balances).to.exist;
  });
  it('should fetch a pool by id', async () => {
    const pool = await centrifuge.pool('4139607887');
    expect(pool).to.exist;
  });
});