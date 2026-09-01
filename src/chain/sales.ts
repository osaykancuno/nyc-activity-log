import { parseEventLogs, type TransactionReceipt } from 'viem';
import { blurAbi, seaportAbi, SEAPORT_ITEM, WETH } from './abi';
import { NYC } from './client';
import { log } from '../logger';

const l = log('sales');

export type PriceSource = 'seaport' | 'blur' | 'blur-total' | 'tx-value' | 'none';

export type Currency = 'ETH' | 'WETH';

export interface PriceInfo {
  /** wei, per tokenId. Absent tokenId = we could not prove a price for it. */
  byToken: Map<bigint, bigint>;
  total: bigint;
  source: PriceSource;
  marketplace: string;
  currency: Currency;
}

const EMPTY: PriceInfo = { byToken: new Map(), total: 0n, source: 'none', marketplace: '', currency: 'ETH' };

const isPayment = (itemType: number, token: string) =>
  itemType === SEAPORT_ITEM.NATIVE || (itemType === SEAPORT_ITEM.ERC20 && token.toLowerCase() === WETH);

const isOurNft = (itemType: number, token: string) =>
  (itemType === SEAPORT_ITEM.ERC721 || itemType === SEAPORT_ITEM.ERC1155) && token.toLowerCase() === NYC.toLowerCase();

/**
 * What was actually paid, proven from the receipt.
 *
 * Layered on purpose, most precise first. If no layer can prove a number for a
 * hull, that hull gets no price — and the editorial rule then says: do not post
 * it as a sale. A wrong number is worse than a missing post.
 */
export function priceFromReceipt(receipt: TransactionReceipt, txValue: bigint, tokenIds: bigint[]): PriceInfo {
  const seaport = fromSeaport(receipt);
  if (seaport.byToken.size > 0) return seaport;

  const blur = fromBlur(receipt, tokenIds);
  if (blur.byToken.size > 0) return blur;

  // Last resort: a plain purchase where the buyer sent ETH with the call.
  if (txValue > 0n && tokenIds.length > 0) {
    const per = txValue / BigInt(tokenIds.length);
    const byToken = new Map<bigint, bigint>();
    for (const id of tokenIds) byToken.set(id, per);
    return { byToken, total: txValue, source: 'tx-value', marketplace: 'direct', currency: 'ETH' };
  }

  return EMPTY;
}

function fromSeaport(receipt: TransactionReceipt): PriceInfo {
  let logs;
  try {
    logs = parseEventLogs({ abi: seaportAbi, logs: receipt.logs, eventName: 'OrderFulfilled' });
  } catch (e) {
    l.debug('seaport decode failed', e);
    return EMPTY;
  }
  const byToken = new Map<bigint, bigint>();
  let total = 0n;
  let sawWeth = false;
  let sawNative = false;

  for (const ev of logs) {
    const offer = ev.args.offer as readonly { itemType: number; token: string; identifier: bigint; amount: bigint }[];
    const consideration = ev.args.consideration as readonly { itemType: number; token: string; identifier: bigint; amount: bigint; recipient: string }[];

    const nftInOffer = offer.filter((o) => isOurNft(o.itemType, o.token));
    const nftInConsideration = consideration.filter((c) => isOurNft(c.itemType, c.token));

    // Listing taken: seller offers the hull, is paid in the consideration.
    if (nftInOffer.length > 0) {
      const items = consideration.filter((c) => isPayment(c.itemType, c.token));
      for (const it of items) it.itemType === SEAPORT_ITEM.NATIVE ? (sawNative = true) : (sawWeth = true);
      const paid = items.reduce((s, c) => s + c.amount, 0n);
      if (paid === 0n) continue;
      const per = paid / BigInt(nftInOffer.length);
      for (const n of nftInOffer) { byToken.set(n.identifier, (byToken.get(n.identifier) ?? 0n) + per); total += per; }
      continue;
    }
    // Bid accepted: the hull sits in the consideration, payment is in the offer.
    if (nftInConsideration.length > 0) {
      const items = offer.filter((o) => isPayment(o.itemType, o.token));
      for (const it of items) it.itemType === SEAPORT_ITEM.NATIVE ? (sawNative = true) : (sawWeth = true);
      const paid = items.reduce((s, o) => s + o.amount, 0n);
      if (paid === 0n) continue;
      const per = paid / BigInt(nftInConsideration.length);
      for (const n of nftInConsideration) { byToken.set(n.identifier, (byToken.get(n.identifier) ?? 0n) + per); total += per; }
    }
  }

  if (!byToken.size) return EMPTY;
  const currency: Currency = sawWeth && !sawNative ? 'WETH' : 'ETH';
  return { byToken, total, source: 'seaport', marketplace: 'Seaport', currency };
}

const MASK_88 = (1n << 88n) - 1n;

function fromBlur(receipt: TransactionReceipt, tokenIds: bigint[]): PriceInfo {
  let logs;
  try {
    logs = parseEventLogs({ abi: blurAbi, logs: receipt.logs });
  } catch (e) {
    l.debug('blur decode failed', e);
    return EMPTY;
  }
  // Keep only executions whose packed collection is this contract.
  const ours: bigint[] = [];
  for (const ev of logs) {
    const packed = ev.args.collectionPriceSide as bigint;
    const collection = `0x${(packed >> 96n).toString(16).padStart(40, '0')}`.toLowerCase();
    if (collection !== NYC.toLowerCase()) continue;
    ours.push((packed >> 8n) & MASK_88);
  }
  if (ours.length === 0) return EMPTY;

  const byToken = new Map<bigint, bigint>();
  let total = 0n;

  if (ours.length === tokenIds.length) {
    // Unambiguous: one execution per hull, in log order.
    tokenIds.forEach((id, i) => { byToken.set(id, ours[i]); total += ours[i]; });
  } else if (tokenIds.length === 1) {
    total = ours.reduce((s, p) => s + p, 0n);
    byToken.set(tokenIds[0], total);
  } else {
    // Executions and hulls do not line up, so no hull can be given a price of
    // its own - but the sum is not a guess: it is every Blur execution for this
    // collection in this receipt. A sweep post prints the total and never a
    // per-hull price, so classify() is allowed to publish it, and only in the
    // one case where the total is honest: a single captain taking them all.
    const sum = ours.reduce((s, p) => s + p, 0n);
    if (sum === 0n) return EMPTY;
    l.warn(`blur: ${ours.length} executions vs ${tokenIds.length} hulls in ${receipt.transactionHash} - per-hull price withheld, total kept`);
    const unattributed = new Map<bigint, bigint>();
    for (const id of tokenIds) unattributed.set(id, 0n);
    return { byToken: unattributed, total: sum, source: 'blur-total', marketplace: 'Blur', currency: 'ETH' };
  }

  return { byToken, total, source: 'blur', marketplace: 'Blur', currency: 'ETH' };
}
