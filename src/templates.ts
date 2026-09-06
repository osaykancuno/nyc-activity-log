import { club, yoko } from './config';
import type { Yacht } from './api/nyc';
import {
  classBreakdown, fmtBlock, fmtEth, fmtInt, grade, logDate, logEntryLine, shortAddr, truncateTweet, tweetLength, who,
} from './util';

/**
 * The voice. Every string the account ever publishes is built here, from
 * club.json constants plus numbers that came from the chain or the API.
 * No template hardcodes a class, a price list, or a date.
 */

const AP = 'Anchor Points';

/** Rank is only printed when the club has published one. Never computed here. */
const classLine = (y: Yacht): string => {
  const parts = [grade(y), `${y.anchorPointsPerDay} ${AP}/day`];
  if (y.rarityRank != null) parts.push(`rank ${y.rarityRank}`);
  return parts.join(' · ');
};

/** Class and rank only - what a market post needs. */
const hullLine = (y: Yacht): string =>
  y.rarityRank != null ? `${grade(y)} \u00b7 rank ${y.rarityRank}` : grade(y);

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
      `Yacht #${y.id} sold.`,
      `${fmtEth(priceWei, currency)} \u00b7 ${hullLine(y)}`,
      '',
      `${who(from.addr, from.ens)} \u2192 ${who(to.addr, to.ens)}`,
      `Block ${fmtBlock(blockNumber)}${marketplace ? ` \u00b7 ${marketplace}` : ''}`,
      '',
      '\u2693',
    ].join('\n'),
  );
}

/**
 * A sweep. The hull ids, the count and the total all come from the receipt, so
 * they are printed whatever the metadata did: `yachts` may be short of `ids`
 * when the club API could not be read for one of them, and the class breakdown
 * is then dropped rather than published half true.
 *
 * A whale can take twenty hulls in one transaction, and twenty ids do fit - but
 * the list is what gives ground first if a bigger one ever comes.
 */
export function sweepPost(
  ids: number[],
  yachts: Yacht[],
  totalWei: bigint,
  to: { addr: string; ens: string | null },
  blockNumber: bigint,
  marketplace: string,
  currency = 'ETH',
): string {
  const complete = yachts.length === ids.length && yachts.length > 0;
  const priceLine = complete
    ? `${fmtEth(totalWei, currency)} total \u00b7 ${classBreakdown(yachts.map(grade))}`
    : `${fmtEth(totalWei, currency)} total`;

  const build = (shownIds: number): string => {
    const shown = ids.slice(0, shownIds);
    const rest = ids.length - shown.length;
    return [
      `${fmtInt(ids.length)}x Yacht Sweep.`,
      shown.map((i) => `#${i}`).join(' ') + (rest > 0 ? ` +${rest} more` : ''),
      priceLine,
      '',
      `\u2192 ${who(to.addr, to.ens)}`,
      `Block ${fmtBlock(blockNumber)}${marketplace ? ` \u00b7 ${marketplace}` : ''}`,
      '\u2693',
    ].join('\n');
  };

  for (let shown = ids.length; shown >= 4; shown--) {
    const candidate = build(shown);
    if (tweetLength(candidate) <= 272) return candidate;
  }
  return truncateTweet(build(4));
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
  /** Blocks since the previous watch. Null on the first watch of a new state file. */
  blocksSince?: bigint | null;
}

/**
 * The watch, twice a day, whatever happened.
 *
 * It used to stay silent when the numbers had not moved, which kept the log
 * honest and also made it disappear for days at a time. It posts either way
 * now - but a still watch is written as a different post, not the same one
 * again, because leading with three unchanged figures is what made it read as
 * a repeat.
 *
 * The honest difference is that something did move: the chain. A still watch
 * leads with how far it went, which is a number nobody has seen before and one
 * anyone can check.
 */
