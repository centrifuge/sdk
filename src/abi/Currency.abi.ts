export default [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function PERMIT_TYPEHASH() view returns (bytes32)',
  'function approve(address, uint) external returns (bool)',
  'function transfer(address, uint) external returns (bool)',
  'function balanceOf(address) view returns (uint)',
  'function allowance(address, address) view returns (uint)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function checkTransferRestriction(address, address, uint) view returns (bool)',
  'function hook() view returns (address)',
] as const
