import { config } from '../config';
import { log } from '../logger';
import { getDailyTide, getTide, type DailyDraw, type TideRound, type TideWinner } from '../api/relay';
import type { Yacht } from '../api/nyc';
import { enqueue } from '../poster';
import { renderFleetCard, renderIslandCard, renderWatchCard, renderYachtCard } from '../render/card';
import { dailyMarkPost, tideOpenPost, tideSettledPost, type TideCost, type TideWinnerLine } from '../templates';
import { classBreakdown, fmtInt, grade, isIsland } from '../util';
import { resolveIsland, resolveYacht, type Island } from '../yacht';
import { alreadyPosted, markPosted } from '../store';
import { islandFacts } from './forge';

const l = log('tide');

/**
 * What a draw landed on. Both clocks take islands as well as yachts - they are
 * tokens of the same contract - and on 17 Oct 2026 the daily draw marked island
 * #1000000. The log read it as a yacht: the club API has no island, so the
 * contract fallback called it a Cruiser born from Normie #0, and the post said
 * "Yacht #1000000". An id at or above the island base is an island, always.
 */
interface Drawn {
  id: number;
  noun: 'Yacht' | 'Island';
  /** The line under the headline: a yacht's grade, or an island's name, grade and score. */
  label: string;
  /** Grade and score alone, short enough for a card subtitle. */
  short: string;
  yacht: Yacht | null;
  island: Island | null;
}

async function readDrawn(id: number): Promise<Drawn> {
  if (!isIsland(id)) {
    let yacht: Yacht | null = null;
    try {
      yacht = await resolveYacht(id);
    } catch (e) {
      l.warn(`could not read the class of #${id}`, e);
    }
    const g = yacht ? grade(yacht) : 'Yacht';
    return { id, noun: 'Yacht', label: g, short: g, yacht, island: null };
  }

  // One ask, not the forge's four: an island marked by the Tide was graded long ago.
  const [island, facts] = await Promise.all([
    resolveIsland(id).catch((e) => { l.warn(`island #${id}: tokenURI unreadable`, e); return null; }),
    islandFacts(id, 1).catch(() => null),
  ]);
  const short = facts?.grade
    ? [facts.grade, facts.score != null ? `score ${facts.score}` : ''].filter(Boolean).join(' · ')
    : 'Island';
  const label = facts?.name ? `${facts.name} · ${short}` : short;
  return { id, noun: 'Island', label, short, yacht: null, island };
}

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

/**
 * What a round costs to enter. Round 6 replaced the flat `cost` with a price by
 * grade (`costLadder`) and left `cost` null - and the open post printed "null".
 * The ladder wins when present, cheapest grade first; a figure the relay did
 * not send is left out, never guessed.
 */
export function costOf(r: Pick<TideRound, 'id' | 'cost' | 'costLadder' | 'costPerWeight'>): TideCost {
  const ladder = Object.entries(r.costLadder ?? {})
    .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
    .sort((a, b) => a[1] - b[1]);
  if (ladder.length) return { kind: 'ladder', ladder };
  if (typeof r.cost === 'number' && Number.isFinite(r.cost)) return { kind: 'flat', ap: r.cost };
  if (typeof r.costPerWeight === 'number' && Number.isFinite(r.costPerWeight)) return { kind: 'per-weight', ap: r.costPerWeight };
  l.warn(`round ${r.id}: the relay sent no price - the open post leaves it out`);
  return { kind: 'unknown' };
}

