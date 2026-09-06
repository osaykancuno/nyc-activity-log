import type { ChainEvent } from '../chain/classify';
import { ensName } from '../chain/client';
import { log } from '../logger';
import { enqueue } from '../poster';
import { renderFleetCard, renderYachtCard } from '../render/card';
import { claimPost, forgePost, salePost, sweepPost } from '../templates';
import { classBreakdown, fmtEth, fmtInt, grade, shortAddr, who } from '../util';
import { resolveFleet, resolveYacht } from '../yacht';

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
    subtitle: `${grade(y)}${rank(y.rarityRank)} \u00b7 ${y.anchorPointsPerDay} AP/day`,
    note: `born from Normie #${y.normieId}`,
    right: 'afloat',
  });
  enqueue({ key: ev.key, kind: 'claim', text: claimPost(y, ev.blockNumber), media, priority: ev.priority });
}

async function onSale(ev: ChainEvent): Promise<void> {
  const y = await resolveYacht(ev.tokenIds[0]);
  // The card draws the contract's own image, rebuilt from tokenURI's SVG into
  // the same 40x40 grid the club publishes. Worth stating per post: a silent
  // fallback to the CDN snapshot is the kind of thing nobody notices.
  l.debug(`#${y.id}: art from the ${y.art.from === 'api' ? 'API snapshot' : 'contract'}`);
  const [fromEns, toEns] = await Promise.all([ensName(ev.from), ensName(ev.to)]);
  const price = ev.priceWei ?? 0n;

  const media = renderYachtCard(y, 'sale', {
    title: `Yacht #${y.id}`,
    subtitle: `${grade(y)}${rank(y.rarityRank)}`,
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
  // The ids are the chain's answer and the count on the card comes from them,
  // so a twenty-hull sweep announces twenty whatever the club CDN managed.
  const ids = [...ev.tokenIds].sort((a, b) => a - b);
  const { yachts, missing } = await resolveFleet(ids);
  const toEns = await ensName(ev.to);
  const price = ev.priceWei ?? 0n;

  const media = renderFleetCard(yachts, 'sweep', {
    title: `${fmtInt(ids.length)}x Sweep`,
    subtitle: missing.length ? '' : classBreakdown(yachts.map(grade)),
    note: `\u2192 ${who(ev.to, toEns)}`,
    right: fmtEth(price, ev.currency ?? 'ETH'),
  }, ids.length);

  enqueue({
    key: ev.key,
    kind: 'sweep',
    text: sweepPost(ids, yachts, price, { addr: ev.to, ens: toEns }, ev.blockNumber, ev.marketplace ?? '', ev.currency ?? 'ETH'),
    media,
    priority: ev.priority,
  });
}

async function onForge(ev: ChainEvent): Promise<void> {
  const ids = [...ev.tokenIds].sort((a, b) => a - b);
  const { yachts, missing } = await resolveFleet(ids);
  const ens = await ensName(ev.from);

  const media = renderFleetCard(yachts, 'forge', {
    title: `${fmtInt(ids.length)} Yachts burned`,
    subtitle: missing.length ? '' : classBreakdown(yachts.map(grade)),
    note: `by ${who(ev.from, ens)} \u00b7 ${shortAddr(ev.txHash)}`,
    right: 'island',
  }, ids.length);

  enqueue({
    key: ev.key,
    kind: 'forge',
    text: forgePost(ids, yachts, { addr: ev.from, ens }, ev.blockNumber),
    media,
    priority: ev.priority,
  });
}
