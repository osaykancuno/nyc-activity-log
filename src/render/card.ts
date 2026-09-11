import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config';
import { log } from '../logger';
import type { Yacht } from '../api/nyc';
import { grade } from '../util';

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
 * digits are ambiguous - a 5 reads as an S - and this account publishes prices
 * and block numbers. Numbers therefore stay in a plain sans.
 *
 * That rule is only worth as much as the sans behind it. It was quietly broken
 * in production for a while: the slim base image carries no fonts at all, the
 * CSS-style stack resolved to nothing, and Skia fell back to the only family
 * registered - the pixel face. Every figure on every card was drawn in it, and
 * a local preview could never show it, because Windows resolves Segoe UI.
 *
 * So neither face is left to font resolution now. Both are registered from a
 * file we can point at, in this order, and the one that answers is named in the
 * boot log:
 *   1. assets/ - whatever `npm run font` fetched
 *   2. a known system path - what fonts-dejavu-core installs, which the
 *      Dockerfile asserts is present before the image is allowed to build
 *   3. the family stack, for a desktop that has its own
 */
let CHROME = '';
let NUMBERS = '';
/** What to call the number face in the log - a family name is not a file. */
let NUMBERS_FROM = '';

/** Pixel faces are for chrome only; anything else can carry a number. */
const isPixelFace = (file: string): boolean => /pixel/i.test(file);

