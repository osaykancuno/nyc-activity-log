/**
 * Every card this log can publish, drawn with the longest content each one can
 * realistically carry, onto one contact sheet: out/cards/sheet.png.
 *
 * A card is only checked if it is drawn in the face the server uses. The
 * renderer prefers DejaVu wherever it exists, and this prints which one it got
 * - if it says Segoe UI, the sheet is not telling you what X will show.
 *
 *   npm run tools:cards
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  initFonts, renderFleetCard, renderJournalCard, renderWatchCard, renderYachtCard,
} from '../src/render/card';
import { resolveFleet, resolveYacht } from '../src/yacht';
import { classBreakdown, grade } from '../src/util';

initFonts();
mkdirSync('out/cards', { recursive: true });

const commodore = await resolveYacht(1819);   // Superyacht class, Commodore grade, rank 19
const sloop = await resolveYacht(1191);       // the hull on the card that went out broken
const { yachts: twenty } = await resolveFleet([...Array(20)].map((_, i) => 100 + i * 37));
const { yachts: ten } = await resolveFleet([...Array(10)].map((_, i) => 200 + i * 41));
const { yachts: two } = await resolveFleet([1819, 305]);

const cards: [string, Buffer][] = [
  ['claim', renderYachtCard(commodore, 'claim', {
    title: `Yacht #${commodore.id}`,
    subtitle: `${grade(commodore)} · rank ${commodore.rarityRank} · ${commodore.anchorPointsPerDay} AP/day`,
    note: `born from Normie #${commodore.normieId}`,
    right: 'afloat',
  })],
  ['sale', renderYachtCard(commodore, 'sale', {
    title: `Yacht #${commodore.id}`,
    subtitle: `${grade(commodore)} · rank ${commodore.rarityRank}`,
    note: 'longest-captain-name.eth → another-rather-long-name.eth',
    right: '1,234.5678 WETH',
  })],
  ['sweep', renderFleetCard(twenty, 'sweep', {
    title: '20x Sweep',
    subtitle: classBreakdown(twenty.map(grade)),
    note: '→ longest-captain-name.eth',
    right: '123.4567 ETH',
  }, 20)],
  ['forge', renderFleetCard(ten, 'forge', {
    title: '10 Yachts burned',
    subtitle: classBreakdown(ten.map(grade)),
    note: 'by longest-captain-name.eth · 0x1234…abcd',
    right: 'island',
  }, 10)],
  ['tide open', renderWatchCard(
    [['Prize', 'forging slot'], ['Cost per Yacht', '1,000 AP'], ['Captains entered', '1,234'], ['Yachts entered', '3,702'], ['Prizes', '2 at 30 captains']],
    'the tide', 'Round 12',
    'Closes 2026-12-13 18:00 UTC · max 3 per captain · 3 captains to float',
  )],
  ['tide settled, 1', renderYachtCard(commodore, 'the tide', {
    title: 'Round 12 settled',
    subtitle: `Yacht #${commodore.id} · ${grade(commodore)} · weight 12 of 1,136`,
    note: 'block 25,920,169 · 0xfa7dde3d…25d4aa',
    right: 'winner',
  })],
  ['tide settled, 2', renderFleetCard(two, 'the tide', {
    title: 'Round 12 settled',
    subtitle: `2 prizes · ${classBreakdown(two.map(grade))}`,
    note: 'block 25,920,169 · 0xfa7dde3d…25d4aa',
    right: 'winners',
  }, 2)],
  ['daily draw', renderYachtCard(sloop, 'the daily tide', {
    title: `Yacht #${sloop.id}`,
    subtitle: `${grade(sloop)} · rank ${sloop.rarityRank}`,
    note: '14 entered · block 25,950,438 · 2026-09-10',
    right: 'marked',
  })],
  ['daily fallback', renderWatchCard(
    [['Marked', '#1191'], ['Entered', '14'], ['Marks in the register', '1,114']],
    'the daily tide', 'The daily draw', '14 entered · block 25,950,438 · 2026-09-10',
  )],
  // Not a card the log publishes: the pair that collided on 10 Sep 2026, plus a
  // watch title nobody would write. Both have to come out shrunk, never overlapped.
  ['stress: caption', renderYachtCard(sloop, 'the daily tide', {
    title: 'Yacht #1191 marked', subtitle: 'Sloop · rank 1714',
    note: '6 entered · block 25,950,438', right: '2026-09-10',
  })],
  ['stress: watch title', renderWatchCard(
    [['A label that is rather long', '12,345,678'], ['Short', '1']],
    'the daily tide', 'The daily draw · 2026-09-10 · and then some', 'note',
  )],
  ['watch', renderWatchCard(
    [['Afloat', '2,704'], ['Fleet on record', '10,000'], ['Awaiting claim', '7,296'], ['Captains', '1,097']],
    'middle watch', '30 September 2026',
    '12,345 blocks since the last watch · totalMinted() at 25,999,999',
    {
      bar: { label: 'Claimed', value: 2704, total: 10000 },
      chips: [['Cruiser', '4,493'], ['Sloop', '2,788'], ['Superyacht', '1,423'], ['Commodore', '120']],
      subtitle: 'The Reckoning Regatta, day 21 of 21',
    },
  )],
  ['journal', renderJournalCard({
    portrait: { bits: commodore.art.bits, on: commodore.art.on },
    name: 'CAPTAIN YOKO',
    identity: 'Keeper of the log · Normie #8362',
    rows: [['Claimed today', '1,234'], ['Sold', '1,234'], ['Tide draws', '12'], ['Islands forged', '12'], ['Fleet afloat', '2,704'], ['Awaiting claim', '7,296']],
    note: '30 September 2026 · middle watch · The Reckoning Regatta, day 21 of 21',
  })],
];

// One sheet, two columns at half size: an overlap that matters is visible at 500px.
const T = 500, COLS = 2, PAD = 36;
const sheet = createCanvas(COLS * T, Math.ceil(cards.length / COLS) * (T + PAD));
const ctx = sheet.getContext('2d');
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, sheet.width, sheet.height);
for (const [i, [name, png]] of cards.entries()) {
  writeFileSync(`out/cards/${name.replace(/[^a-z0-9]+/gi, '-')}.png`, png);
  const x = (i % COLS) * T, y = Math.floor(i / COLS) * (T + PAD);
  ctx.fillStyle = '#ddd';
  ctx.font = '20px sans-serif';
  ctx.fillText(name, x + 10, y + 26);
  ctx.drawImage(await loadImage(png), x, y + PAD, T, T);
}
writeFileSync('out/cards/sheet.png', sheet.toBuffer('image/png'));
console.log(`${cards.length} cards -> out/cards/, contact sheet out/cards/sheet.png`);
