import { club } from './config';
import type { Yacht } from './api/nyc';
import {
  classBreakdown, fmtBlock, fmtEth, fmtInt, logDate, logEntryLine, shortAddr, truncateTweet, tweetLength, who,
} from './util';

/**
 * The voice. Every string the account ever publishes is built here, from
 * club.json constants plus numbers that came from the chain or the API.
 * No template hardcodes a class, a price list, or a date.
 */

const AP = 'Anchor Points';

/** Rank is only printed when the club has published one. Never computed here. */
const classLine = (y: Yacht): string => {
  const parts = [y.class, `${y.anchorPointsPerDay} ${AP}/day`];
  if (y.rarityRank != null) parts.push(`rank ${y.rarityRank}`);
  return parts.join(' · ');
};

/** Class and rank only - what a market post needs. */
const hullLine = (y: Yacht): string =>
  y.rarityRank != null ? `${y.class} \u00b7 rank ${y.rarityRank}` : y.class;

export function claimPost(y: Yacht, blockNumber: bigint): string {
  return truncateTweet(
    [
      `Yacht #${y.id} is afloat.`,
      `Born from the burn of Normie #${y.normieId}.`,
      '',
      classLine(y),
      `Block ${fmtBlock(blockNumber)}.`,
      '',
      'The log continues. \u2693',
    ].join('\n'),
  );
}

export function salePost(
  y: Yacht,
  priceWei: bigint,
  from: { addr: string; ens: string | null },
  to: { addr: string; ens: string | null },
  blockNumber: bigint,
  marketplace: string,
  currency = 'ETH',
): string {
  return truncateTweet(
    [
      `Yacht #${y.id} changed hands.`,
      `${fmtEth(priceWei, currency)} \u00b7 ${hullLine(y)}`,
      '',
      `${who(from.addr, from.ens)} \u2192 ${who(to.addr, to.ens)}`,
      `Block ${fmtBlock(blockNumber)}${marketplace ? ` \u00b7 ${marketplace}` : ''}`,
      '',
      '\u2693',
    ].join('\n'),
  );
}

export function sweepPost(
  yachts: Yacht[],
  totalWei: bigint,
  to: { addr: string; ens: string | null },
  blockNumber: bigint,
  marketplace: string,
  currency = 'ETH',
): string {
  const ids = yachts.map((y) => `#${y.id}`).join(' ');
  return truncateTweet(
    [
      `${yachts.length}x Yacht Sweep.`,
      ids,
      `${fmtEth(totalWei, currency)} total \u00b7 ${classBreakdown(yachts.map((y) => y.class))}`,
      '',
      `\u2192 ${who(to.addr, to.ens)}`,
      `Block ${fmtBlock(blockNumber)}${marketplace ? ` \u00b7 ${marketplace}` : ''}`,
      '\u2693',
    ].join('\n'),
  );
}

export interface WatchNumbers {
  afloat: number;
  fleet: number;
  unclaimed: number;
  deltaAfloat: number | null;
  burnedFromChain: boolean;
  block: bigint;
  /** e.g. "The Reckoning Regatta, day 9 of 21" - dropped if the post would not fit. */
  regatta?: string | null;
}

export function watchPost(n: WatchNumbers, at: Date): string {
  const delta = n.deltaAfloat === null ? '' : n.deltaAfloat === 0 ? ' (unchanged)' : ` (+${fmtInt(n.deltaAfloat)})`;
  const fleetLabel = n.burnedFromChain ? 'Born from burns' : 'Fleet on record';

  const build = (season: boolean, invite: boolean): string =>
    [
      club.voice.header,
      logEntryLine(at),
      '',
      `Afloat: ${fmtInt(n.afloat)}${delta}`,
      `${fleetLabel}: ${fmtInt(n.fleet)}`,
      `Awaiting claim: ${fmtInt(n.unclaimed)}`,
      ...(season && n.regatta ? [n.regatta] : []),
      '',
      `totalMinted() at block ${fmtBlock(n.block)}.${invite ? ' Check it yourself.' : ''}`,
      '',
      club.voice.footer[0],
      club.voice.footer[1],
    ].join('\n');

  // Room is given up in this order: the invitation to check first (it is manners),
  // then the season (it is context). The numbers and the sign-off never move.
  for (const candidate of [build(true, true), build(true, false), build(false, false)]) {
    if (tweetLength(candidate) <= 272) return candidate;
  }
  return truncateTweet(build(false, false), 272);
}

const TRAIT_ORDER = ['sea', 'heading', 'sky', 'hull', 'deck', 'sailPlan', 'sailTrim', 'pennant', 'portholes', 'seabirds', 'amenities'];
const LABEL: Record<string, string> = {
  sea: 'Sea', heading: 'Heading', sky: 'Sky', hull: 'Hull', deck: 'Deck',
  sailPlan: 'Rig', sailTrim: 'Trim', pennant: 'Pennant',
  portholes: 'Portholes', seabirds: 'Seabirds', amenities: 'Amenities',
};