// DejaVu first everywhere, including a desktop that happens to have it: it is
// what the server draws in, and a preview in any other face measures different
// widths. A daily-draw card went out on 10 Sep 2026 with its title over its
// date - Segoe UI on the desktop had left room that DejaVu does not.
const SANS_PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:/Windows/Fonts/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
];
const SANS_BOLD_PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
];
const SANS_FAMILIES = ['Segoe UI', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial', 'Helvetica'];

export function initFonts(): void {
  registerFromAssets();
  if (!NUMBERS) registerSansFromDisk();
  if (!NUMBERS) {
    NUMBERS = SANS_FAMILIES.find(hasFamily) ?? '';
    if (NUMBERS) NUMBERS_FROM = `${NUMBERS} (system)`;
  }

  l.info(`chrome drawn in ${CHROME ? 'the club pixel face' : 'a system sans - no pixel font in assets'}`);
  if (NUMBERS) l.info(`numbers drawn in ${NUMBERS_FROM}`);
  else l.error('NO PLAIN SANS ANYWHERE - numbers would fall back to the pixel face, whose digits are ambiguous. Install fonts-dejavu-core, or run `npm run font`.');
}

function hasFamily(name: string): boolean {
  try { return GlobalFonts.has(name); } catch { return false; }
}

/** Whatever `npm run font` left behind, sorted into the two roles. */
function registerFromAssets(): void {
  try {
    if (!existsSync(config.paths.assets)) return;
    for (const f of readdirSync(config.paths.assets)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const path = resolve(config.paths.assets, f);
      if (isPixelFace(f)) {
        if (CHROME) continue;
        GlobalFonts.registerFromPath(path, 'ClubFont');
        CHROME = 'ClubFont';
      } else {
        if (NUMBERS) continue;
        GlobalFonts.registerFromPath(path, 'NumFont');
        NUMBERS = 'NumFont';
        NUMBERS_FROM = `assets/${f}`;
      }
    }
  } catch (e) {
    l.warn('font registration from assets failed', e);
  }
}

/** The image installs DejaVu and asserts it at build time; take it by path. */
function registerSansFromDisk(): void {
  const regular = SANS_PATHS.find((p) => existsSync(p));
  if (!regular) return;
  try {
    GlobalFonts.registerFromPath(regular, 'NumFont');
    const bold = SANS_BOLD_PATHS.find((p) => existsSync(p));
    if (bold) GlobalFonts.registerFromPath(bold, 'NumFont');
    NUMBERS = 'NumFont';
    NUMBERS_FROM = `${regular}${bold ? ' (+ bold)' : ''}`;
  } catch (e) {
    l.warn(`could not register ${regular}`, e);
  }
}

const font = (size: number, weight = '500') =>
  `${weight} ${size}px ${NUMBERS ? `"${NUMBERS}", ` : ''}"Segoe UI", "DejaVu Sans", "Liberation Sans", "Noto Sans", sans-serif`;
const chromeFont = (size: number, weight = '600') =>
  CHROME ? `${weight} ${size}px "${CHROME}", "Segoe UI", sans-serif` : font(size, weight);

/**
 * Measure before drawing. Sets the largest font from `size` down to `min` that
 * keeps `text` inside `max`, and returns what to draw - cut with an ellipsis
 * only if even the smallest size will not hold it, and said so in the log,
 * because a cut line is a fact that did not make it onto the card.
 *
 * Every line on these cards used to be drawn at a fixed size and trusted to
 * fit. That held on a Windows desktop and not on the server, whose DejaVu is a
 * good deal wider than Segoe UI: on 10 Sep 2026 a daily-draw card went out
 * with its title printed over the date beside it. Measuring at draw time is
 * right in whatever face the machine has.
 */
function fit(ctx: SKRSContext2D, text: string, max: number, size: number, weight: string, min: number): string {
  let s = size;
  ctx.font = font(s, weight);
  while (s > min && ctx.measureText(text).width > max) {
    s -= 1;
    ctx.font = font(s, weight);
  }
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}\u2026`).width > max) t = t.slice(0, -1);
  l.warn(`card text cut to fit ${Math.round(max)}px: "${text}"`);
  return `${t.trimEnd()}\u2026`;
}

/** The gap kept between a left line and the figure right-aligned beside it. */
const GAP = 28;

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
  const inner = W - 120;

  // The figure on the right - a price, a state - is the fact that has to stay
  // whole, so it is measured first and the title gets whatever room is left.
  let rightW = 0;
  if (lines.right) {
    const right = fit(ctx, lines.right, inner * 0.45, 38, '600', 26);
    rightW = ctx.measureText(right).width;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(right, W - 60, baseY);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = INK;
  ctx.fillText(fit(ctx, lines.title, inner - (rightW ? rightW + GAP : 0), titleSize, '600', 34), 60, baseY);

  if (lines.subtitle) {
    ctx.fillStyle = GOLD_DIM;
    ctx.fillText(fit(ctx, lines.subtitle, inner, 27, '500', 20), 60, baseY + 40);
  }
  if (lines.note) {
    ctx.fillStyle = SOFT;
    ctx.fillText(fit(ctx, lines.note, inner, 21, '400', 16), 60, baseY + 72);
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
const GRID_TOP = 104;
/**
 * Clear of the caption title, whose capitals rise to about y 834 at 52px. It
 * was 846 once, and a three-row grid - ten hulls, which is every forge - put
 * its last row of labels on top of the title. The top and the row gaps gave a
 * little back so ten hulls keep the size they had.
 */
const GRID_BOTTOM = 812;

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
    const labelH = 24;
    const gapY = 10;
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
      const full = `#${y.id} · ${grade(y)}`;
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
  ctx.fillText(fit(ctx, title, W - 120, 62, '600', 36), 60, 200);

  if (extras.subtitle) {
    ctx.fillStyle = GOLD_DIM;
    ctx.fillText(fit(ctx, extras.subtitle, W - 120, 27, '500', 20), 60, 242);
  }

  let y = extras.subtitle ? 330 : 300;
  for (const [k, v] of rows) {
    ctx.fillStyle = SOFT;
    ctx.font = font(30, '400');
    const keyW = ctx.measureText(k).width;
    ctx.fillText(k, 60, y);
    ctx.fillStyle = INK;
    const value = fit(ctx, v, W - 120 - keyW - GAP, 46, '600', 26);
    ctx.textAlign = 'right';
    ctx.fillText(value, W - 60, y);
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
    const chips = extras.chips;
    const rowWidth = (size: number): number => {
      ctx.font = font(size, '500');
      return chips.reduce((w, [k, v]) => w + ctx.measureText(`${k} ${v}`).width + 34 + 14, -14);
    };
    let chipSize = 24;
    while (chipSize > 16 && rowWidth(chipSize) > W - 120) chipSize -= 1;
    let cx = 60;
    for (const [k, v] of chips) {
      ctx.font = font(chipSize, '500');
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
  ctx.fillStyle = SOFT;
  ctx.fillText(fit(ctx, note, W - 120, 22, '400', 15), 60, y);
}

/* ── The captain's log (module J) ─────────────────────────────────────────
   Not an echo of the tweet. Every other post here pairs its text with a card
   that adds something - the watch prints captains and a claimed bar the words
   never mention - and this one lost that when it simply restated the entry.

   So the page carries the day's ledger, in the club's numbers, and the post
   carries Yoko's reading of it. Two different things to look at. Her own
   pixels stay on the card and out of the entry, one line, under her name. */

export interface JournalCard {
  portrait: { bits: string; on: string } | null;
  name: string;
  identity: string;
  rows: [string, string][];
  note: string;
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
  ctx.fillText(fit(ctx, c.name, W - 60 - tx, 46, '600', 28), tx, top + 150);

  ctx.fillStyle = GOLD_DIM;
  ctx.fillText(fit(ctx, c.identity, W - 60 - tx, 23, '500', 16), tx, top + 190);

  const ruleY = top + face + 44;
  ctx.strokeStyle = 'rgba(61,61,61,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, ruleY);
  ctx.lineTo(W - 60, ruleY);
  ctx.stroke();

  // The ledger. Row height follows the count so four rows and six both sit
  // in the same block rather than drifting into the note at the bottom.
  const rows = c.rows.slice(0, 6);
  if (rows.length) {
    const areaTop = ruleY + 40;
    const areaBottom = 880;
    const rowH = Math.min(96, Math.floor((areaBottom - areaTop) / rows.length));
    const labelSize = Math.max(22, Math.min(30, Math.round(rowH * 0.36)));
    const valueSize = Math.max(30, Math.min(46, Math.round(rowH * 0.54)));

    let y = areaTop + Math.round(rowH * 0.62);
    for (const [k, v] of rows) {
      ctx.fillStyle = SOFT;
      ctx.font = font(labelSize, '400');
      const keyW = ctx.measureText(k).width;
      ctx.fillText(k, 60, y);

      ctx.fillStyle = INK;
      const value = fit(ctx, v, W - 120 - keyW - GAP, valueSize, '600', 22);
      ctx.textAlign = 'right';
      ctx.fillText(value, W - 60, y);
      ctx.textAlign = 'left';

      ctx.strokeStyle = 'rgba(61,61,61,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, y + Math.round(rowH * 0.28));
      ctx.lineTo(W - 60, y + Math.round(rowH * 0.28));
      ctx.stroke();

      y += rowH;
    }
  }

  if (c.note) fitNote(ctx, c.note, W, 930);
  return canvas.toBuffer('image/png');
}
