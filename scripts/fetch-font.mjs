// Optional: fetch Pixelify Sans (OFL) so the cards use the club's own face.
// Without it the renderer falls back to a system sans. Nothing breaks.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssUrl = 'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;600&display=swap';

const res = await fetch(cssUrl, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) { console.error('font css fetch failed:', res.status); process.exit(1); }
const text = await res.text();
const match = text.match(/url\((https:[^)]+)\)/);
if (!match) { console.error('no font url in css'); process.exit(1); }
const url = match[1];

const font = await fetch(url);
const buf = Buffer.from(await font.arrayBuffer());
mkdirSync(resolve(root, 'assets'), { recursive: true });
if (!url.endsWith('.ttf')) {
  console.log('Only a woff2 was offered; canvas needs ttf/otf. Skipping - system font will be used.');
  process.exit(0);
}
writeFileSync(resolve(root, 'assets/PixelifySans.ttf'), buf);
console.log('saved assets/PixelifySans.ttf', buf.length, 'bytes');
