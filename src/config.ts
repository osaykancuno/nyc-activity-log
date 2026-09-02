import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');

/** Club constants. Never hardcode any of these in a template. */
export const club = JSON.parse(readFileSync(resolve(ROOT, 'data/club.json'), 'utf8')) as Club;

/**
 * The keeper of the log. club.json is what the club is; yoko.json is who writes
 * it down. Every sentence Yoko can ever publish lives in this file, in the repo,
 * under review - the agent API is allowed to move her numbers and nothing else.
 */
export const yoko = JSON.parse(readFileSync(resolve(ROOT, 'data/yoko.json'), 'utf8')) as Yoko;

export type ClassName = 'Cruiser' | 'Sloop' | 'Superyacht' | 'Commodore';

export interface Club {
  club: { name: string; symbol: string; handle: string; site: string; api: string; opensea: string; license: string };
  contract: { address: `0x${string}`; chainId: number; network: string; deployBlock: number; standard: string; normiesSupplyCap: number };
  agents: { standard: string; registry: `0x${string}`; implementation: `0x${string}`; salt: `0x${string}` };
  classes: Record<ClassName, { weight: number; anchorPointsPerDay: number; note?: string }>;
  anchorPoints: { base: number; note: string };
  chandlery: Record<string, number | string>;
  tide: any;
  islands: {
    seasonIIClosesAt: string; forgeOpensAt: string; forgeClosesAt: string | null;
    hullsPerIsland: number; netSupplyChange: number; grades: string[];
    gradeThresholds: null | Record<string, number>; gradeThresholdsNote: string; visitors: string;
  };
  voice: { allow: string[]; deny: string[]; maxims: string[]; header: string; footer: string[]; disclaimer: string };
  watches: { name: string; fromHourUTC: number; toHourUTC: number }[];
}

export interface AgentSnapshot {
  level: number;
  actionPoints: number;
  transformations: number;
  pixelsAdded: number;
  pixelsRemoved: number;
  pixelsNet: number;
}

export interface Yoko {
  agent: { name: string; handle: string; agentId: number; tokenId: number; type: string; standard: string; page: string; api: string; art: string };
  snapshot: AgentSnapshot;
  byline: string;
  footer: string;
  forbid: string[];
  lines: Record<'quiet' | 'claims' | 'market' | 'tide' | 'busy' | 'close', string[]>;
}

const str = (k: string, d = ''): string => (process.env[k] ?? d).trim();
const bool = (k: string, d: boolean): boolean => {
  const v = str(k);
  return v === '' ? d : /^(1|true|yes|on)$/i.test(v);
};
/**
 * A missing number means the default, not zero.
 *
 * This read `Number(str(k))` and trusted `Number.isFinite`, and `Number('')` is
 * 0 - which is finite. So an unset variable silently became 0 rather than the
 * default written right next to it, and every default in this file was a lie
 * unless the environment happened to set it.
 *
 * It hid because the deployment sets nearly all of them. The ones that would
 * have bitten hardest are MONTHLY_BUDGET_USD and MAX_POSTS_PER_MONTH: at zero
 * the poster considers the budget spent and drops every post, silently, for a
 * month.
 */
