import type { HexString } from '../types/index.js'

type ProtocolContracts = {
  root: HexString
  adminSafe: HexString
  guardian: HexString
  gasService: HexString
  gateway: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
  hubRegistry: HexString
  accounting: HexString
  holdings: HexString
  shareClassManager: HexString
  hub: HexString
  transientValuation: HexString
  identityValuation: HexString
  escrow: HexString
  routerEscrow: HexString
  restrictedTransfers: HexString
  freelyTransferable: HexString
  tokenFactory: HexString
  asyncRequests: HexString
  syncRequests: HexString
  asyncVaultFactory: HexString
  syncDepositVaultFactory: HexString
  poolManager: HexString
  vaultRouter: HexString
  currencies: HexString[]
}

export const protocol: Record<number, ProtocolContracts> = {
  // Testnets
  11155111: {
    root: '0xAEB0B9253fbB32ED05D442A3185eAB36DFCb65dF',
    adminSafe: '0x423420Ae467df6e90291fd0252c0A8a637C1e03f',
    guardian: '0xC2033C918F144B265f09B5df51970dbbE5e48586',
    gasService: '0x901eb3C1bb122C3E44C87597b8A73385e2b0986a',
    gateway: '0x51A64b58146EA16D018d5A0e1ab50ebbD26F96Df',
    messageProcessor: '0x7efC916c8846d737B41ff0c79f3F8363Ee259d83',
    messageDispatcher: '0x184Eab90E834498eDC6eb9A36252d34dd0c6E78b',
    hubRegistry: '0xd1cA2b37035a4a7B6a9E368DE8CBceF397B2286F',
    accounting: '0xeF81165C24d8B13D4f5fdF71477004E55ade4a89',
    holdings: '0x03Ba7E47DC513c0400CBD0B409C10ce15C52d14E',
    shareClassManager: '0x3e46A1b97BFDf9Fae01A5648aA343aE21C1b6eA5',
    hub: '0x49aB14c8bb5870F892a21acd298174dB1415da17',
    transientValuation: '0x621dB2787d37E99c68B58592099122D658b063c3',
    identityValuation: '0x41322ec0ce3Dd1ec9Cd4775a48019b0005787289',
    escrow: '0x1AeCd1eAb4a56D1Ee0b39c5B356E6981d50d63c0',
    routerEscrow: '0x71E57350808448959bCc15B17d47d95946B9FDDB',
    restrictedTransfers: '0x422bC96eBAac761Af8c546ba9bA9620a166b2b42',
    freelyTransferable: '0x5e75A6F5E3d332239e86fb6728320161EB7E3fA1',
    tokenFactory: '0x4056e5D9F767b8F4ce350787A777122c940bfa64',
    asyncRequests: '0x7ef3F52b8079230cCf2003e7F268261ed15CB38e',
    syncRequests: '0xa44A36F313eB14D4AbF48Cdf85d0b1d9cA93005B',
    asyncVaultFactory: '0x5816342Bb6306DC4b92b55A8ec82A2CA66E5615A',
    syncDepositVaultFactory: '0x3A01e497647CcFe920eC405C3d52170a603873d3',
    poolManager: '0x163215d4A8e4BBad9a25c647B38F913635fE1BF6',
    vaultRouter: '0x7035875A7BDfEA7a735f7F1379E5897E316CE7De',
    currencies: ['0xd54864475D5b1a0F235A751b6fddc8bb28FD3b9b'],
  },
}
