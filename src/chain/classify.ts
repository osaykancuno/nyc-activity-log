import { config } from '../config';
import { runtime } from '../runtime';
import { log } from '../logger';
import { isZero, ethNumber } from '../util';
import { priceFromReceipt, type Currency, type PriceSource } from './sales';
import { publicClient } from './client';
import type { TxGroup } from './watcher';

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

  // Group paid hulls by buyer: same buyer + same tx + N hulls = one sweep post.
  const byBuyer = new Map<string, { ids: bigint[]; from: `0x${string}` }>();
  for (const m of moves) {
    if (!price.byToken.has(m.tokenId)) continue;
    const e = byBuyer.get(m.to) ?? { ids: [], from: m.from };
    e.ids.push(m.tokenId);
    byBuyer.set(m.to, e);
  }

  for (const [to, { ids, from }] of byBuyer) {
    const perToken = new Map<number, bigint>();
    let total = 0n;
    for (const id of ids) {
      const p = price.byToken.get(id)!;
      perToken.set(Number(id), p);
      total += p;
    }
    if (ethNumber(total) < config.minSaleEth) continue;

    const isSweep = ids.length >= config.sweepMin;
    if (isSweep && !config.modules.sweep) continue;
    if (!isSweep && !config.modules.sale) continue;

    out.push({
      kind: isSweep ? 'sweep' : 'sale',
      key: `${isSweep ? 'sweep' : 'sale'}:${g.txHash}:${to}`,
      txHash: g.txHash, blockNumber: g.blockNumber, at: g.timestamp,
      tokenIds: ids.map(Number).sort((a, b) => a - b),
      from, to: to as `0x${string}`,
      priceWei: total, pricePerToken: perToken,
      marketplace: price.marketplace, priceSource: price.source, currency: price.currency,
      priority: isSweep ? 90 : 70,
    });
  }

  return out;
}