const num = (k: string, d: number): number => {
  const raw = str(k);
  if (raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export const config = {
  dryRun: bool('DRY_RUN', true),

  rpcUrls: [str('RPC_URL', 'https://ethereum-rpc.publicnode.com'), str('RPC_URL_FALLBACK')].filter(Boolean),
  startBlock: str('START_BLOCK', 'latest'),
  confirmations: BigInt(Math.max(0, num('CONFIRMATIONS', 3))),
  pollIntervalMs: Math.max(4000, num('POLL_INTERVAL_MS', 20000)),
  maxBlockSpan: Math.max(20, num('MAX_BLOCK_SPAN', 400)),
  normiesContract: str('NORMIES_CONTRACT') as `0x${string}` | '',

  /** The club's own relay: the public source behind the Tide and the forge phase. */
  relayUrl: (str('RELAY_URL', 'https://nyc-realtime.fly.dev')).replace(/\/$/, ''),
  tidePollMs: Math.max(60_000, num('TIDE_POLL_MS', 5 * 60_000)),
  forgePollMs: Math.max(60_000, num('FORGE_POLL_MS', 15 * 60_000)),

  modules: {
    claim: bool('MODULE_CLAIM', true),
    sale: bool('MODULE_SALE', true),
    sweep: bool('MODULE_SWEEP', true),
    lookup: bool('MODULE_LOOKUP', false),
    watch: bool('MODULE_WATCH', true),
    pedigree: bool('MODULE_PEDIGREE', true),
    /** 'auto' follows the relay's own forge phase, so nobody has to remember a date. */
    forge: str('MODULE_FORGE', 'auto') === 'auto' ? 'auto' : bool('MODULE_FORGE', false),
    tide: bool('MODULE_TIDE', true),
    chandlery: bool('MODULE_CHANDLERY', false),
    /** Module J - Yoko's own entry, once a day, in her voice. */
    journal: bool('MODULE_JOURNAL', true),
  },

  /** The agent's own record on normies.art. Numbers only; never its prose. */
  agentApi: (str('AGENT_API', 'https://api.normies.art/agents')).replace(/\/$/, ''),
  agentRefreshMs: Math.max(60 * 60_000, num('AGENT_REFRESH_H', 6) * 60 * 60_000),

  /** 'chain' draws the official tokenURI image; 'api' trusts the CDN snapshot. */
  artSource: (str('ART_SOURCE', 'chain') === 'api' ? 'api' : 'chain') as 'api' | 'chain',

  minSaleEth: num('MIN_SALE_ETH', 0),
  /**
   * Hulls to one captain in one transaction, at or above which the log stops
   * writing an entry per hull and writes a single sweep instead. Below it every
   * hull gets its own post - which is what a log is - and above it one post
   * carries the lot, which is what a budget is.
   */
  sweepMin: Math.max(2, num('SWEEP_MIN', 5)),
  /*
   * The schedule runs on European clock time, not on fixed UTC.
   *
   * The club's log keeps UTC in its content - a ship's log always has - but the
   * people reading it are on European time, and a post tuned to 21:00 in Rome
   * would quietly slide to 22:00 the day the clocks change. Naming the zone
   * instead of the offset keeps the hour where it was put, in March and in
   * October alike.
   */
  cronTz: str('CRON_TZ', 'Europe/Rome'),
  /** Morning: people are awake and on their phones, before the desk swallows them. */
  watchCronMorning: str('WATCH_CRON_MORNING', '0 9 * * *'),
  /** Evening peak, the busiest hour of the European day on this platform. */
  watchCronEvening: str('WATCH_CRON_EVENING', '0 19 * * *'),
  /** The day is done and the timeline is still awake: Yoko writes it up. */
  journalCron: str('JOURNAL_CRON', '0 21 * * *'),
  /** Write an entry even on a day when nothing at all happened. */
  journalOnQuietDays: bool('JOURNAL_ON_QUIET_DAYS', true),

  postMinIntervalMs: Math.max(1000, num('POST_MIN_INTERVAL_S', 20) * 1000),
  maxPostsPerMonth: num('MAX_POSTS_PER_MONTH', 450),
  budgetReserve: num('BUDGET_RESERVE', 40),

  /**
   * Attach the rendered card, or post text only.
   * X adds its own t.co link for an attached image, and if its billing counts
   * that as a "post with URL" the price is $0.200 instead of $0.015. Check one
   * post in the console; flip this to false if it does.
   */
  attachMedia: bool('ATTACH_MEDIA', true),

  /** X bills per request. A post is $0.015 - and $0.200 if it contains a URL. */
  costPerPostUsd: num('COST_PER_POST_USD', 0.015),
  monthlyBudgetUsd: num('MONTHLY_BUDGET_USD', 5),
  /** Below this much left, only claims, sweeps, forges and settled Tides go out. */
  budgetReserveUsd: num('BUDGET_RESERVE_USD', 1),

  x: {
    appKey: str('X_APP_KEY'),
    appSecret: str('X_APP_SECRET'),
    accessToken: str('X_ACCESS_TOKEN'),
    accessSecret: str('X_ACCESS_SECRET'),
    userId: str('X_USER_ID'),
  },

  healthPort: num('HEALTH_PORT', 0),
  logLevel: str('LOG_LEVEL', 'info'),

  paths: {
    state: str('STATE_DIR') || resolve(ROOT, 'data/state'),
    out: resolve(ROOT, 'out'),
    assets: resolve(ROOT, 'assets'),
  },
} as const;

export const hasXCredentials = (): boolean =>
  Boolean(config.x.appKey && config.x.appSecret && config.x.accessToken && config.x.accessSecret);
