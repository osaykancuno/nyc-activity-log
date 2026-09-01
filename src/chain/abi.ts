/** Only what the club actually publishes. Nothing invented. */
export const nycAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'claimed', stateMutability: 'view', inputs: [{ name: 'yachtId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalMinted', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  {
    type: 'event', name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;

export const erc721EnumerableAbi = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

/**
 * Seaport OrderFulfilled — same signature across Seaport 1.1 .. 1.6, so viem
 * derives the topic itself and we never hardcode a hash that could drift.
 */
export const seaportAbi = [
  {
    type: 'event', name: 'OrderFulfilled',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'offerer', type: 'address', indexed: true },
      { name: 'zone', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: false },
      {
        name: 'offer', type: 'tuple[]', indexed: false,
        components: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifier', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      {
        name: 'consideration', type: 'tuple[]', indexed: false,
        components: [
          { name: 'itemType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'identifier', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ],
      },
    ],
  },
] as const;

/** Blur v2 packed executions. price = (collectionPriceSide >> 8) & (2^88-1). */
export const blurAbi = [
  {
    type: 'event', name: 'Execution721Packed',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'tokenIdListingIndexTrader', type: 'uint256', indexed: false },
      { name: 'collectionPriceSide', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Execution721TakerFeePacked',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'tokenIdListingIndexTrader', type: 'uint256', indexed: false },
      { name: 'collectionPriceSide', type: 'uint256', indexed: false },
      { name: 'takerFeeRecipientRate', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Execution721MakerFeePacked',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: false },
      { name: 'tokenIdListingIndexTrader', type: 'uint256', indexed: false },
      { name: 'collectionPriceSide', type: 'uint256', indexed: false },
      { name: 'makerFeeRecipientRate', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const SEAPORT_ITEM = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 } as const;
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
