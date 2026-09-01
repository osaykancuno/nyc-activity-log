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
  lastWatch: { at: string; afloat: number; fleet: number; unclaimed: number } | null;
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
  tides: number;
  forges: number;
  lastEntryDay: string | null;
  recent: string[];
}

const RECENT_KEPT = 8;

const emptyJournal = (day: string | null): Journal => ({
  day, claims: 0, moved: 0, tides: 0, forges: 0, lastEntryDay: null, recent: [],
});

const DIR = config.paths.state;
const LEDGER = resolve(DIR, 'posted.jsonl');
const STATE = resolve(DIR, 'state.json');

const seen = new Set<string>();
let state: State = {
  lastBlock: null, mentionSinceId: null, monthKey: null, monthCount: 0, monthUsd: 0,
  lastWatch: null, journal: emptyJournal(null), startedAt: new Date().toISOString(),
};

export function initStore(): void {
  mkdirSync(DIR, { recursive: true });
  if (existsSync(LEDGER)) {
    let rows = 0;
    for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { seen.add(JSON.parse(line).k); rows++; } catch { /* skip torn line */ }
    }
    l.info(`ledger loaded: ${rows} entries`);
  }
  if (existsSync(STATE)) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(STATE, 'utf8')) };
      state.journal = { ...emptyJournal(null), ...(state.journal ?? {}) };
    } catch (e) { l.warn('state unreadable, starting fresh', e); }
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

/** A new UTC day wipes the counters. Yoko's entry closes the old one first. */
function rollJournalDay(): void {
  const day = utcDay();
  if (state.journal.day !== day) {
    state.journal = { ...emptyJournal(day), lastEntryDay: state.journal.lastEntryDay, recent: state.journal.recent };
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

/** The entry is written: remember the lines used and stop the day. */
export function closeJournalDay(used: string[]): void {
  rollJournalDay();
  state.journal.lastEntryDay = state.journal.day;
  state.journal.recent = [...used, ...state.journal.recent.filter((r) => !used.includes(r))].slice(0, RECENT_KEPT);
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

export function countPost(costUsd = config.costPerPostUsd): void {
  rollMonth();
  state.monthCount += 1;
  state.monthUsd = Math.round((state.monthUsd + costUsd) * 1000) / 1000;
  persistState();
}
