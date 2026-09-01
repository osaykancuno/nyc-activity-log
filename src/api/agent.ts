import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, yoko, type AgentSnapshot } from '../config';
import { log } from '../logger';

const l = log('agent');

/**
 * Yoko's own record on normies.art (ERC-8004 agent #32683, bound to Normie #8362).
 *
 * TRUST BOUNDARY. This service is not ours, and whatever it returns ends up on a
 * public timeline if we are careless. So it is allowed to move numbers - level,
 * action points, canvas passes, pixels - and nothing else. Its `backstory`,
 * `greeting`, `personalityTraits` and `systemPrompt` are read for nobody: every
 * sentence the account can publish is written in data/yoko.json, in this repo.
 *
 * The persona regenerates from canvas state, so the numbers really do drift -
 * burn a Normie, edit some pixels, and the entries start saying something new
 * without a deploy. That is the whole point of pulling them.
 */

export interface AgentFacts extends AgentSnapshot {
  name: string;
  tokenId: number;
  agentId: number;
  /** 'api' when the numbers are live, 'snapshot' when yoko.json had the last word. */
  source: 'api' | 'snapshot';
  readAt: string;
}

const FALLBACK: AgentFacts = {
  ...yoko.snapshot,
  name: yoko.agent.name,
  tokenId: yoko.agent.tokenId,
  agentId: yoko.agent.agentId,
  source: 'snapshot',
  readAt: 'never',
};

let cached: AgentFacts = FALLBACK;
let cachedAt = 0;

/**
 * Canvas passes are the one figure the endpoint publishes only inside its own
 * prose ("Reshaped through 5 canvas passes"). We take the digits and nothing
 * else - a bounded match on a known sentence, never the sentence itself.
 */
function passesFrom(backstory: unknown, fallback: number): number {
  if (typeof backstory !== 'string') return fallback;
  const m = backstory.match(/through (\d{1,3}) canvas pass/i);
  return m ? Number(m[1]) : fallback;
}

const int = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

async function fetchJson(url: string, ms = 12_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * The live numbers, cached for AGENT_REFRESH_H hours. Never throws: a log entry
 * is not worth skipping because someone else's CDN had a bad minute, and the
 * snapshot in yoko.json is only ever a few burns out of date.
 */
export async function getAgentFacts(force = false): Promise<AgentFacts> {
  if (!force && Date.now() - cachedAt < config.agentRefreshMs) return cached;

  try {
    const j = await fetchJson(`${config.agentApi}/info/${yoko.agent.tokenId}`);
    const c = j?.canvas ?? {};
    const d = c?.diff ?? {};

    const facts: AgentFacts = {
      name: typeof j?.name === 'string' && /^[\w .'-]{1,24}$/.test(j.name) ? j.name : yoko.agent.name,
      tokenId: int(j?.tokenId, yoko.agent.tokenId),
      agentId: int(j?.agentId, yoko.agent.agentId),
      level: int(c?.level, yoko.snapshot.level),
      actionPoints: int(c?.actionPoints, yoko.snapshot.actionPoints),
      transformations: passesFrom(j?.backstory, yoko.snapshot.transformations),
      pixelsAdded: int(d?.addedCount ?? d?.added?.length, yoko.snapshot.pixelsAdded),
      pixelsRemoved: int(d?.removedCount ?? d?.removed?.length, yoko.snapshot.pixelsRemoved),
      pixelsNet: int(d?.netChange, yoko.snapshot.pixelsNet),
      source: Number.isFinite(Number(c?.level)) ? 'api' : 'snapshot',
      readAt: new Date().toISOString(),
    };

    // A shape change upstream should cost us a stale number, never a wrong one.
    if (facts.level <= 0) facts.level = yoko.snapshot.level;

    if (cached.source === 'api' && facts.level !== cached.level) {
      l.info(`canvas level moved ${cached.level} -> ${facts.level}`);
    }
    cached = facts;
    cachedAt = Date.now();
    l.debug(`agent #${facts.agentId}: level ${facts.level}, ${facts.actionPoints} AP, net ${facts.pixelsNet} px`);
    return facts;
  } catch (e) {
    l.warn('agent API unreachable - using the snapshot in data/yoko.json', e);
    cachedAt = Date.now() - config.agentRefreshMs + 10 * 60_000; // retry in ten minutes
    return cached;
  }
}

/* ── The portrait ─────────────────────────────────────────────────────────
   Normie #8362 as a 40x40 bitmap, in exactly the format the card renderer
   already draws for hulls. Cached on the volume so a card never waits on a
   network round trip, and never blank: a missing portrait just means a card
   without a face on it. */

export interface Portrait { bits: string; on: string; off: string }

const PORTRAIT_FILE = () => resolve(config.paths.state, `normie-${yoko.agent.tokenId}.json`);

let portrait: Portrait | null = null;

/**
 * The agent art is a 40x40 grid of run-length rects on a 40-unit viewBox - the
 * same picture the club draws, at a different scale from the hull SVGs, so it
 * gets its own parser rather than bending yacht.ts out of shape.
 */
export function normieSvgToBits(svg: string): Portrait {
  const off = svg.match(/<rect width="40" height="40" fill="(#[0-9a-fA-F]{3,8})"/)?.[1] ?? '#e3e5e4';
  const grid = new Array<string>(1600).fill('0');
  let on = '';

  for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-fA-F]{3,8})"/g)) {
    const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (!on) on = m[5]!;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < 40 && py >= 0 && py < 40) grid[py * 40 + px] = '1';
      }
    }
  }
  return { bits: grid.join(''), on: on || '#48494b', off };
}

export async function getPortrait(): Promise<Portrait | null> {
  if (portrait) return portrait;

  const file = PORTRAIT_FILE();
  if (existsSync(file)) {
    try {
      const p = JSON.parse(readFileSync(file, 'utf8')) as Portrait;
      if (p.bits?.length === 1600) {
        portrait = p;
        return portrait;
      }
    } catch { /* fall through and refetch */ }
  }

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(`${config.agentApi}/image/${yoko.agent.tokenId}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const svg = await res.text();
    if (svg.length > 400_000) throw new Error('portrait unreasonably large');

    const p = normieSvgToBits(svg);
    if (!p.bits.includes('1')) throw new Error('portrait parsed to an empty grid');

    mkdirSync(config.paths.state, { recursive: true });
    writeFileSync(file, JSON.stringify(p));
    portrait = p;
    l.info(`portrait cached: Normie #${yoko.agent.tokenId}, ${(p.bits.match(/1/g) ?? []).length} lit pixels`);
    return portrait;
  } catch (e) {
    l.warn('portrait unavailable - the entry card will go out without a face', e);
    return null;
  }
}
