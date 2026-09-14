import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config';
import { log } from './logger';

const l = log('store');

/**
 * Append-only JSONL dedup ledger + a small JSON state file.
 *
 * Why not SQLite: better-sqlite3 needs a native build that breaks on fresh
 * Node releases and on some hosts. Volume here is a few thousand rows a year.
 * The interface below is the only thing a Postgres swap has to satisfy.
 */

export interface State {
  lastBlock: string | null;      // bigint as string
  mentionSinceId: string | null;
  monthKey: string | null;       // "2026-09"
  monthCount: number;
  monthUsd: number;
  lastWatch: { at: string; afloat: number; fleet: number; unclaimed: number; block?: string } | null;
  journal: Journal;
  startedAt: string;
}

/**
 * What Yoko has seen today, and what she has already said.
 * The tally is the day's shape; `recent` is the short memory that keeps her
 * from opening two entries in a row with the same sentence.
 */
export interface Journal {
  /** UTC day the tally belongs to, "2026-09-01". */
  day: string | null;
  claims: number;
  moved: number;
  /** Both clocks of the Tide: rounds settled and daily marks alike. */
  tides: number;
  forges: number;
  lastEntryDay: string | null;
  recent: string[];
}

const RECENT_KEPT = 8;

const emptyJournal = (day: string | null): Journal => ({
  day, claims: 0, moved: 0, tides: 0, forges: 0, lastEntryDay: null, recent: [],
});

let DIR = config.paths.state;
let LEDGER = resolve(DIR, 'posted.jsonl');
let STATE = resolve(DIR, 'state.json');

const seen = new Set<string>();
let state: State = {
  lastBlock: null, mentionSinceId: null, monthKey: null, monthCount: 0, monthUsd: 0,
  lastWatch: null, journal: emptyJournal(null), startedAt: new Date().toISOString(),
};

/**
 * The mount point that holds `dir`, read from /proc/mounts. Null off Linux.
 *
 * On 14 Sep 2026 the log was found writing its state to /app/data/state, inside
 * the container: the volume was mounted, just not under STATE_DIR, so every
 * deploy started with an empty ledger and "The forge is open" went out three
 * times in two hours. The boot log said nothing, because a missing ledger was
 * not worth a line.
 */