export function lookupReply(y: Yacht): string {
  const traits = TRAIT_ORDER
    .filter((k) => y.traits[k] !== undefined && y.traits[k] !== 0 && y.traits[k] !== '')
    .slice(0, 5)
    .map((k) => `${LABEL[k]} ${y.traits[k]}`)
    .join(' \u00b7 ');

  return truncateTweet(
    [
      `Yacht #${y.id}.`,
      classLine(y),
      `Born from Normie #${y.normieId} \u00b7 ${y.pixelCount} lit pixels`,
      '',
      traits,
      '',
      'Ownership lives on-chain. \u2693',
    ].join('\n'),
  );
}

export interface PedigreeResult {
  yachts: Yacht[];
  weight: number;
  breakdown: string;
  complete: boolean;
}

export function pedigree(yachts: Yacht[]): PedigreeResult {
  const weight = yachts.reduce((s, y) => s + (club.classes[y.class as keyof typeof club.classes]?.weight ?? 0), 0);
  return {
    yachts,
    weight,
    breakdown: classBreakdown(yachts.map((y) => y.class)),
    complete: yachts.length === club.islands.hullsPerIsland,
  };
}

export function pedigreePost(p: PedigreeResult): string {
  const weights = Object.values(club.classes).map((c) => c.weight).join('\u00b7');
  const lines = [
    `Pedigree \u00b7 ${p.yachts.length} hull${p.yachts.length === 1 ? '' : 's'}.`,
    p.breakdown,
    `Weight (${weights}): ${p.weight}`,
  ];
  if (!p.complete) {
    lines.push('', `A forge takes ${club.islands.hullsPerIsland} hulls. This set is ${p.yachts.length}.`);
  }
  if (!club.islands.gradeThresholds) {
    lines.push('', 'The club has not published grade bands, so this log names none.');
  }
  lines.push('\u2693');
  return truncateTweet(lines.join('\n'));
}

export function forgePost(yachts: Yacht[], owner: { addr: string; ens: string | null }, blockNumber: bigint): string {
  const p = pedigree(yachts);
  return truncateTweet(
    [
      'An island is forged.',
      `${yachts.length} hulls burned by ${who(owner.addr, owner.ens)}.`,
      `${p.breakdown} \u00b7 weight ${p.weight}`,
      '',
      `Fleet net ${club.islands.netSupplyChange}.`,
      `Block ${fmtBlock(blockNumber)}.`,
      '',
      'Visiting is never limited. \u2693',
    ].join('\n'),
  );
}

/** Bio for the account. Printed by `npm run cli -- verify` so it is never improvised. */
export const suggestedBio =
  `Ship's log of ${club.club.name}. Claims, sales, watches. Numbers from the chain. ` +
  `Not the official club account (${club.club.handle}). CC0.`;

export const shortAddress = shortAddr;

/* ── The Tide (module G) ──────────────────────────────────────────────────
   Every number below comes from the club's own relay, and the settle block
   and hash make a round checkable by anyone who can read a block explorer. */

const PRIZE_LABEL: Record<string, string> = {
  'forging-slot': 'a forging slot',
  'tide-mark': 'a Tide Mark',
  naming: 'a naming right',
  berth: 'a berth',
  yacht: 'a yacht bought on the open market',
};

const prizeName = (p: string): string => PRIZE_LABEL[p] ?? p.replace(/-/g, ' ');

const utcWhen = (ms: number): string => {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${logDate(d)}, ${hh}:${mm} UTC`;
};

export interface TideOpen {
  id: number; prize: string; cost: number; cap: number; floor: number;
  commits: number; hulls: number; closesAt: number;
}

export function tideOpenPost(t: TideOpen): string {
  return truncateTweet(
    [
      `The Tide \u00b7 round ${t.id} is open.`,
      `For ${prizeName(t.prize)}.`,
      '',
      `${t.cost} Anchor Points a hull \u00b7 max ${t.cap} per captain \u00b7 ${t.floor} to float the round.`,
      `Closes ${utcWhen(t.closesAt)}.`,
      '',
      'Points cannot buy better odds. \u2693',
    ].join('\n'),
  );
}

export interface TideSettled {
  id: number; prize: string; winnerId: number; winnerClass: string;
  winnerWeight: number; totalWeight: number; hulls: number;
  settleBlock: number; hash: string;
}

export function tideSettledPost(t: TideSettled): string {
  return truncateTweet(
    [
      `The Tide \u00b7 round ${t.id} is settled.`,
      `Yacht #${t.winnerId} takes ${prizeName(t.prize)}.`,
      '',
      `${t.winnerClass} \u00b7 weight ${t.winnerWeight} of ${t.totalWeight} \u00b7 ${t.hulls} hulls entered`,
      `Drawn on block ${fmtInt(t.settleBlock)}.`,
      `${t.hash.slice(0, 10)}\u2026${t.hash.slice(-6)}`,
      '',
      '\u2693',
    ].join('\n'),
  );
}

/* ── The forge (module I) ─────────────────────────────────────────────── */

export function forgeOpenPost(opensAt: number | null): string {
  const g = club.islands;
  return truncateTweet(
    [
      'The forge is open.',
      `${g.hullsPerIsland} hulls \u2192 1 island. Fleet net ${g.netSupplyChange}.`,
      '',
      `Grades: ${g.grades.join(' \u00b7 ')}.`,
      'It never closes again, and visiting is never limited.',
      '',
      opensAt ? `Opened ${utcWhen(opensAt)}. \u2693` : '\u2693',
    ].join('\n'),
  );
}
