type LPConfig = {
  centrifugeRouter: `0x${string}`
  router: `0x${string}`
}
export const lpConfig: Record<number, LPConfig> = {
  // Testnet
  11155111: {
    centrifugeRouter: '0x723635430aa191ef5f6f856415f41b1a4d81dd7a',
    router: '0x130ce3f3c17b4458d6d4dfdf58a86aa2d261662e',
  },
  84532: {
    centrifugeRouter: '0x723635430aa191ef5f6f856415f41b1a4d81dd7a',
    router: '0xec55db8b44088198a2d72da798535bffb64fba5c',
  },
  // Mainnet
  1: {
    centrifugeRouter: '0x2F445BA946044C5F508a63eEaF7EAb673c69a1F4',
    router: '0x85bafcadea202258e3512ffbc3e2c9ee6ad56365',
  },
  42161: {
    centrifugeRouter: '0x2F445BA946044C5F508a63eEaF7EAb673c69a1F4',
    router: '0x85bafcadea202258e3512ffbc3e2c9ee6ad56365',
  },
  8453: {
    centrifugeRouter: '0xF35501E7fC4a076E744dbAFA883CED74CCF5009d',
    router: '0x30e34260b895cae34a1cfb185271628c53311cf3',
  },
  42220: {
    centrifugeRouter: '0x5a00C4fF931f37202aD4Be1FDB297E9EDc1CBb33',
    router: '0xe4e34083a49df72e634121f32583c9ea59191cca',
  },
}
