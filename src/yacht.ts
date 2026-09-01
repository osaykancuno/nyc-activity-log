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

  if (config.artSource !== 'chain') return api;

  // Rank and class come from the club; the picture comes from the contract.
  // They agree for almost every hull - but not all of them, and tokenURI is
  // the official, immutable image.
  try {
    const chain = await fromChain(id);
    if (chain.art.bits !== api.art.bits) l.info(`#${id}: on-chain art differs from the API snapshot - using the chain`);
    return { ...api, art: chain.art };
  } catch (e) {
    l.debug(`#${id}: tokenURI unavailable, keeping the API art`, e);
    return api;
  }
}

export async function resolveYachts(ids: number[]): Promise<Yacht[]> {
  const out: Yacht[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    out.push(...(await Promise.all(ids.slice(i, i + 4).map(resolveYacht))));
  }
  return out;
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
    tier: cls,
    anchorPointsPerDay: club.classes[cls]?.anchorPointsPerDay ?? 0,
    rarityRank: null,
    traits,
    art: { size: 40, on, off, onPixels: (bits.match(/1/g) ?? []).length, bits },
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
