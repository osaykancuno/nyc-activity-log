import { club } from '../config';
import { log } from '../logger';

const l = log('api');
const BASE = club.club.api;

export interface Yacht {
  id: number;
  normieId: number;
  pixelCount: number;
  class: string;
  tier: string;
  anchorPointsPerDay: number;
  rarityRank: number | null;
  traits: Record<string, string | number>;
  art: { size: number; on: string; off: string; onPixels: number; bits: string };
  onchain?: { agent?: string };
  /** Where the facts came from. 'chain' means the club API had not published this hull yet. */
  source?: 'api' | 'chain';
}

export interface Stats {
  generatedAt: string;
  yachts: number;
  wallets: number;
  classes: Record<string, number>;
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function getJson<T>(path: string, ttl = CACHE_MS): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${BASE}${path}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json', 'user-agent': 'nyc-activity-log (CC0 community bot)' },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as T;
      cache.set(path, { at: Date.now(), data });
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  l.error(`GET ${path} failed`, lastErr);
  throw lastErr;
}

/** Yacht metadata is immutable (renderer locked) — cache it hard. */
export const getYacht = (id: number) => getJson<Yacht>(`/yacht/${id}.json`, 30 * 24 * 60 * 60 * 1000);

/** Totals are a CDN snapshot: never the sole source for the watch. */
export const getStats = (fresh = false) => getJson<Stats>('/stats.json', fresh ? 0 : 30 * 60 * 1000);

export const getTraits = () => getJson<Record<string, any>>('/traits.json');

export async function getYachts(ids: number[]): Promise<Yacht[]> {
  const out: Yacht[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    out.push(...(await Promise.all(ids.slice(i, i + 5).map((id) => getYacht(id)))));
  }
  return out;
}
