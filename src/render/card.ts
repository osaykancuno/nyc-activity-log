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
      checkNumberFace();
      return;
    }
  } catch (e) {
    l.warn('font registration failed, using system face', e);
  }
  checkNumberFace();
}

/**
 * The two-face rule only holds if a plain sans exists to hold it up.
 * A slim container has no fonts at all, and Skia then quietly draws the
 * numbers in the pixel face - which is the one thing this file is built to
 * avoid. Cheap to check, and the answer belongs in the deploy log.
 */
function checkNumberFace(): void {
  const wanted = ['Segoe UI', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans'];
  const found = wanted.filter((f) => {
    try { return GlobalFonts.has(f); } catch { return false; }
  });
  if (found.length) l.info(`numbers drawn in ${found[0]}`);
  else l.warn('no plain sans available - numbers will fall back to the pixel face, whose digits are ambiguous. Install fonts-dejavu-core in the image.');
}

const font = (size: number, weight = '500') =>
  `${weight} ${size}px "Segoe UI", "DejaVu Sans", "Liberation Sans", "Noto Sans", sans-serif`;
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

/**
 * Several hulls at once - a sweep, or a forge.
 *
 * The count on the caption comes from the chain, so the grid has to keep up
 * with it: a twenty-hull sweep that draws twelve boats is a card that lies
 * about the very thing it is announcing. Columns, cell size and label size are
 * all derived from how many there are, and only past two dozen does it stop
 * drawing and say how many it left out.
 */
const FLEET_MAX_SHOWN = 24;
const GRID_TOP = 118;
const GRID_BOTTOM = 846;

export function renderFleetCard(yachts: Yacht[], eyebrow: string, lines: CardLines, hullCount?: number): Buffer {
  const W = 1000, H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  chrome(ctx, W, H, eyebrow);

  const shown = yachts.slice(0, FLEET_MAX_SHOWN);
  const n = shown.length;
  const total = hullCount ?? yachts.length;

  if (n > 0) {
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : n <= 20 ? 5 : 6;
    const rows = Math.ceil(n / cols);

    // Fit to both budgets: the width of the card and the height left above the
    // caption, label and gutter included. Whichever is tighter sets the scale.
    const gutter = 20;
    const labelH = 26;
    const gapY = 16;
    const byWidth = Math.floor((W - 120 - (cols - 1) * gutter) / cols);
    const byHeight = Math.floor((GRID_BOTTOM - GRID_TOP) / rows) - labelH - gapY;
    const scale = Math.max(2, Math.floor(Math.min(byWidth, byHeight) / 40));
    const size = scale * 40;

    const gapX = (W - 120 - cols * size) / Math.max(1, cols - 1);
    const blockH = rows * size + (rows - 1) * (labelH + gapY) + labelH;
    const top = GRID_TOP + Math.max(0, (GRID_BOTTOM - GRID_TOP - blockH) / 2);

    const labelSize = Math.max(13, Math.min(20, Math.round(size / 8)));

    shown.forEach((y, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = 60 + c * (size + gapX);
      const yy = top + r * (size + labelH + gapY);
      drawBits(ctx, y.art.bits, x, yy, scale, y.art.on || ON);

      ctx.fillStyle = SOFT;
      ctx.font = font(labelSize, '500');
      ctx.textAlign = 'center';
      // Class only while it fits; the id is the part that must always be there.
      const full = `#${y.id} · ${y.class}`;
      ctx.fillText(ctx.measureText(full).width <= size + gapX - 6 ? full : `#${y.id}`, x + size / 2, yy + size + labelSize + 4);
      ctx.textAlign = 'left';
    });
  }

  const hidden = total - n;
  const note = hidden > 0
    ? `${lines.note ? `${lines.note} · ` : ''}${hidden} more not pictured`
    : lines.note;

  caption(ctx, W, { ...lines, note }, 52, 872);
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

/* ── The personal log (module J) ──────────────────────────────────────────
   Not a data card. This one is a page: Yoko's own pixels on the left, who she
   is beside them, and the entry itself set large underneath. The face is the
   agent's real art from normies.art, in the same 40x40 grid the hulls use. */

export interface JournalCard {
  portrait: { bits: string; on: string } | null;
  name: string;
  identity: string;
  stats: string[];
  body: string;
  note: string;
}

/** Greedy wrap. Returns the lines, shrinking the face never the words. */
function wrap(ctx: SKRSContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export function renderJournalCard(c: JournalCard): Buffer {
  const W = 1000, H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  chrome(ctx, W, H, "captain's log");

  const scale = 8;
  const face = 40 * scale;
  const top = 118;

  if (c.portrait) {
    ctx.strokeStyle = 'rgba(191,145,81,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(59, top - 1, face + 2, face + 2);
    drawBits(ctx, c.portrait.bits, 60, top, scale, c.portrait.on || ON);
  }

  const tx = c.portrait ? 60 + face + 44 : 60;
  ctx.fillStyle = INK;
  ctx.font = font(46, '600');
  ctx.fillText(c.name, tx, top + 54);

  ctx.fillStyle = GOLD_DIM;
  ctx.font = font(24, '500');
  ctx.fillText(c.identity, tx, top + 92);

  let sy = top + 148;
  for (const line of c.stats) {
    ctx.fillStyle = SOFT;
    ctx.font = font(23, '400');
    ctx.fillText(line, tx, sy);
    sy += 36;
  }

  // The entry itself, set in the space the portrait leaves, and centred in it -
  // a short day and a long one should both look like a page rather than a
  // caption stranded at the top of one.
  const ruleY = top + face + 44;
  const areaTop = ruleY + 34;
  const areaBottom = 892;

  let size = 46;
  let lines: string[] = [];
  let lead = 0;
  do {
    ctx.font = font(size, '500');
    lines = wrap(ctx, c.body, W - 120);
    lead = size + 18;
    if (lines.length * lead - (lead - size) <= areaBottom - areaTop) break;
    size -= 2;
  } while (size > 24);

  ctx.strokeStyle = 'rgba(61,61,61,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, ruleY);
  ctx.lineTo(W - 60, ruleY);
  ctx.stroke();

  const blockH = lines.length * lead - (lead - size);
  let by = areaTop + Math.max(0, (areaBottom - areaTop - blockH) / 2) + size;

  ctx.fillStyle = INK;
  ctx.font = font(size, '500');
  for (const line of lines) {
    ctx.fillText(line, 60, by);
    by += lead;
  }

  if (c.note) fitNote(ctx, c.note, W, 930);
  return canvas.toBuffer('image/png');
}