async function onOpen(r: TideRound, force = false): Promise<void> {
  // Captains are what a round runs on: three of them float it, and thirty turn
  // one prize into two. Yachts only carry the weight they entered with.
  const extraAt = r.winnerAt?.length ? r.winnerAt[0]! : null;
  const maxPrizes = r.maxWinners ?? null;

  const cost = costOf(r);
  const rows: [string, string][] = [
    ['Prize', String(r.prize).replace(/-/g, ' ')],
    // The post carries the price of each grade; the card adds the rule behind it.
    ...(cost.kind === 'flat' ? [['Cost per Yacht', `${fmtInt(cost.ap)} AP`] as [string, string]] : []),
    ...(r.costPerWeight != null ? [['Cost per weight', `${fmtInt(r.costPerWeight)} AP`] as [string, string]] : []),
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
      id: r.id, prize: r.prize, cost, cap: r.cap, floor: r.floor,
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

  // One read per winner, shared by the card and the text. A winner may be an island.
  const drawn = await Promise.all(won.map(async (w) => ({
    ...(await readDrawn(Number(w.yachtId))),
    weight: w.weight,
    pool: w.poolWeight ?? fleetWeight,
  })));

  const lines: TideWinnerLine[] = drawn.map((d) => ({
    id: d.id,
    noun: d.noun,
    yachtClass: d.label,
    weight: d.weight,
    pool: d.pool,
  }));

  const note = `block ${fmtInt(r.settleBlock!)}${r.hash ? ` · ${r.hash.slice(0, 10)}…${r.hash.slice(-6)}` : ''}`;
  const hulls = drawn.map((d) => d.yacht).filter((y): y is Yacht => y !== null);

  let media: Buffer;
  if (drawn.length === 1 && drawn[0]!.island) {
    // An island won: its own picture, never a yacht's.
    const only = drawn[0]!;
    media = renderIslandCard(only.island!, [], 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `Island #${only.id} · ${only.short} · weight ${only.weight} of ${only.pool}`,
      note,
      right: 'winner',
    });
  } else if (drawn.length === 1 && hulls.length === 1) {
    // One prize: the winner gets its own portrait. A round is won by a hull.
    const only = drawn[0]!;
    media = renderYachtCard(hulls[0]!, 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `Yacht #${only.id} · ${grade(hulls[0]!)} · weight ${only.weight} of ${only.pool}`,
      note,
      right: 'winner',
    });
  } else if (hulls.length > 1 && hulls.length === drawn.length) {
    // Two prizes, two portraits. A card showing one hull would describe a round
    // the club did not run.
    media = renderFleetCard(hulls, 'the tide', {
      title: `Round ${r.id} settled`,
      subtitle: `${fmtInt(drawn.length)} prizes · ${classBreakdown(hulls.map(grade))}`,
      note,
      right: 'winners',
    }, drawn.length);
  } else {
    // The club API could not place every winner: numbers only, rather than a
    // portrait of whichever hull happened to resolve.
    media = renderWatchCard(
      drawn.map((d): [string, string] => [`${d.noun} #${d.id}`, `weight ${d.weight} of ${d.pool}`]),
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

/**
 * Module G on its other clock. The Tide runs free every day as well as on
 * Sunday: one entry a captain whatever the size of their fleet, and a block
 * nobody can foresee marks one hull. The mark is permanent.
 *
 * Only `last` carries the block and the hash a mark can be checked against, so
 * it is the only day this log will publish - and a draw that marked nobody is
 * not published at all. Roughly two days in five end that way; a log that
 * announced each of them would be saying nothing, daily, at $0.015 a time.
 */
export async function runDailyTide(): Promise<void> {
  if (!config.modules.tide) return;

  const daily = await getDailyTide();
  const t = daily?.tide;
  if (!t) return;

  // First look: note where the register stands and say nothing, the same way a
  // Sunday round is seeded. A log does not open with a fortnight of old draws.
  if (!alreadyPosted('tide:daily:seeded')) {
    for (const d of [t.last, ...(t.history ?? [])]) {
      if (d?.day) markPosted(`tide:daily:${d.day}`, { kind: 'seed' });
    }
    markPosted('tide:daily:seeded', { kind: 'seed', day: t.day, marks: t.marks });
    l.info(`daily draw seeded at ${t.last?.day ?? t.day} - ${fmtInt(t.marks)} marks in the register`);
    return;
  }

  const last = t.last;
  if (!last?.yachtId || !last.block) return;
  if (alreadyPosted(`tide:daily:${last.day}`)) return;
  await postDailyMark(last, t.marks);
}

async function postDailyMark(last: DailyDraw, marks: number, force = false): Promise<void> {
  if (!last.yachtId || last.block == null) return;
  const id = Number(last.yachtId);
  const block = last.block;
  const d = await readDrawn(id);
  const y = d.yacht;

  const note = `${fmtInt(last.entries)} entered · block ${fmtInt(block)} · ${last.day}`;
  const media = d.island
    ? renderIslandCard(d.island, [], 'the daily tide', {
      title: `Island #${id}`,
      subtitle: d.short,
      note,
      right: 'marked',
    })
    : y
    ? renderYachtCard(y, 'the daily tide', {
      title: `Yacht #${id}`,
      subtitle: `${grade(y)}${y.rarityRank != null ? ` · rank ${y.rarityRank}` : ''}`,
      note,
      right: 'marked',
    })
    : renderWatchCard(
      [['Marked', `#${id}`], ['Entered', fmtInt(last.entries)], ['Marks in the register', fmtInt(marks)]],
      'the daily tide',
      'The daily draw',
      note,
    );

  enqueue({
    key: force ? `tide:daily:${last.day}:preview:${Date.now()}` : `tide:daily:${last.day}`,
    kind: 'tide-daily',
    text: dailyMarkPost({
      id,
      noun: d.noun,
      hullGrade: d.label,
      rank: y?.rarityRank ?? null,
      entries: last.entries,
      block,
      hash: last.hash ?? '',
      marks: marks ?? null,
    }),
    media,
    priority: 50,
  });
}

/**
 * CLI only: render yesterday's daily draw, if it marked a hull. With an id, the
 * last draw is rendered as if it had marked that token - `preview daily 1000000`
 * is how an island's mark is checked without waiting for one.
 */
export async function previewDailyTide(asId?: number): Promise<void> {
  const daily = await getDailyTide();
  const t = daily?.tide;
  if (!t) return l.error('the relay did not answer');
  l.info(`daily draw: ${fmtInt(t.entries)} entered today, ${fmtInt(t.marks)} marks in the register`);
  if (asId != null && t.last?.block != null) {
    l.info(`rendering the draw of ${t.last.day} as if it had marked #${asId}`);
    return postDailyMark({ ...t.last, yachtId: String(asId) }, t.marks, true);
  }
  if (!t.last?.yachtId) {
    return l.info(`the last draw (${t.last?.day ?? '?'}) marked no yacht - nothing to render, and nothing this log would post`);
  }
  await postDailyMark(t.last, t.marks, true);
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
