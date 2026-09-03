import { config } from '../config';
import { log } from '../logger';
import { getTide, type TideRound } from '../api/relay';
import { enqueue } from '../poster';
import { renderWatchCard, renderYachtCard } from '../render/card';
import { tideOpenPost, tideSettledPost } from '../templates';
import { fmtInt } from '../util';
import { resolveYacht } from '../yacht';
import { alreadyPosted, markPosted } from '../store';

const l = log('tide');

/**
 * Module G. Two moments in a round, and nothing in between:
 *   - it opens  -> what it costs, what it is for, when it closes
 *   - it settles-> which hull won, its weight against the whole entered fleet,
 *                  and the block the draw was taken from
 *
 * No captains, no wallets: the relay keys entries by hull, and so do we.
 * If the relay is unreachable the module says nothing at all.
 */
export async function runTide(): Promise<void> {
  if (!config.modules.tide) return;

  const tide = await getTide();
  if (!tide) return;

  const rounds: TideRound[] = [tide.round, ...(tide.history ?? [])].filter(Boolean) as TideRound[];

  // First ever look: record where the Tide stands and say nothing. A log that
  // opens by announcing three-week-old rounds is not a log, it is a backlog.
  if (!alreadyPosted('tide:seeded')) {
    for (const r of rounds) {
      markPosted(`tide:open:${r.id}`, { kind: 'seed' });
      if (r.winner) markPosted(`tide:settled:${r.id}`, { kind: 'seed' });
    }
    markPosted('tide:seeded', { kind: 'seed', rounds: rounds.map((r) => r.id) });
    l.info(`seeded at round ${tide.round?.id ?? '-'} - future rounds will be logged`);
    return;
  }

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  for (const r of rounds) {
    if (r.winner && r.settleBlock) {
      if (r.settledAt && Date.now() - r.settledAt > WEEK) continue; // too old to be news
      await onSettled(r);
    } else if (!r.closed && r.closesAt > Date.now()) {
      await onOpen(r);
    }
  }
}

async function onOpen(r: TideRound, force = false): Promise<void> {
  const media = renderWatchCard(
    [
      ['Prize', String(r.prize).replace(/-/g, ' ')],
      ['Cost per Yacht', `${fmtInt(r.cost)} AP`],
      ['Yachts entered', fmtInt(r.fleet?.length ?? 0)],
    ],
    'the tide',
    `Round ${r.id}`,
    `Closes ${new Date(r.closesAt).toISOString().slice(0, 16).replace('T', ' ')} UTC \u00b7 max ${r.cap} per captain`,
  );

  enqueue({
    key: force ? `tide:open:${r.id}:preview:${Date.now()}` : `tide:open:${r.id}`,
    kind: 'tide-open',
    text: tideOpenPost({
      id: r.id, prize: r.prize, cost: r.cost, cap: r.cap, floor: r.floor,
      commits: r.commits, hulls: r.fleet?.length ?? 0, closesAt: r.closesAt,
    }),
    media,
    priority: 60,
  });
}

async function onSettled(r: TideRound, force = false): Promise<void> {
  const winnerId = Number(r.winner!.yachtId);
  const totalWeight = (r.fleet ?? []).reduce((s, f) => s + f.weight, 0);

  let winnerClass = 'Yacht';
  try {
    winnerClass = (await resolveYacht(winnerId)).class;
  } catch (e) {
    l.warn(`could not read the class of #${winnerId}`, e);
  }

  // The winner gets its own portrait: a round is won by a hull, not by a number.
  let media: Buffer;
  try {
    const y = await resolveYacht(winnerId);
    media = renderYachtCard(y, 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `Yacht #${winnerId} \u00b7 ${y.class} \u00b7 weight ${r.winner!.weight} of ${totalWeight}`,
      note: `block ${fmtInt(r.settleBlock!)}${r.hash ? ` \u00b7 ${r.hash.slice(0, 10)}\u2026${r.hash.slice(-6)}` : ''}`,
      right: 'winner',
    });
  } catch {
    media = renderWatchCard(
      [
        ['Winner', `#${winnerId}`],
        ['Weight', `${r.winner!.weight} of ${totalWeight}`],
        ['Settle block', fmtInt(r.settleBlock!)],
      ],
      'the tide',
      `Round ${r.id} settled`,
      r.hash ?? '',
    );
  }

  enqueue({
    key: force ? `tide:settled:${r.id}:preview:${Date.now()}` : `tide:settled:${r.id}`,
    kind: 'tide-settled',
    text: tideSettledPost({
      id: r.id, prize: r.prize, winnerId, winnerClass,
      winnerWeight: r.winner!.weight, totalWeight,
      hulls: r.fleet?.length ?? 0, settleBlock: r.settleBlock!, hash: r.hash ?? '',
    }),
    media,
    priority: 85,
  });
}

/** CLI only: render the round that is open now and the last one that settled. */
export async function previewTide(): Promise<void> {
  const tide = await getTide();
  if (!tide) return l.error('the relay did not answer');
  if (tide.round && !tide.round.winner) await onOpen(tide.round, true);
  const settled = [tide.round, ...(tide.history ?? [])].find((r) => r?.winner && r.settleBlock);
  if (settled) await onSettled(settled, true);
}