export function watchPost(n: WatchNumbers, at: Date): string {
  const still = n.deltaAfloat === 0 && n.fleet > 0 && n.blocksSince != null && n.blocksSince > 0n;
  return still ? stillWatch(n, at) : movingWatch(n, at);
}

function movingWatch(n: WatchNumbers, at: Date): string {
  const delta = n.deltaAfloat === null ? '' : n.deltaAfloat === 0 ? '' : ` (+${fmtInt(n.deltaAfloat)})`;
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

/** Nothing changed hands. Say what did, and say the standing figures once. */
function stillWatch(n: WatchNumbers, at: Date): string {
  const build = (season: boolean, invite: boolean): string =>
    [
      club.voice.header,
      logEntryLine(at),
      '',
      `No Yacht moved in ${fmtBlock(n.blocksSince!)} blocks.`,
      `Afloat ${fmtInt(n.afloat)} \u00b7 awaiting claim ${fmtInt(n.unclaimed)}`,
      ...(season && n.regatta ? [n.regatta] : []),
      '',
      `Read at block ${fmtBlock(n.block)}.${invite ? ' Check it yourself.' : ''}`,
      '',
      club.voice.footer[0],
      club.voice.footer[1],
    ].join('\n');

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
  // A Commodore weighs 12 where a Superyacht weighs 5: grade the hull, never read its class.
  const weight = yachts.reduce((s, y) => s + (club.classes[grade(y)]?.weight ?? 0), 0);
  return {
    yachts,
    weight,
    breakdown: classBreakdown(yachts.map(grade)),
    complete: yachts.length === club.islands.hullsPerIsland,
  };
}

export function pedigreePost(p: PedigreeResult): string {
  const weights = Object.values(club.classes).map((c) => c.weight).join('\u00b7');
  const lines = [
    `Pedigree \u00b7 ${p.yachts.length} Yacht${p.yachts.length === 1 ? '' : 's'}.`,
    p.breakdown,
    `Weight (${weights}): ${p.weight}`,
  ];
  if (!p.complete) {
    lines.push('', `A forge takes ${club.islands.hullsPerIsland} Yachts. This set is ${p.yachts.length}.`);
  }
  if (!club.islands.gradeThresholds) {
    lines.push('', 'The club has not published grade bands, so this log names none.');
  }
  lines.push('\u2693');
  return truncateTweet(lines.join('\n'));
}

export function forgePost(
  ids: number[],
  yachts: Yacht[],
  owner: { addr: string; ens: string | null },
  blockNumber: bigint,
): string {
  const p = pedigree(yachts);
  const complete = yachts.length === ids.length && yachts.length > 0;
  return truncateTweet(
    [
      'An island is forged.',
      `${ids.length} Yachts burned by ${who(owner.addr, owner.ens)}.`,
      // Weight is a sum. Publishing it a hull short would understate it.
      ...(complete ? [`${p.breakdown} \u00b7 weight ${p.weight}`] : []),
      '',
      `Fleet net ${club.islands.netSupplyChange}.`,
      `Block ${fmtBlock(blockNumber)}.`,
      '',
      'Visiting is never limited. \u2693',
    ].join('\n'),
  );
}

/**
 * Bio for the account. Printed by `npm run cli -- verify` so it is never
 * improvised - and it names the keeper, because the account does now too.
 * It says official because it is: the label on X names the club as the manager.
 * X allows 160 characters; `verify` prints the count so it is never guessed.
 */
export const suggestedBio =
  `Official ship's log of ${club.club.name}, kept by ${yoko.agent.name} — Normie #${yoko.agent.tokenId}. ` +
  `Claims, sales, watches. Every number verifiable on-chain. CC0.`;

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
  commits: number; hulls: number; captains: number | null; closesAt: number;
  /** The captain count that adds a further prize, and the ceiling on prizes. */
  extraAt: number | null; maxPrizes: number | null;
}

