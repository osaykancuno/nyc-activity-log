import { formatEther } from 'viem';
import { club, type ClassName } from './config';

/** 0x9f4c…12c4 — never a full wallet, never a scraped register. */
export const shortAddr = (a: string): string =>
  a && a.length >= 10 ? `${a.slice(0, 6)}\u2026${a.slice(-4)}` : a;

/** ENS if we have it, shortened address otherwise. */
export const who = (addr: string, ens?: string | null): string => ens || shortAddr(addr);

/** ETH with a sane number of decimals. Never rounded up into a prettier lie. */
export function fmtEth(wei: bigint, symbol = 'ETH'): string {
  const n = Number(formatEther(wei));
  if (n === 0) return `0 ${symbol}`;
  const decimals = n >= 100 ? 1 : n >= 10 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 5;
  const s = n.toFixed(decimals).replace(/\.?0+$/, '');
  return `${s} ${symbol}`;
}

export const ethNumber = (wei: bigint): number => Number(formatEther(wei));

export const fmtInt = (n: number | bigint): string => Number(n).toLocaleString('en-US');

export const fmtBlock = (b: bigint): string => Number(b).toLocaleString('en-US');

/** Nautical watch name for a UTC instant — the club's own clock. */
export function watchName(d: Date): string {
  const h = d.getUTCHours();
  const w = club.watches.find((x) => h >= x.fromHourUTC && h < x.toHourUTC);
  return w ? w.name : 'middle';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** "1 September 2026" */
export const logDate = (d: Date): string =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** "Entry: 1 September 2026, dawn watch." */
export const logEntryLine = (d: Date): string => `Entry: ${logDate(d)}, ${watchName(d)} watch.`;

export const etherscanTx = (h: string) => `https://etherscan.io/tx/${h}`;
export const openseaAsset = (id: number) =>
  `https://opensea.io/assets/ethereum/${club.contract.address}/${id}`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const ZERO = '0x0000000000000000000000000000000000000000';
export const isZero = (a: string) => a.toLowerCase() === ZERO;

/** Count classes: { Superyacht: 1, Cruiser: 3 } -> "3 Cruiser \u00b7 1 Superyacht" */
/**
 * What the club calls this hull. `class` comes from the burned Normie and stops
 * at Superyacht; the grade above it - Commodore, a Superyacht carrying two
 * extras - is published in `tier`, and it is the one worth 120 Anchor Points a
 * day and weight 12 in a Tide round. Reading `class` alone published every
 * Commodore as a plain Superyacht, and printed a Commodore's own AP rate and
 * draw weight beside the wrong name.
 */
export const grade = (y: { class: string; tier?: string }): ClassName =>
  ((y.tier && y.tier in club.classes ? y.tier : y.class) as ClassName);

export function classBreakdown(classes: string[]): string {
  const order: string[] = ['Commodore', 'Superyacht', 'Sloop', 'Cruiser'];
  const counts = new Map<string, number>();
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([c, n]) => `${n} ${c}`)
    .join(' \u00b7 ');
}

/**
 * Editorial guard. The bot writes like the LOG, not like a marketplace.
 * Returns the offending words, if any. Callers refuse to post on a hit.
 */
export function voiceViolations(text: string): string[] {
  const lower = text.toLowerCase();
  return club.voice.deny.filter((w) => lower.includes(w.toLowerCase()));
}

/** X counts a URL as 23 chars and most emoji as 2. Conservative estimate. */
export function tweetLength(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let base = [...text].length;
  for (const u of urls) base += 23 - [...u].length;
  const wide = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  return base + wide;
}

export const truncateTweet = (text: string, limit = 275): string => {
  if (tweetLength(text) <= limit) return text;
  const lines = text.split('\n');
  while (lines.length > 1 && tweetLength(lines.join('\n')) > limit) lines.splice(-2, 1);
  const out = lines.join('\n');
  return tweetLength(out) <= limit ? out : [...out].slice(0, limit - 1).join('') + '\u2026';
};

/**
 * An RPC URL carries its API key in the path, so it must never reach a log line
 * whole. Keeps the provider visible - which is the only part worth logging.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
    return tail.length > 6 ? `${u.protocol}//${u.host}/…${tail.slice(-4)}` : `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}
