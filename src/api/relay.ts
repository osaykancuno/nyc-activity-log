import { config } from '../config';
import { log } from '../logger';

const l = log('relay');

/**
 * The club's own relay - the off-chain half of the club (Chandlery, Regatta,
 * forge phase, islands). It is the same public, CORS-open service the marina
 * itself reads. The Tide it used to serve was retired in October 2026; its
 * routes stay readable as history and this log no longer reads them.
 *
 * PRIVACY. Three of its routes are keyed by wallet:
 *     /regatta/leaderboard   /chandlery/{wallet}   /logbook/captain/{wallet}
 * This bot never calls them. The club does not publish holder lists and neither
 * does its log. Everything below is fleet-wide or hull-keyed.
 *
 * Be kind to it: one small Fly machine serves the whole marina. Everything here
 * is cached, and nothing polls faster than the minutes set in config.
 */

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

/**
 * One forged island, from /islands. That route also carries `owner`; it is
 * ownerOf on a public token, but this log names the captain from the forge
 * transaction itself and never from a register, so it is not typed here.
 */
export interface IslandRecord {
  islandId: number | string;
  plot: number;
  /** Null means the club could not establish it just then - never that the island has none. */
  grade: string | null;
  score: number | null;
  residents: number | null;
  services: number | null;
  /** Anchor Points the island earns a day. Published by the club from ~15 Sep 2026. */
  anchorPointsPerDay?: number | null;
  awake: boolean | null;
  /** Chosen by its holder once it is awake: 24 characters, no links. Null until then. */
  name?: string | null;
}

/** What waking one island costs: its grade score x 100 AP, paid once. */
export interface IslandActivation {
  islandId: string;
  awake: boolean;
  score: number | null;
  band: string | null;
  /** What waking it WILL cost, while it sleeps. */
  price?: number | null;
  /** What it DID cost: the route swaps the field once the island is awake. */
  pricePaid?: number | null;
  currency: string | null;
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
    /**
     * What the Tide used to draw now goes here (from Oct 2026): one yacht from
     * the club's prize wallet to each division title, only in a division with
     * at least `minCaptains` captains on its final board.
     */
    prize?: { kind: string; minCaptains: number; to: string } | null;
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

export const getForge = () => get<Forge>('/forge', 5 * 60_000);
export const getRelayStats = () => get<RelayStats>('/stats', 60_000);
export const getChandlery = () => get<ChandleryCatalog>('/chandlery', 6 * 60 * 60_000);
export const getRegatta = () => get<RegattaSeason>('/regatta', 30 * 60_000);
/** Read right after a forge, when the island may not be graded yet - so the cache is short. */
export const getIslands = () => get<{ islands: IslandRecord[]; idBase: number }>('/islands', 30_000);
export const getActivation = (islandId: number) => get<IslandActivation>(`/activation/${islandId}`, 30_000);

/** Is the relay answering at all? Used by preflight. */
export async function relayHealth(): Promise<string | null> {
  try {
    const res = await fetch(`${config.relayUrl}/health`, { headers: { accept: 'text/plain' } });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}
