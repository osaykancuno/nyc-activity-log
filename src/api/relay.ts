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

export interface TideRound {
  id: number;
  prize: string;
  cost: number;
  cap: number;
  floor: number;
  watermark: number;
  committed: number;
  commits: number;
  fleet: { yachtId: string; weight: number }[];
  closesAt: number;
  closed: boolean;
  callable: boolean;
  calledBlock: number | null;
  settleBlock: number | null;
  hash: string | null;
  winner: { yachtId: string; weight: number } | null;
  settledAt: number | null;
  prizeGranted: boolean | null;
  next: string | null;
}

export interface Tide { round: TideRound | null; history: TideRound[] }

export interface Forge {
  phase: 'announced' | 'open' | 'closed' | string;
  window: { opensAt: number | null; headStartEndsAt: number | null; hours: number } | null;
  forgingEnds: number | null;
  slots: number;
  forged: number;
  holds: boolean;
}

export interface RelayStats { afloat: number; members: number; yachts: number; at: number }

export interface ChandleryCatalog {
  catalog: Record<string, { price: number; kind: string; allowed: string[] | null; oneTime: boolean }>;
}

export interface RegattaSeason {
  season: { id: number; name: string; status: string; day: number; days: number; endAt: number } | null;
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
