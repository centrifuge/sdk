## Testing with Mocha and Tenderly

Tenderly allows us to create a local Ethereum network that is compatible with Ethereum Mainnet that we can use to run our tests against. A new fork will be created for each test suite.

### Local setup

1. Visit [Tenderly](https://dashboard.tenderly.co/) and create an account if you don't have one.

2. Create a new project.

3. Settings is where you will find the values for the environment variables `TENDERLY_ACCESS_KEY` and `TENDERLY_ACCOUNT_SLUG` and `TENDERLY_PROJECT_SLUG`

4. Copy `env.example` file to `.env` and add the values you found in the previous step.

Install dependencies:

```bash
yarn
```

Run the tests:

```bash
yarn test
```

Run a single test:

```bash
yarn test:single <path-to-test>
```

Run a single test without setting up the fork:

```bash
yarn test:simple:single <path-to-test>
```

### Usage

```ts
// create a new fork
const tenderlyFork = await TenderlyFork.create(sepolia)

// or use an existing fork
const tenderlyFork = new TenderlyFork(sepolia, '<vnet-id>')

// connect to centrifuge
const centrifuge = new Centrifuge({
  environment: 'testnet',
  rpcUrls: {
    11155111: tenderlyFork.rpcUrl,
  },
})

// set the tenderly signer as the signer for centrifuge
centrifuge.setSigner(tenderlyFork.signer)

// fund the signer's account on the fork
await tenderlyFork.fundAccountEth(tenderlyFork.account.address, parseEther('100'))

// fund the signer's account with USDt ERC20 tokens
await tenderlyFork.fundAccountERC20(tenderlyFork.account.address, parseEther('100'))

// impersonate an address to send a transaction from that address
tenderlyFork.impersonateAddress = '0x...'
centrifuge.setSigner(tenderlyFork.signer) // setSigner must be called (again) after impersonateAddress is set
```
