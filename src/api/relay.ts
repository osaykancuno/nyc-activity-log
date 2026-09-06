import { config } from '../config';
import { log } from '../logger';

const l = log('relay');

/**
 * The club's own relay - the off-chain half of the club (Tide, Chandlery,
 * Regatta, forge phase). It is the same public, CORS-open service the marina
 * itself reads, and it is the "public source" this log was waiting for before
 * switching the Tide module on.
 *
 * PRIVACY. Three of its routes are keyed by wallet:
 *     /regatta/leaderboard   /chandlery/{wallet}   /logbook/captain/{wallet}
 * This bot never calls them. The club does not publish holder lists and neither
 * does its log. Everything below is fleet-wide or hull-keyed.
 *
 * Be kind to it: one small Fly machine serves the whole marina. Everything here
 * is cached, and nothing polls faster than the minutes set in config.
 */

/**
 * One winner of a round. The relay publishes an array of these now, because a
 * round hands out two prizes instead of one once enough captains enter.
 */
export interface TideWinner {
  yachtId: string;
  weight: number;
  /** The number the draw landed on, out of poolWeight. Absent on older rounds. */
  draw?: number | null;
  /**
   * The pool this hull was drawn from - and NOT the weight of the whole entered
   * fleet. A captain who wins leaves the pool with every yacht they entered, so
   * a second prize is drawn from a smaller pool than the first. Printing the
   * fleet total against a second winner would state a draw that never happened.
   */
  poolWeight?: number | null;
  granted?: boolean | null;
}

export interface TideRound {
  id: number;
  prize: string;
  /** Set when the announced prize changed after the round was announced. */
  prizeWas: string | null;
  cost: number;
  cap: number;
  /** The minimum CAPTAINS for a round to be drawn at all. Never a hull count. */
  floor: number;
  watermark: number;
  committed: number;
  commits: number;
  /** Captains entered. The club counts captains; yachts only carry weight. */
  captains: number | null;
  fleet: { yachtId: string; weight: number }[];
  closesAt: number;
  closed: boolean;
  callable: boolean;
  earlyCall: boolean | null;
  calledBlock: number | null;
  settleBlock: number | null;
  hash: string | null;
  /** The old single winner. Still sent for a one-prize round; `winners` is the truth. */
  winner: { yachtId: string; weight: number } | null;
  winners: TideWinner[] | null;
  winnersGranted: number | null;
  /** Captain counts that add a further prize, e.g. [30]. */
  winnerAt: number[] | null;
  /** What winnerAt counts - "wallets" today. */
  winnerAtCounts: string | null;
  /** The ceiling on prizes for this round. */
  maxWinners: number | null;
  settledAt: number | null;
  prizeGranted: boolean | null;
  next: string | null;
}

export interface Tide {
  round: TideRound | null;
  /**
   * No NFT in the club's prize wallet means no round opens at all: the Tide
   * waits rather than take points for a prize that does not exist.
   */
  dormant: boolean | null;
  /** How many prizes are waiting in the pot. */
  potCount: number | null;
  history: TideRound[];
}

/**
 * One day of the free draw. Only the most recent one carries the block and the
 * hash it was drawn on, which is what makes a mark checkable.
 */
export interface DailyDraw {
  day: string;
  entries: number;
  /** Null when the draw marked nobody. It happens, and the relay says so plainly. */
  yachtId: string | null;
  block: number | null;
  hash: string | null;
  at: number | null;
}

export interface DailyTide {
  tide: {
    day: string;
    entries: number;
    entered: boolean;
    closesAt: number;
    minHoldBlocks: number;
    settling: boolean;
    settleBlock: number | null;
    /** Yesterday's draw - the only one published with its block and hash. */
    last: DailyDraw | null;
    /** Marks in the register since it opened. A mark is permanent. */
    marks: number;
    /** Recent days, without the block or the hash. */
    history: { day: string; yachtId: string | null; entries: number }[];
  } | null;
}

export interface Forge {
  phase: 'announced' | 'open' | 'closed' | string;
  window: { opensAt: number | null; headStartEndsAt: number | null; hours: number } | null;
  forgingEnds: number | null;
  /** How much warning the club gives before the window opens. */
  noticeHours: number | null;
  slots: number;
  forged: number;
  holds: boolean;
  /** The forge's own slot record. Shape is the relay's; this log does not read it. */
  slot: unknown;
}

export interface RelayStats { afloat: number; members: number; yachts: number; at: number }

export interface ChandleryCatalog {
  catalog: Record<string, { price: number; kind: string; allowed: string[] | null; oneTime: boolean }>;
}

/**
 * The season. `/regatta` also returns a `hall` of past champions, and every row
 * of it names a wallet - so it is deliberately not typed here and never read.
 * The club publishes no holder data and neither does its log.
 */
export interface RegattaSeason {
  season: {
    id: number; name: string; status: string; day: number; days: number;
    startAt: number | null; endAt: number; nextSeasonAt: number | null;
    divisions: { key: string; name: string; min: number; max: number | null }[] | null;
    cupMode: string | null;
    presenceMode: string | null;
    inMuster: boolean | null;
    inviteSeason: number | null;
  } | null;
}

const cache = new Map<string, { at: number; data: unknown }>();

/** Wallet-keyed routes. Calling one would turn this log into a holder feed. */
const FORBIDDEN = [/^\/regatta\/leaderboard/, /^\/chandlery\/0x/i, /^\/logbook\/captain\//i];

async function get<T>(path: string, ttlMs: number): Promise<T | null> {
  if (FORBIDDEN.some((re) => re.test(path))) {
    throw new Error(`refusing to read ${path}: wallet-keyed, and this log publishes no holder data`);
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${config.relayUrl}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'nyc-activity-log (CC0 community log)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = (await res.json()) as T;
    cache.set(path, { at: Date.now(), data });
    return data;
  } catch (e) {
    l.warn(`relay ${path} unavailable`, e);
    return hit ? (hit.data as T) : null; // stale beats silence; null means we say nothing
  }
}

export const getTide = () => get<Tide>('/tide', 60_000);
/** The free daily draw. It moves once a day, so it is read gently. */
export const getDailyTide = () => get<DailyTide>('/tide/daily', 5 * 60_000);
export const getForge = () => get<Forge>('/forge', 5 * 60_000);
export const getRelayStats = () => get<RelayStats>('/stats', 60_000);
export const getChandlery = () => get<ChandleryCatalog>('/chandlery', 6 * 60 * 60_000);
export const getRegatta = () => get<RegattaSeason>('/regatta', 30 * 60_000);

/** Is the relay answering at all? Used by preflight. */
export async function relayHealth(): Promise<string | null> {
  try {
    const res = await fetch(`${config.relayUrl}/health`, { headers: { accept: 'text/plain' } });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}
