import { config } from '../config';
import { log } from '../logger';
import { getTide, type TideRound, type TideWinner } from '../api/relay';
import type { Yacht } from '../api/nyc';
import { enqueue } from '../poster';
import { renderFleetCard, renderWatchCard, renderYachtCard } from '../render/card';
import { tideOpenPost, tideSettledPost, type TideWinnerLine } from '../templates';
import { classBreakdown, fmtInt } from '../util';
import { resolveYacht } from '../yacht';
import { alreadyPosted, markPosted } from '../store';

const l = log('tide');

/**
 * Module G. Two moments in a round, and nothing in between:
 *   - it opens  -> what it costs, what it is for, when it closes
 *   - it settles-> which hulls won, each one's weight against the pool it was
 *                  drawn from, and the block the draw was taken from
 *
 * No captains, no wallets: the relay keys entries by hull, and so do we. The
 * COUNT of captains is another matter - it is the number the club draws on, and
 * it names nobody. If the relay is unreachable the module says nothing at all.
 */
export async function runTide(): Promise<void> {
  if (!config.modules.tide) return;

  const tide = await getTide();
  if (!tide) return;

  // No NFT in the club's prize wallet means no round opens at all. Nothing to
  // announce, and nothing wrong either: the Tide is waiting, not broken.
  if (tide.dormant) l.info(`the Tide is dormant - ${fmtInt(tide.potCount ?? 0)} prizes waiting in the pot`);

  const rounds: TideRound[] = [tide.round, ...(tide.history ?? [])].filter(Boolean) as TideRound[];

  // First ever look: record where the Tide stands and say nothing. A log that
  // opens by announcing three-week-old rounds is not a log, it is a backlog.
  if (!alreadyPosted('tide:seeded')) {
    for (const r of rounds) {
      markPosted(`tide:open:${r.id}`, { kind: 'seed' });
      if (winnersOf(r).length) markPosted(`tide:settled:${r.id}`, { kind: 'seed' });
    }
    markPosted('tide:seeded', { kind: 'seed', rounds: rounds.map((r) => r.id) });
    l.info(`seeded at round ${tide.round?.id ?? '-'} - future rounds will be logged`);
    return;
  }

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  for (const r of rounds) {
    if (winnersOf(r).length && r.settleBlock) {
      if (r.settledAt && Date.now() - r.settledAt > WEEK) continue; // too old to be news
      await onSettled(r);
    } else if (!r.closed && r.closesAt > Date.now()) {
      await onOpen(r);
    }
  }
}

/**
 * The winners of a round. The relay kept the old single `winner` for a round
 * that hands out one prize, and added `winners` once a round could hand out two
 * - so a log reading only `winner` would announce half of a two-prize round.
 */
function winnersOf(r: TideRound): TideWinner[] {
  if (r.winners?.length) return r.winners;
  return r.winner ? [r.winner] : [];
}

async function onOpen(r: TideRound, force = false): Promise<void> {
  // Captains are what a round runs on: three of them float it, and thirty turn
  // one prize into two. Yachts only carry the weight they entered with.
  const extraAt = r.winnerAt?.length ? r.winnerAt[0]! : null;
  const maxPrizes = r.maxWinners ?? null;

  const rows: [string, string][] = [
    ['Prize', String(r.prize).replace(/-/g, ' ')],
    ['Cost per Yacht', `${fmtInt(r.cost)} AP`],
    ['Captains entered', fmtInt(r.captains ?? 0)],
    ['Yachts entered', fmtInt(r.fleet?.length ?? 0)],
  ];
  if (extraAt != null && (maxPrizes ?? 1) > 1) {
    rows.push(['Prizes', `${fmtInt(maxPrizes!)} at ${fmtInt(extraAt)} captains`]);
  }

  const media = renderWatchCard(
    rows,
    'the tide',
    `Round ${r.id}`,
    `Closes ${new Date(r.closesAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · max ${r.cap} per captain · ${r.floor} captains to float`,
  );

  enqueue({
    key: force ? `tide:open:${r.id}:preview:${Date.now()}` : `tide:open:${r.id}`,
    kind: 'tide-open',
    text: tideOpenPost({
      id: r.id, prize: r.prize, cost: r.cost, cap: r.cap, floor: r.floor,
      commits: r.commits, hulls: r.fleet?.length ?? 0, captains: r.captains ?? null,
      closesAt: r.closesAt, extraAt, maxPrizes,
    }),
    media,
    priority: 60,
  });
}