function mountOf(dir: string): string | null {
  try {
    const points = readFileSync('/proc/mounts', 'utf8').split('\n')
      .map((line) => line.split(' ')[1]?.replace(/\\040/g, ' '))
      .filter((p): p is string => !!p);
    return points
      .filter((p) => p === '/' || dir === p || dir.startsWith(`${p}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Longer than the widest normal gap between two posts (the 19:00 UTC entry to
 * the 07:00 UTC watch is 12 hours). A ledger whose newest line is older than
 * this was not being written to - it is the one left on a volume the log had
 * stopped using, and it knows nothing about what went out since.
 */
const STALE_MS = 18 * 60 * 60 * 1000;

export function initStore(): void {
  // Railway names its own volume. If STATE_DIR points off it, the volume is the
  // right answer and the setting is the mistake: use the volume and say so.
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volume && mountOf(DIR) === '/' && mountOf(volume) === volume) {
    const onVolume = resolve(volume, 'state');
    l.warn(`STATE_DIR ${DIR} is not on the volume - using ${onVolume} instead. Set STATE_DIR=${onVolume} (or delete it) to silence this.`);
    DIR = onVolume;
    LEDGER = resolve(DIR, 'posted.jsonl');
    STATE = resolve(DIR, 'state.json');
  }

  mkdirSync(DIR, { recursive: true });

  const mount = mountOf(DIR);
  if (mount === '/') {
    l.error(`state in ${DIR} is NOT on a volume - every deploy forgets the ledger, the cursor and the budget. Mount a volume and point STATE_DIR inside it.`);
  } else if (mount) {
    l.info(`state in ${DIR}, on the volume mounted at ${mount}`);
  }

  let rows = 0;
  let newest = 0;
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { k: string; t?: string };
        seen.add(row.k);
        rows++;
        const t = row.t ? Date.parse(row.t) : NaN;
        if (Number.isFinite(t) && t > newest) newest = t;
      } catch { /* skip torn line */ }
    }
  }
  // Said either way: an empty ledger on a log that has been live for weeks is
  // the one line that would have caught the volume.
  if (rows) l.info(`ledger loaded: ${rows} entries, newest ${newest ? new Date(newest).toISOString() : 'undated'}`);
  else l.warn(`ledger is empty (${LEDGER}) - fine on a first boot, a lost volume on any other`);

  if (existsSync(STATE)) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(STATE, 'utf8')) };
      state.journal = { ...emptyJournal(null), ...(state.journal ?? {}) };
    } catch (e) { l.warn('state unreadable, starting fresh', e); }
  }

  // A stale ledger is worse than an empty one: it has the old keys but not the
  // posts made since, so the Tide would announce a round already announced and
  // the watcher would replay days of blocks. Treat it as a first look instead -
  // every module seeds silently - and keep only what cannot repeat a post.
  if (rows && newest && Date.now() - newest > STALE_MS) {
    l.warn(`ledger is stale (newest line ${new Date(newest).toISOString()}) - starting from the chain head and re-seeding the Tide, so nothing is posted twice`);
    for (const k of ['tide:seeded', 'tide:daily:seeded']) seen.delete(k);
    state.lastBlock = null;
    state.lastWatch = null;
    persistState();
  }
  rollMonth();
}

function persistState(): void {
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE);
}

/** Dedup key, e.g. "sale:0xabc\u2026:1709". Restart-safe by construction. */
export const alreadyPosted = (key: string): boolean => seen.has(key);

export function markPosted(key: string, meta: Record<string, unknown> = {}): void {
  if (seen.has(key)) return;
  seen.add(key);
  appendFileSync(LEDGER, `${JSON.stringify({ k: key, t: new Date().toISOString(), ...meta })}\n`);
}

export const getState = (): Readonly<State> => state;

export function setLastBlock(b: bigint): void {
  state.lastBlock = b.toString();
  persistState();
}

export function setMentionSinceId(id: string): void {
  state.mentionSinceId = id;
  persistState();
}

export function setLastWatch(w: State['lastWatch']): void {
  state.lastWatch = w;
  persistState();
}

/* ── Module J: the day's tally ──────────────────────────────────── */

const utcDay = (d = new Date()): string => d.toISOString().slice(0, 10);

/*
 * The tally covers everything since Yoko last wrote, not a UTC calendar day.
 *
 * It used to reset at UTC midnight, which was fine while she wrote at 21:45
 * UTC. Writing at 21:00 European time means 19:00 UTC in summer, and a
 * calendar reset would have quietly dropped the last five hours of every day
 * out of the page that claims to describe it. "Since the last entry" needs no
 * timezone at all, and is what a diary means anyway.
 */
function rollJournalDay(): void {
  if (state.journal.day === null) {
    state.journal.day = utcDay();
    persistState();
  }
}

/**
 * One published post, one mark in the day's tally. Called from the poster, so
 * a post dropped by the budget never becomes a line Yoko claims to have seen.
 */
export function noteActivity(kind: string): void {
  rollJournalDay();
  const j = state.journal;
  if (kind === 'claim') j.claims += 1;
  else if (kind === 'sale' || kind === 'sweep') j.moved += 1;
  else if (kind.startsWith('tide')) j.tides += 1;
  else if (kind.startsWith('forge')) j.forges += 1;
  else return; // watch, lookup and Yoko's own entry are not part of the day's shape
  persistState();
}

export function getJournal(): Readonly<Journal> {
  rollJournalDay();
  return state.journal;
}

/** The entry is written: remember the lines used and start the count again. */
export function closeJournalDay(used: string[]): void {
  const today = utcDay();
  state.journal = {
    ...emptyJournal(today),
    lastEntryDay: today,
    recent: [...used, ...state.journal.recent.filter((r) => !used.includes(r))].slice(0, RECENT_KEPT),
  };
  persistState();
}

function rollMonth(): void {
  const key = new Date().toISOString().slice(0, 7);
  if (state.monthKey !== key) {
    state.monthKey = key;
    state.monthCount = 0;
    state.monthUsd = 0;
    persistState();
  }
}

/**
 * The monthly ceiling, in money and in posts.
 * X bills per request now, so the real limit is a bill and not a quota - but the
 * post count stays as a second fence in case a price moves underneath us.
 */
export function budget(): { used: number; max: number; left: number; usedUsd: number; maxUsd: number; leftUsd: number } {
  rollMonth();
  return {
    used: state.monthCount,
    max: config.maxPostsPerMonth,
    left: config.maxPostsPerMonth - state.monthCount,
    usedUsd: state.monthUsd,
    maxUsd: config.monthlyBudgetUsd,
    leftUsd: Math.round((config.monthlyBudgetUsd - state.monthUsd) * 1000) / 1000,
  };
}

/**
 * How many posts the money actually allows, which is not MAX_POSTS_PER_MONTH.
 * At $5 and $0.015 a post the wall is 333, so the post count is the second
 * fence and never the first - worth printing so a busy month is not a surprise.
 */
export const effectiveCeiling = (): { posts: number; boundBy: 'money' | 'count' } => {
  const byMoney = Math.floor(config.monthlyBudgetUsd / config.costPerPostUsd);
  return byMoney <= config.maxPostsPerMonth
    ? { posts: byMoney, boundBy: 'money' }
    : { posts: config.maxPostsPerMonth, boundBy: 'count' };
};

export function countPost(costUsd = config.costPerPostUsd): void {
  rollMonth();
  state.monthCount += 1;
  state.monthUsd = Math.round((state.monthUsd + costUsd) * 1000) / 1000;
  persistState();
}
