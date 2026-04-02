// BoostVault 合约 ABI 和常量
// BSC Testnet 部署

export const BOOST_VAULT_ADDRESS =
  '0xF2BA52342b2982d11F6F4c646c5aCeB5073813c9' as const;

export const USDC_ADDRESS =
  '0x64544969ed7EBf5f083679233325356EbE738930' as const;

export const NATIVE_TOKEN_ADDRESS =
  '0x0000000000000000000000000000000000000000' as const;

export const BSC_TESTNET_CHAIN_ID = 97;

export const BOOST_VAULT_ABI = [
  {
    name: 'createBoost',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'boostId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

// backward compatibility alias
export const boostVaultAbi = BOOST_VAULT_ABI;

export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
