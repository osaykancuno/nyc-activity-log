import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config';
import { log } from '../logger';
import type { Yacht } from '../api/nyc';

const l = log('render');

/** Club palette, taken from the API art colours. */
const PAPER = '#e3e5e4';
const INK = '#3d3d3d';
const ON = '#48494b';
const GOLD = '#bf9151';
const GOLD_DIM = '#a77d40';
const SOFT = '#7a7a7a';

/**
 * Two faces on purpose. The club's pixel face is right for the chrome, but its
 * digits are ambiguous - a 5 reads as an S - and this account publishes prices.
 * Numbers therefore stay in a plain sans.
 */
let CHROME = '';

/** Pixelify Sans if `npm run font` fetched it, a system face otherwise. */
export function initFonts(): void {
  try {
    if (!existsSync(config.paths.assets)) return;
    for (const f of readdirSync(config.paths.assets)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      GlobalFonts.registerFromPath(resolve(config.paths.assets, f), 'ClubFont');
      CHROME = 'ClubFont';
      l.info(`font registered: ${f}`);
      return;
    }
  } catch (e) {
    l.warn('font registration failed, using system face', e);
  }
}

const font = (size: number, weight = '500') => `${weight} ${size}px "Segoe UI", "DejaVu Sans", sans-serif`;
const chromeFont = (size: number, weight = '600') =>
  CHROME ? `${weight} ${size}px "${CHROME}", "Segoe UI", sans-serif` : font(size, weight);

/** Manual tracking - reliable across canvas builds. */
function tracked(ctx: SKRSContext2D, text: string, x: number, y: number, spacing: number): number {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx;
}

function trackedWidth(ctx: SKRSContext2D, text: string, spacing: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w;
}

function drawBits(ctx: SKRSContext2D, bits: string, x: number, y: number, scale: number, on = ON): void {
  ctx.fillStyle = on;
  for (let i = 0; i < 1600; i++) {
    if (bits[i] !== '1') continue;
    ctx.fillRect(x + (i % 40) * scale, y + Math.floor(i / 40) * scale, scale, scale);
  }
}

function chrome(ctx: SKRSContext2D, w: number, h: number, eyebrow: string): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, w - 56, h - 56);

  ctx.textBaseline = 'middle';
  ctx.font = chromeFont(21);
  ctx.fillStyle = GOLD;
  tracked(ctx, 'NORMIES YACHT CLUB', 60, 66, 3.2);

  if (eyebrow) {
    const label = eyebrow.toUpperCase();
    ctx.font = chromeFont(21);
    ctx.fillStyle = GOLD_DIM;
    tracked(ctx, label, w - 60 - trackedWidth(ctx, label, 3.2), 66, 3.2);
  }
  ctx.textBaseline = 'alphabetic';
}

export interface CardLines { title: string; subtitle?: string; note?: string; right?: string }

function caption(ctx: SKRSContext2D, W: number, lines: CardLines, titleSize: number, baseY: number): void {
  ctx.fillStyle = INK;
  ctx.font = font(titleSize, '600');
  ctx.fillText(lines.title, 60, baseY);

  if (lines.subtitle) {
    ctx.fillStyle = GOLD_DIM;
    ctx.font = font(27, '500');
    ctx.fillText(lines.subtitle, 60, baseY + 40);
  }
  if (lines.note) {
    ctx.fillStyle = SOFT;
    ctx.font = font(21, '400');
    ctx.fillText(lines.note, 60, baseY + 72);
  }
  if (lines.right) {
    ctx.fillStyle = INK;
    ctx.font = font(38, '600');
    ctx.textAlign = 'right';
    ctx.fillText(lines.right, W - 60, baseY);
    ctx.textAlign = 'left';
  }
}

/** One hull. 1000x1000 - square reads best in a timeline. */
export function renderYachtCard(y: Yacht, eyebrow: string, lines: CardLines): Buffer {
  const W = 1000, H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  chrome(ctx, W, H, eyebrow);

  const scale = 17;
  drawBits(ctx, y.art.bits, (W - 40 * scale) / 2, 112, scale, y.art.on || ON);
  caption(ctx, W, lines, 58, 872);

  return canvas.toBuffer('image/png');
}