/**
 * The floor is CAPTAINS, not hulls: a round needs three of them to be drawn at
 * all, and one captain entering three yachts does not float it. This used to
 * print the figure bare, next to a line about yachts, which read as three hulls.
 */
export function tideOpenPost(t: TideOpen): string {
  const extra = t.extraAt != null && (t.maxPrizes ?? 1) > 1
    ? `${fmtInt(t.maxPrizes!)} prizes if ${fmtInt(t.extraAt)} captains enter.`
    : null;

  const build = (withExtra: boolean): string =>
    [
      `The Tide \u00b7 round ${t.id} is open.`,
      `For ${prizeName(t.prize)}.`,
      '',
      `${t.cost} Anchor Points a Yacht \u00b7 max ${t.cap} per captain \u00b7 ${t.floor} captains to float the round.`,
      ...(withExtra && extra ? [extra] : []),
      `Closes ${utcWhen(t.closesAt)}.`,
      '',
      'Points cannot buy better odds. \u2693',
    ].join('\n');

  for (const candidate of [build(true), build(false)]) {
    if (tweetLength(candidate) <= 272) return candidate;
  }
  return truncateTweet(build(false));
}

export interface TideWinnerLine {
  id: number;
  yachtClass: string;
  weight: number;
  /**
   * The pool this hull was drawn from. A winning captain leaves the pool with
   * every yacht they entered, so a second prize is drawn from a smaller pool -
   * printing the whole fleet against it would describe a draw that never ran.
   */
  pool: number;
}

export interface TideSettled {
  id: number; prize: string; winners: TideWinnerLine[];
  hulls: number; captains: number | null;
  settleBlock: number; hash: string;
}

/** One post for the whole round, however many prizes it handed out. */
export function tideSettledPost(t: TideSettled): string {
  const first = t.winners[0]!;
  const many = t.winners.length > 1;
  const shortHash = t.hash ? `${t.hash.slice(0, 10)}\u2026${t.hash.slice(-6)}` : '';

  const headline = many
    ? `${fmtInt(t.winners.length)} prizes, each ${prizeName(t.prize)}.`
    : `Yacht #${first.id} takes ${prizeName(t.prize)}.`;

  const drawn = many
    ? t.winners.map((w) => `Yacht #${w.id} \u00b7 ${w.yachtClass} \u00b7 weight ${w.weight} of ${w.pool}`)
    : [`${first.yachtClass} \u00b7 weight ${first.weight} of ${first.pool}`];

  // Captains are what the club counts. Hulls are only what they carried in.
  const entered = t.captains != null
    ? `${fmtInt(t.hulls)} Yachts from ${fmtInt(t.captains)} captains`
    : `${fmtInt(t.hulls)} Yachts entered`;

  const build = (withEntered: boolean, withHash: boolean): string =>
    [
      `The Tide \u00b7 round ${t.id} is settled.`,
      headline,
      '',
      ...drawn,
      ...(withEntered ? [entered] : []),
      `Drawn on block ${fmtInt(t.settleBlock)}.`,
      ...(withHash && shortHash ? [shortHash] : []),
      '',
      '\u2693',
    ].join('\n');

  // The hash is the last thing given up: it is what makes the draw checkable.
  for (const candidate of [build(true, true), build(false, true), build(false, false)]) {
    if (tweetLength(candidate) <= 272) return candidate;
  }
  return truncateTweet(build(false, false));
}

/* ── The forge (module I) ─────────────────────────────────────────────── */

export function forgeOpenPost(opensAt: number | null): string {
  const g = club.islands;
  return truncateTweet(
    [
      'The forge is open.',
      `${g.hullsPerIsland} Yachts \u2192 1 island. Fleet net ${g.netSupplyChange}.`,
      '',
      `Grades: ${g.grades.join(' \u00b7 ')}.`,
      'It never closes again, and visiting is never limited.',
      '',
      opensAt ? `Opened ${utcWhen(opensAt)}. \u2693` : '\u2693',
    ].join('\n'),
  );
}
