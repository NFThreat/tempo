export const passAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'subscribe',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyId', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'unsubscribe',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activate',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'renew',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'burnExpired',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'expiresAtOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwner',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isActive',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'paymentToken', type: 'address' },
      { name: 'price', type: 'uint96' },
      { name: 'billingPeriod', type: 'uint32' },
      { name: 'gracePeriod', type: 'uint32' },
      { name: 'treasury', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'relayer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

export const factoryAbi = [
  {
    type: 'function',
    name: 'deployPass',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name_', type: 'string' },
      { name: 'symbol_', type: 'string' },
      {
        name: 'cfg',
        type: 'tuple',
        components: [
          { name: 'paymentToken', type: 'address' },
          { name: 'price', type: 'uint96' },
          { name: 'billingPeriod', type: 'uint32' },
          { name: 'gracePeriod', type: 'uint32' },
          { name: 'treasury', type: 'address' },
        ],
      },
      { name: 'relayer_', type: 'address' },
    ],
    outputs: [{ name: 'pass', type: 'address' }],
  },
  {
    type: 'function',
    name: 'passCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'passes',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'creatorOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deployFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'feeToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'PassDeployed',
    inputs: [
      { name: 'pass', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
    ],
  },
] as const

/// AccountKeychain.authorizeKey — provisions a limited access key that can
/// sign renewals on behalf of the subscriber. Selector 0x980a6025.
export const keychainAbi = [
  {
    type: 'function',
    name: 'authorizeKey',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyId', type: 'address' },
      { name: 'signatureType', type: 'uint8' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'expiry', type: 'uint64' },
          { name: 'enforceLimits', type: 'bool' },
          {
            name: 'limits',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'period', type: 'uint64' },
            ],
          },
          { name: 'allowAnyCalls', type: 'bool' },
          {
            name: 'allowedCalls',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              {
                name: 'selectorRules',
                type: 'tuple[]',
                components: [
                  { name: 'selector', type: 'bytes4' },
                  { name: 'recipients', type: 'address[]' },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeKey',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyId', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getKey',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'keyId', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'signatureType', type: 'uint8' },
          { name: 'keyId', type: 'address' },
          { name: 'expiry', type: 'uint64' },
          { name: 'enforceLimits', type: 'bool' },
          { name: 'isRevoked', type: 'bool' },
        ],
      },
    ],
  },
] as const

export const tip20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
