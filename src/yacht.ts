import { club, config, type ClassName } from './config';
import { log } from './logger';
import { getYacht, type Yacht } from './api/nyc';
import { nycAbi } from './chain/abi';
import { NYC, publicClient } from './chain/client';

const l = log('yacht');

/**
 * One hull, from the best source available.
 *
 * The club API is richer (rarity rank), but it is a CDN snapshot: a hull
 * claimed minutes ago may not be in it yet. The contract always is - the art
 * is fully on-chain and the renderer is locked - so we fall back to tokenURI
 * and rebuild the 40x40 bitmap from the on-chain SVG itself.
 */
export async function resolveYacht(id: number): Promise<Yacht> {
  let api: Yacht | null = null;
  try {
    api = { ...(await getYacht(id)), source: 'api' };
  } catch {
    l.warn(`#${id} is not in the club API yet - reading the contract instead`);
    return fromChain(id);
  }

  if (config.artSource !== 'chain') return { ...api, art: { ...api.art, from: 'api' } };

  // Rank and class come from the club; the picture comes from the contract.
  // They agree for almost every hull - but not all of them, and tokenURI is
  // the official, immutable image.
  try {
    const chain = await fromChain(id);
    if (chain.art.bits !== api.art.bits) l.info(`#${id}: on-chain art differs from the API snapshot - using the chain`);
    return { ...api, art: chain.art };
  } catch (e) {
    l.warn(`#${id}: tokenURI unavailable, falling back to the API snapshot for the picture`, e);
    return { ...api, art: { ...api.art, from: 'api' } };
  }
}

export async function resolveYachts(ids: number[]): Promise<Yacht[]> {
  const out: Yacht[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    out.push(...(await Promise.all(ids.slice(i, i + BATCH).map(resolveYacht))));
  }
  return out;
}

/**
 * Six at a time. The club API is a CDN and the RPC transport batches whatever
 * lands in the same tick, so a twenty-hull sweep is four round trips, not
 * twenty - while still being a polite number of open sockets.
 */
const BATCH = 6;

export interface ResolvedFleet {
  yachts: Yacht[];
  /** Hulls whose metadata could not be read, even after a retry. */
  missing: number[];
}

/**
 * A whole sweep, resolved without an all-or-nothing promise.
 *
 * `resolveYachts` throws if a single hull fails, which is right for the CLI and
 * wrong for a twenty-hull sweep: one CDN hiccup would have cost the post
 * entirely. Here every hull is tried, the stragglers are tried again, and what
 * survives comes back beside a list of what did not.
 *
 * Nothing essential to a sweep post lives in this data anyway - how many hulls,
 * which ids, what was paid, by whom, in which block all come from the receipt.
 * Metadata only adds the class breakdown and the pictures, so an incomplete
 * read costs a line and some art, never the post.
 */
export async function resolveFleet(ids: number[]): Promise<ResolvedFleet> {
  const found = new Map<number, Yacht>();

  for (const attempt of [0, 1]) {
    const todo = ids.filter((id) => !found.has(id));
    if (!todo.length) break;
    if (attempt) {
      l.warn(`retrying ${todo.length} hull(s) the first pass could not read: ${todo.join(', ')}`);
      await new Promise((r) => setTimeout(r, 1500));
    }

    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      const settled = await Promise.allSettled(slice.map(resolveYacht));
      settled.forEach((r, k) => {
        if (r.status === 'fulfilled') found.set(slice[k]!, r.value);
        else l.debug(`#${slice[k]} unreadable`, r.reason);
      });
    }
  }

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) l.error(`${missing.length} of ${ids.length} hull(s) stayed unreadable: ${missing.join(', ')}. The post goes out without them.`);

  return { yachts: ids.map((id) => found.get(id)).filter((y): y is Yacht => Boolean(y)), missing };
}

const TRAIT_KEY: Record<string, string> = {
  'Sea State': 'sea', Sky: 'sky', Heading: 'heading', Hull: 'hull', Deck: 'deck',
  'Sail Plan': 'sailPlan', 'Sail Trim': 'sailTrim', Pennant: 'pennant',
  Portholes: 'portholes', Seabirds: 'seabirds', Amenities: 'amenities',
};

export async function fromChain(id: number): Promise<Yacht> {
  const uri = await publicClient.readContract({
    address: NYC, abi: nycAbi, functionName: 'tokenURI', args: [BigInt(id)],
  });
  const meta = JSON.parse(decodeDataUri(uri));

  const attrs = new Map<string, string | number>();
  for (const a of meta.attributes ?? []) attrs.set(a.trait_type, a.value);

  const cls = String(attrs.get('Class') ?? 'Cruiser') as ClassName;
  // Commodore is not a Class on the token: it is a Superyacht carrying two
  // extras, and the club grades it 120 AP a day and weight 12. The contract
  // publishes the count, so a hull the club API has not indexed yet still gets
  // its right name instead of being flattened to Superyacht.
  const extras = Number(attrs.get('Amenities') ?? 0);
  const tier: ClassName = cls === 'Superyacht' && extras >= 2 ? 'Commodore' : cls;
  const traits: Record<string, string | number> = { class: cls };
  for (const [label, key] of Object.entries(TRAIT_KEY)) {
    const v = attrs.get(label);
    if (v !== undefined) traits[key] = v;
  }

  const { bits, on, off } = svgToBits(decodeDataUri(meta.image));
  const pixelCount = Number(attrs.get('Origin Pixels') ?? 0);
  traits.pixelCount = pixelCount;

  return {
    id,
    normieId: Number(attrs.get('Born From Normie') ?? 0),
    pixelCount,
    class: cls,
    tier,
    anchorPointsPerDay: club.classes[tier]?.anchorPointsPerDay ?? 0,
    rarityRank: null,
    traits,
    art: { size: 40, on, off, onPixels: (bits.match(/1/g) ?? []).length, bits, from: 'chain' },
    source: 'chain',
  };
}

function decodeDataUri(uri: string): string {
  const [, payload] = uri.split(',', 2);
  if (!payload) throw new Error('unexpected data uri');
  return uri.includes(';base64,') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
}

/**
 * The on-chain image is a plain grid of 10x10 rects on a 400x400 canvas.
 * Rebuild the same 1600-char, row-major bitmap the API publishes.
 */
export function svgToBits(svg: string): { bits: string; on: string; off: string } {
  const off = svg.match(/<rect width="400" height="400" fill="(#[0-9a-f]{3,8})"/i)?.[1] ?? '#e3e5e4';
  const on = svg.match(/<g fill="(#[0-9a-f]{3,8})"/i)?.[1] ?? '#48494b';

  const grid = new Array<string>(1600).fill('0');
  const body = svg.slice(svg.indexOf('<g fill='));
  for (const m of body.matchAll(/<rect x="(\d+)" y="(\d+)"/g)) {
    const x = Math.round(Number(m[1]) / 10);
    const y = Math.round(Number(m[2]) / 10);
    if (x >= 0 && x < 40 && y >= 0 && y < 40) grid[y * 40 + x] = '1';
  }
  return { bits: grid.join(''), on, off };
}
