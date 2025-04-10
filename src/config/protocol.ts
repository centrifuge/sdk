import type { HexString } from '../types/index.js'

type ProtocolContracts = {
  root: HexString
  adminSafe: HexString
  guardian: HexString
  gasService: HexString
  gateway: HexString
  messageProcessor: HexString
  messageDispatcher: HexString
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
    root: '0xd0c02f63149f841050c17a08405c27ed77e5aeb3',
    adminSafe: '0x423420ae467df6e90291fd0252c0a8a637c1e03f',
    guardian: '0x3e2cabe1da415feab62b9a0c0c1cb88a48c63f78',
    gasService: '0x7fd598e800a68320f96865d1ac89e6e7644d4d7e',
    gateway: '0x5b918ada9c7e4af4318f5e925f3f914bfaba5934',
    messageProcessor: '0x0e2105f3f6bdd351ce8688ecc9f8fa04b475a936',
    messageDispatcher: '0xaff2dbc087bdc6ceb4e766ce9852d1d1c0524072',
    poolRegistry: '0x07f5069ceae9923bb776b920e743b6057a84c175',
    assetRegistry: '0x171b393c4fb77efd0cef445315481718929c44e7',
    accounting: '0x6547626120d2a58f15432ca3e372b76677e0ca45',
    holdings: '0x87386453cc08fe881d70e98a3b0257c3ab5a9105',
    multiShareClass: '0xffb7e12467e3294ff51b542a0ecf31531f901640',
    poolRouter: '0x848036cf64870ca9d7b513a014cbec8f3697bf0e',
    // "transientValuation": "0xdc1f030c6ccb51ee01c7c92f3093f35d691fcfce",
    // "identityValuation": "0x53c0339e6bc04625df0c74d6ee788368d42fa775",
    escrow: '0xb0c24e1a4ad9b7b790eda20fb33e78236c065fe1',
    routerEscrow: '0xe0ef81b6fc1bed10ec9da7195157dc5c0ae71847',
    restrictionManager: '0x82130de2594a80180351ec50f1a51387f0afdd33',
    restrictedRedemptions: '0x8070cf136267c667121570c78c78d5df7446ba21',
    tokenFactory: '0x7cb25681109569af3d59fe845c68779b82ab9659',
    investmentManager: '0x734bcf674c5c8aef6bdc0f30ddbd269ebc41f0a0',
    vaultFactory: '0x7191bc9347b52d2a0e42fb8cca901c67f0840249',
    poolManager: '0x761b0b580722623d8b5a1f827af193d1714139a9',
    vaultRouter: '0xfd7e9de3327efb6ea556f689b99060da0aabfdc2',
    currencies: ['0x86eb50b22dd226fe5d1f0753a40e247fd711ad6e'],
  },
}
