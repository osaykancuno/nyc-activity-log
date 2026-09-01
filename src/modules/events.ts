import type { ChainEvent } from '../chain/classify';
import { ensName } from '../chain/client';
import { log } from '../logger';
import { enqueue } from '../poster';
import { renderFleetCard, renderYachtCard } from '../render/card';
import { claimPost, forgePost, salePost, sweepPost } from '../templates';
import { classBreakdown, fmtEth, shortAddr, who } from '../util';
import { resolveYacht, resolveYachts } from '../yacht';

const l = log('events');

const rank = (r: number | null) => (r != null ? ` \u00b7 rank ${r}` : '');

/** A chain event becomes at most one post. Modules A, B, C and I live here. */
export async function handleEvent(ev: ChainEvent): Promise<void> {
  try {
    switch (ev.kind) {
      case 'claim': return await onClaim(ev);
      case 'sale': return await onSale(ev);
      case 'sweep': return await onSweep(ev);
      case 'forge': return await onForge(ev);
    }
  } catch (e) {
    l.error(`could not build a post for ${ev.key}`, e);
  }
}

async function onClaim(ev: ChainEvent): Promise<void> {
  const y = await resolveYacht(ev.tokenIds[0]);
  const media = renderYachtCard(y, 'claim', {
    title: `Yacht #${y.id}`,
    subtitle: `${y.class}${rank(y.rarityRank)} \u00b7 ${y.anchorPointsPerDay} AP/day`,
    note: `born from Normie #${y.normieId}`,
    right: 'afloat',
  });
  enqueue({ key: ev.key, kind: 'claim', text: claimPost(y, ev.blockNumber), media, priority: ev.priority });
}

async function onSale(ev: ChainEvent): Promise<void> {
  const y = await resolveYacht(ev.tokenIds[0]);
  const [fromEns, toEns] = await Promise.all([ensName(ev.from), ensName(ev.to)]);
  const price = ev.priceWei ?? 0n;

  const media = renderYachtCard(y, 'sale', {
    title: `Yacht #${y.id}`,
    subtitle: `${y.class}${rank(y.rarityRank)}`,
    note: `${who(ev.from, fromEns)} \u2192 ${who(ev.to, toEns)}`,
    right: fmtEth(price, ev.currency ?? 'ETH'),
  });

  enqueue({
    key: ev.key,
    kind: 'sale',
    text: salePost(y, price, { addr: ev.from, ens: fromEns }, { addr: ev.to, ens: toEns }, ev.blockNumber, ev.marketplace ?? '', ev.currency ?? 'ETH'),
    media,
    priority: ev.priority,
  });
}

async function onSweep(ev: ChainEvent): Promise<void> {
  const yachts = await resolveYachts([...ev.tokenIds].sort((a, b) => a - b));
  const toEns = await ensName(ev.to);
  const price = ev.priceWei ?? 0n;

  const media = renderFleetCard(yachts, 'sweep', {
    title: `${yachts.length}x Sweep`,
    subtitle: classBreakdown(yachts.map((y) => y.class)),
    note: `\u2192 ${who(ev.to, toEns)}`,
    right: fmtEth(price, ev.currency ?? 'ETH'),
  });

  enqueue({
    key: ev.key,
    kind: 'sweep',
    text: sweepPost(yachts, price, { addr: ev.to, ens: toEns }, ev.blockNumber, ev.marketplace ?? '', ev.currency ?? 'ETH'),
    media,
    priority: ev.priority,
  });
}

async function onForge(ev: ChainEvent): Promise<void> {
  const yachts = await resolveYachts(ev.tokenIds);
  const ens = await ensName(ev.from);

  const media = renderFleetCard(yachts, 'forge', {
    title: `${yachts.length} hulls burned`,
    subtitle: classBreakdown(yachts.map((y) => y.class)),
    note: `by ${who(ev.from, ens)} \u00b7 ${shortAddr(ev.txHash)}`,
    right: 'island',
  });

  enqueue({
    key: ev.key,
    kind: 'forge',
    text: forgePost(yachts, { addr: ev.from, ens }, ev.blockNumber),
    media,
    priority: ev.priority,
  });
}
