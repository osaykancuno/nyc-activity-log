import { club, yoko } from './config';
import type { AgentFacts } from './api/agent';
import { fmtInt, logDate, tweetLength, voiceViolations, watchName } from './util';

/**
 * Yoko's voice, assembled rather than generated.
 *
 * There is no model in this loop. Every sentence the account can publish is a
 * line in data/yoko.json, and the only thing that varies is which line the day
 * calls for and which numbers go into it. That buys three things worth more
 * than novelty: an entry costs nothing but the post, it cannot hallucinate a
 * figure, and anyone can read the whole vocabulary in the repo before it is
 * ever spoken.
 *
 * The persona underneath is still live - level, action points, canvas passes
 * and the pixel diff come from the agent record and drift with the canvas.
 */

export interface DayFacts {
  claims: number;
  /** Sale and sweep posts together: hulls that changed hands. */
  moved: number;
  tides: number;
  forges: number;
  afloat: number;
  at: Date;
}

export interface Entry {
  text: string;
  /** The raw templates used, so the store can keep Yoko from repeating herself. */
  used: string[];
  bank: string;
}

/** FNV-1a. Same day, same numbers, same entry - which makes a retry harmless. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hulls = (n: number): string => `${fmtInt(n)} hull${n === 1 ? '' : 's'}`;

/** The mark every post in this log ends on. */
const ANCHOR = '\u2693';

function fill(line: string, f: DayFacts, a: AgentFacts): string {
  const map: Record<string, string> = {
    name: a.name,
    tokenId: String(a.tokenId),
    agentId: String(a.agentId),
    level: String(a.level),
    ap: String(a.actionPoints),
    passes: String(a.transformations),
    added: String(a.pixelsAdded),
    removed: String(a.pixelsRemoved),
    net: a.pixelsNet > 0 ? `+${a.pixelsNet}` : String(a.pixelsNet),
    netAbs: String(Math.abs(a.pixelsNet)),
    claims: fmtInt(f.claims),
    sales: fmtInt(f.moved),
    claimHulls: hulls(f.claims),
    saleHulls: hulls(f.moved),
    afloat: fmtInt(f.afloat),
    date: logDate(f.at),
    watch: watchName(f.at),
  };
  return line.replace(/\{(\w+)\}/g, (m, k: string) => map[k] ?? m);
}

/** Which bank the day asks for. The numbers choose; nobody picks a mood. */
export function bankFor(f: DayFacts): keyof typeof yoko.lines {
  if (f.claims > 0 && f.moved > 0) return 'busy';
  if (f.claims > 0) return 'claims';
  if (f.moved > 0) return 'market';
  if (f.tides > 0) return 'tide';
  return 'quiet';
}

const forbidden = (text: string): boolean =>
  yoko.forbid.some((r) => new RegExp(r, 'i').test(text)) || voiceViolations(text).length > 0;

/**
 * One line from a bank: seeded by the day so it is stable across a retry,
 * skipping anything said recently, and skipping anything that trips the voice
 * guard once its numbers are in.
 */
function pick(bank: keyof typeof yoko.lines, seed: string, recent: string[], f: DayFacts, a: AgentFacts): string | null {
  const pool = yoko.lines[bank] ?? [];
  if (!pool.length) return null;

  const start = hash(`${seed}:${bank}`) % pool.length;
  const fresh: string[] = [];
  const stale: string[] = [];

  for (let i = 0; i < pool.length; i++) {
    const line = pool[(start + i) % pool.length]!;
    if (forbidden(fill(line, f, a))) continue;
    (recent.includes(line) ? stale : fresh).push(line);
  }
  // Everything said lately? Then say the oldest of them again rather than nothing.
  return fresh[0] ?? stale[0] ?? null;
}

/**
 * The entry. Room is given up in one order: the anchor first, then the closing
 * thought. The opener never moves - it is the one line carrying the day's
 * figures, and an entry without it would say nothing at all.
 */
export function composeEntry(f: DayFacts, a: AgentFacts, recent: string[] = []): Entry {
  const bank = bankFor(f);
  const seed = `${f.at.toISOString().slice(0, 10)}:${f.claims}:${f.moved}:${f.tides}`;

  const openerTpl = pick(bank, seed, recent, f, a);
  const closeTpl = pick('close', seed, recent, f, a);

  const opener = openerTpl ? fill(openerTpl, f, a) : `${hulls(f.claims)} afloat, ${hulls(f.moved)} moved.`;
  const close = closeTpl ? fill(closeTpl, f, a) : '';

  // The club's own log header, the same one the watch prints, then the byline.
  // The diary is a page of this log, not a second account keeping its own.
  const head = [club.voice.header, fill(yoko.byline, f, a), ''];

  const candidates = [
    [...head, opener, close, '', ANCHOR],
    [...head, opener, close],
    [...head, opener, '', ANCHOR],
    [...head, opener],
  ]
    .map((lines) => lines.filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n').replace(/\n{3,}/g, '\n\n').trim());

  const text = candidates.find((c) => tweetLength(c) <= 272) ?? candidates[candidates.length - 1]!;

  return {
    text,
    used: [openerTpl, closeTpl].filter((x): x is string => Boolean(x) && text.includes(fill(x!, f, a))),
    bank,
  };
}