async function onSettled(r: TideRound, force = false): Promise<void> {
  const won = winnersOf(r);
  if (!won.length) return;

  // Only a round old enough to predate `poolWeight` falls back to the whole
  // entered fleet. For any newer one the relay's own figure is the pool, and it
  // shrinks between prizes: a winning captain leaves with every yacht entered.
  const fleetWeight = (r.fleet ?? []).reduce((s, f) => s + f.weight, 0);

  // One read per winning hull, shared by the card and the text.
  const drawn = await Promise.all(won.map(async (w) => {
    const id = Number(w.yachtId);
    let yacht: Yacht | null = null;
    try {
      yacht = await resolveYacht(id);
    } catch (e) {
      l.warn(`could not read the class of #${id}`, e);
    }
    return { id, weight: w.weight, pool: w.poolWeight ?? fleetWeight, yacht };
  }));

  const lines: TideWinnerLine[] = drawn.map((d) => ({
    id: d.id,
    yachtClass: d.yacht?.class ?? 'Yacht',
    weight: d.weight,
    pool: d.pool,
  }));

  const note = `block ${fmtInt(r.settleBlock!)}${r.hash ? ` · ${r.hash.slice(0, 10)}…${r.hash.slice(-6)}` : ''}`;
  const hulls = drawn.map((d) => d.yacht).filter((y): y is Yacht => y !== null);

  let media: Buffer;
  if (drawn.length === 1 && hulls.length === 1) {
    // One prize: the winner gets its own portrait. A round is won by a hull.
    const only = drawn[0]!;
    media = renderYachtCard(hulls[0]!, 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `Yacht #${only.id} · ${hulls[0]!.class} · weight ${only.weight} of ${only.pool}`,
      note,
      right: 'winner',
    });
  } else if (hulls.length > 1 && hulls.length === drawn.length) {
    // Two prizes, two portraits. A card showing one hull would describe a round
    // the club did not run.
    media = renderFleetCard(hulls, 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `${fmtInt(drawn.length)} prizes · ${classBreakdown(hulls.map((y) => y.class))}`,
      note,
      right: 'winners',
    }, drawn.length);
  } else {
    // The club API could not place every winner: numbers only, rather than a
    // portrait of whichever hull happened to resolve.
    media = renderWatchCard(
      drawn.map((d): [string, string] => [`Winner #${d.id}`, `weight ${d.weight} of ${d.pool}`]),
      'the tide',
      `Round ${r.id} settled`,
      note,
    );
  }

  enqueue({
    key: force ? `tide:settled:${r.id}:preview:${Date.now()}` : `tide:settled:${r.id}`,
    kind: 'tide-settled',
    text: tideSettledPost({
      id: r.id, prize: r.prize, winners: lines,
      hulls: r.fleet?.length ?? 0, captains: r.captains ?? null,
      settleBlock: r.settleBlock!, hash: r.hash ?? '',
    }),
    media,
    priority: 85,
  });
}

/** CLI only: render the round that is open now and the last one that settled. */
export async function previewTide(): Promise<void> {
  const tide = await getTide();
  if (!tide) return l.error('the relay did not answer');
  if (tide.round && !winnersOf(tide.round).length) await onOpen(tide.round, true);
  const settled = [tide.round, ...(tide.history ?? [])]
    .find((r): r is TideRound => !!r && winnersOf(r).length > 0 && !!r.settleBlock);
  if (settled) await onSettled(settled, true);
}
