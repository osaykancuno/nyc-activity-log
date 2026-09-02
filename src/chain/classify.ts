import { config } from '../config';
import { runtime } from '../runtime';
import { log } from '../logger';
import { isZero, ethNumber } from '../util';
import { priceFromReceipt, type Currency, type PriceInfo, type PriceSource } from './sales';
import { publicClient } from './client';
import type { TransferRow, TxGroup } from './watcher';

const l = log('classify');

export type EventKind = 'claim' | 'sale' | 'sweep' | 'forge';

export interface ChainEvent {
  kind: EventKind;
  key: string;                 // dedup key
  txHash: `0x${string}`;
  blockNumber: bigint;
  at: Date;
  tokenIds: number[];
  from: `0x${string}`;
  to: `0x${string}`;
  priceWei?: bigint;           // total for the event
  pricePerToken?: Map<number, bigint>;
  marketplace?: string;
  currency?: Currency;
  priceSource?: PriceSource;
  priority: number;            // higher wins when the budget is tight
}

/**
 * Turn one transaction into zero or more publishable events.
 *
 * Rules, in the club's own terms:
 *  - from 0x0                    -> a hull is born (claim)
 *  - to 0x0, 10 hulls, one wallet-> a forge (island). Only when the module is on.
 *  - a proven payment            -> a sale, or a sweep if the same captain took several
 *  - anything else               -> not our business. No listing spam, no dump watching.
 */
export async function classify(g: TxGroup): Promise<ChainEvent[]> {
  const out: ChainEvent[] = [];

  const claims = g.transfers.filter((t) => isZero(t.from));
  const burns = g.transfers.filter((t) => isZero(t.to));
  const moves = g.transfers.filter((t) => !isZero(t.from) && !isZero(t.to));

  for (const c of claims) {
    out.push({
      kind: 'claim',
      key: `claim:${g.txHash}:${c.tokenId}`,
      txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
      tokenIds: [Number(c.tokenId)], from: c.from, to: c.to,
      priority: 80,
    });
  }

  if (burns.length > 0 && runtime.forgeArmed) {
    const byOwner = new Map<string, bigint[]>();
    for (const b of burns) byOwner.set(b.from, [...(byOwner.get(b.from) ?? []), b.tokenId]);
    for (const [owner, ids] of byOwner) {
      out.push({
        kind: 'forge',
        key: `forge:${g.txHash}:${owner}`,
        txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
        tokenIds: ids.map(Number), from: owner as `0x${string}`, to: '0x0000000000000000000000000000000000000000',
        priority: 95,
      });
    }
  }

  if (moves.length === 0 || (!config.modules.sale && !config.modules.sweep)) return out;

  // Was anything actually paid in this transaction?
  let price;
  try {
    const [receipt, tx] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: g.txHash }),
      publicClient.getTransaction({ hash: g.txHash }),
    ]);
    price = priceFromReceipt(receipt, tx.value, moves.map((m) => m.tokenId));
  } catch (e) {
    l.warn(`receipt unavailable for ${g.txHash}`, e);
    return out;
  }

  if (price.byToken.size === 0) return out; // a transfer, not a sale. Silence.

  // Blur can pay for a set without saying which hull got what. The total is
  // still provable from the receipt, and a sweep post prints only the total -
  // so it may go out, but exclusively when one captain took every paid hull.
  // With two buyers there is no honest way to split it, and the log says nothing.
  if (price.source === 'blur-total') {
    const buyers = new Set(moves.map((m) => m.to.toLowerCase()));
    if (buyers.size !== 1 || moves.length < config.sweepMin || !config.modules.sweep) {
      l.warn(`${g.txHash}: blur total across ${buyers.size} buyer(s) and ${moves.length} hull(s) - not publishable`);
      return out;
    }
    if (ethNumber(price.total) < config.minSaleEth) return out;
    out.push({
      kind: 'sweep',
      key: `sweep:${g.txHash}:${moves[0]!.to}`,
      txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
      tokenIds: moves.map((m) => Number(m.tokenId)).sort((a, b) => a - b),
      from: moves[0]!.from, to: moves[0]!.to,
      priceWei: price.total,
      marketplace: price.marketplace, priceSource: price.source, currency: price.currency,
      priority: 90,
    });
    return out;
  }

  out.push(...salesFrom(g, moves, price));
  return out;
}

/**
 * Who bought what, and whether each hull earns its own entry.
 *
 * Pure on purpose. Everything above needs a receipt from the chain; this is the
 * part that decides what the timeline actually looks like, so it is testable on
 * its own - `npm run tools:sales-split` covers it.
 *
 * A log records hulls, not baskets. Two or three yachts taken in one
 * transaction are two or three things that happened, and each gets its own
 * entry with its own hull, its own seller and its own price. The single sweep
 * post exists for where that stops being true: a captain taking SWEEP_MIN hulls
 * at once is one event, and posting it as twenty would flood the timeline and
 * cost twenty times as much. That threshold is the only thing separating a log
 * from a bill.
 */
export function salesFrom(
  g: Pick<TxGroup, 'txHash' | 'blockNumber' | 'timestamp'>,
  moves: TransferRow[],
  price: PriceInfo,
): ChainEvent[] {
  const out: ChainEvent[] = [];

  const byBuyer = new Map<string, { id: bigint; from: `0x${string}` }[]>();
  for (const m of moves) {
    if (!price.byToken.has(m.tokenId)) continue;
    const e = byBuyer.get(m.to) ?? [];
    e.push({ id: m.tokenId, from: m.from });
    byBuyer.set(m.to, e);
  }

  for (const [to, bought] of byBuyer) {
    const items = [...bought].sort((x, y) => Number(x.id - y.id));

    if (items.length < config.sweepMin) {
      if (!config.modules.sale) continue;
      for (const { id, from } of items) {
        const paid = price.byToken.get(id)!;
        if (ethNumber(paid) < config.minSaleEth) continue;
        out.push({
          kind: 'sale',
          // The hull is part of the key: one transaction can now carry several.
          key: `sale:${g.txHash}:${to}:${id}`,
          txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
          tokenIds: [Number(id)],
          from, to: to as `0x${string}`,
          priceWei: paid,
          marketplace: price.marketplace, priceSource: price.source, currency: price.currency,
          priority: 70,
        });
      }
      continue;
    }

    if (!config.modules.sweep) continue;

    const perToken = new Map<number, bigint>();
    let total = 0n;
    for (const { id } of items) {
      const paid = price.byToken.get(id)!;
      perToken.set(Number(id), paid);
      total += paid;
    }
    if (ethNumber(total) < config.minSaleEth) continue;

    out.push({
      kind: 'sweep',
      key: `sweep:${g.txHash}:${to}`,
      txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
      tokenIds: items.map((i) => Number(i.id)),
      from: items[0]!.from, to: to as `0x${string}`,
      priceWei: total, pricePerToken: perToken,
      marketplace: price.marketplace, priceSource: price.source, currency: price.currency,
      priority: 90,
    });
  }

  return out;
}
