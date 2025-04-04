import type { HexString } from '../types/index.js'

type ProtocolContracts = {
  root: HexString
  adminSafe: HexString
  guardian: HexString
  gasService: HexString
  gateway: HexString
  messageProcessor: HexString
  poolRegistry: HexString
  assetRegistry: HexString
  accounting: HexString
  holdings: HexString
  multiShareClass: HexString
  poolRouter: HexString
  // transientValuation: HexString
  // identityValuation: HexString
  escrow: HexString
  routerEscrow: HexString
  restrictionManager: HexString
  restrictedRedemptions: HexString
  tokenFactory: HexString
  investmentManager: HexString
  vaultFactory: HexString
  poolManager: HexString
  vaultRouter: HexString
  currencies: HexString[]
}

export const protocol: Record<number, ProtocolContracts> = {
  // Testnets
  11155111: {
    root: '0xe4a2d9e0f31a86cb761da06e79f85da3d7acdcb7',
    adminSafe: '0x423420ae467df6e90291fd0252c0a8a637c1e03f',
    guardian: '0xed5726ff0179dc76175c67e874d96a82527a45af',
    gasService: '0xdb592ca48a05cd02759054f0430b59fc7954d792',
    gateway: '0x61d72dcefc3d47b58d76e5884873580f709b09e8',
    messageProcessor: '0x2fcf6b48f8b84e54a8914f913cbd1bbfb1c90741',
    poolRegistry: '0xbb020baa0d0e49bef14091ae7ac0186f578e21fc',
    assetRegistry: '0x92f72b35bd5447b0c51fae4f93e72154f5320fb6',
    accounting: '0x20e57ec087ed799012e22bccc654ca430cdfb3e8',
    holdings: '0x719c0c4364f1d62792bcfb3b91f08f1b87a3acc9',
    multiShareClass: '0x951d0b299ded4b7fd3511b2889578b28512047b7',
    poolRouter: '0xeaae46ca81b30be6ad52c6b745fea61a0b562041',
    // transientValuation: '0xeaa17558ee9f3751a1b9417608db209c114a9082',
    // identityValuation: '0x25ad36548d31d40887f1b74f674d46b33b53a9fb',
    escrow: '0xe0cf46e73c54b560c86d1dd042f876c602996423',
    routerEscrow: '0xfb476d1f9eb2f7142d466676940c886ea433e15f',
    restrictionManager: '0x63708a049c32f3fa106f527f2c260da95ef2dce1',
    restrictedRedemptions: '0x9bfb806be142a8a7f5127b6aa32d1dae0e126db7',
    tokenFactory: '0xbd6b45641a902208b1b7ffb7382b7523d2df18f5',
    investmentManager: '0x90a510b7fdbed2dc803ff454b1d374000d451463',
    vaultFactory: '0x21836774f6a91089eaeaba9e2158bbde69903e4f',
    poolManager: '0x8d7c151b2700da7bce648e1bf9a3b6eb551b32c2',
    vaultRouter: '0x70b8de3d826bb07c0e219e6a51582e6274ce0b2e',
    currencies: ['0x86eb50b22dd226fe5d1f0753a40e247fd711ad6e'],
  },
}