/** Several hulls at once - a sweep, or a forge. Contact sheet, up to 12. */
export function renderFleetCard(yachts: Yacht[], eyebrow: string, lines: CardLines): Buffer {
  const W = 1000, H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  chrome(ctx, W, H, eyebrow);

  const shown = yachts.slice(0, 12);
  const cols = shown.length <= 4 ? 2 : shown.length <= 9 ? 3 : 4;
  const rows = Math.ceil(shown.length / cols);
  const cell = Math.min(Math.floor(760 / cols), Math.floor(620 / rows));
  const scale = Math.max(2, Math.floor(cell / 40));
  const size = scale * 40;
  const gapX = (W - cols * size) / (cols + 1);
  const gapY = 46;
  const blockH = rows * size + (rows - 1) * gapY + 30;
  const top = Math.max(120, 110 + (700 - blockH) / 2);

  shown.forEach((y, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = gapX + c * (size + gapX);
    const yy = top + r * (size + gapY);
    drawBits(ctx, y.art.bits, x, yy, scale, y.art.on || ON);
    ctx.fillStyle = SOFT;
    ctx.font = font(19, '500');
    ctx.textAlign = 'center';
    ctx.fillText(`#${y.id} \u00b7 ${y.class}`, x + size / 2, yy + size + 26);
    ctx.textAlign = 'left';
  });

  caption(ctx, W, lines, 52, 872);
  return canvas.toBuffer('image/png');
}

/** Numbers only: the watch card. No art, because no single hull owns the watch. */
export interface WatchExtras {
  bar?: { label: string; value: number; total: number };
  chips?: [string, string][];
  /** A second line under the date - the season, when one is running. */
  subtitle?: string;
}

export function renderWatchCard(
  rows: [string, string][],
  eyebrow: string,
  title: string,
  note?: string,
  extras: WatchExtras = {},
): Buffer {
  const W = 1000, H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  chrome(ctx, W, H, eyebrow);

  ctx.fillStyle = INK;
  ctx.font = font(62, '600');
  ctx.fillText(title, 60, 200);

  if (extras.subtitle) {
    ctx.fillStyle = GOLD_DIM;
    ctx.font = font(27, '500');
    ctx.fillText(extras.subtitle, 60, 242);
  }

  let y = extras.subtitle ? 330 : 300;
  for (const [k, v] of rows) {
    ctx.fillStyle = SOFT;
    ctx.font = font(30, '400');
    ctx.fillText(k, 60, y);
    ctx.fillStyle = INK;
    ctx.font = font(46, '600');
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 60, y);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(61,61,61,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, y + 26);
    ctx.lineTo(W - 60, y + 26);
    ctx.stroke();
    y += 100;
  }

  if (extras.bar && extras.bar.total > 0) {
    const { label, value, total } = extras.bar;
    const pct = Math.max(0, Math.min(1, value / total));
    const barY = y + 30;
    ctx.fillStyle = SOFT;
    ctx.font = font(26, '400');
    ctx.fillText(label, 60, barY - 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = GOLD_DIM;
    ctx.fillText(`${(pct * 100).toFixed(1)}%`, W - 60, barY - 18);
    ctx.textAlign = 'left';
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    ctx.strokeRect(60, barY, W - 120, 26);
    ctx.fillStyle = GOLD;
    ctx.fillRect(60, barY, (W - 120) * pct, 26);
    y = barY + 110;
  }

  if (extras.chips?.length) {
    let cx = 60;
    for (const [k, v] of extras.chips) {
      ctx.font = font(24, '500');
      const label = `${k} ${v}`;
      const w = ctx.measureText(label).width + 34;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, y - 30, w, 46);
      ctx.fillStyle = INK;
      ctx.fillText(label, cx + 17, y);
      cx += w + 14;
    }
  }

  if (note) fitNote(ctx, note, W, 930);
  return canvas.toBuffer('image/png');
}

/** Long notes (a transaction hash, say) shrink to fit rather than run off the card. */
function fitNote(ctx: SKRSContext2D, note: string, W: number, y: number): void {
  const max = W - 120;
  let size = 22;
  ctx.fillStyle = SOFT;
  ctx.font = font(size, '400');
  while (ctx.measureText(note).width > max && size > 15) {
    size -= 1;
    ctx.font = font(size, '400');
  }
  let text = note;
  while (ctx.measureText(text).width > max && text.length > 8) text = `${text.slice(0, -2)}…`;
  ctx.fillText(text, 60, y);
}
