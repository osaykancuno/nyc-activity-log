/**
 * What the timeline looks like when several hulls move in one transaction.
 *
 * This is the decision that separates a log from a bill, so it is checked
 * rather than assumed: below SWEEP_MIN every hull is its own entry with its own
 * seller and price; at or above it, one sweep post carries the lot.
 */
import { parseEther, formatEther } from 'viem';

// Pin the threshold before anything reads the environment, so this checks the
// logic and not whichever SWEEP_MIN happens to sit in .env. dotenv does not
// overwrite a value already present in process.env.
process.env.SWEEP_MIN = process.env.SWEEP_MIN_TEST ?? '5';

const { salesFrom } = await import('../src/chain/classify.ts');
const { config } = await import('../src/config.ts');

const TX = '0xabc0000000000000000000000000000000000000000000000000000000000001';
const g = { txHash: TX, blockNumber: 25_884_000n, timestamp: new Date('2026-09-02T03:00:00Z') };

const BUYER_A = '0xaaaa000000000000000000000000000000000001';
const BUYER_B = '0xbbbb000000000000000000000000000000000002';
const seller = (n) => `0x5e11e${n}00000000000000000000000000000000000`.slice(0, 42);

const scene = (spec) => {
  const moves = [];
  const byToken = new Map();
  let total = 0n;
  for (const [id, to, eth, s] of spec) {
    moves.push({ from: seller(s), to, tokenId: BigInt(id), logIndex: moves.length });
    const wei = parseEther(String(eth));
    byToken.set(BigInt(id), wei);
    total += wei;
  }
  return [moves, { byToken, total, source: 'seaport', marketplace: 'Seaport', currency: 'ETH' }];
};

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log(`\n  SWEEP_MIN = ${config.sweepMin}\n`);

// One hull, one entry. The base case must not have moved.
{
  const [moves, price] = scene([[1709, BUYER_A, 2.4, 1]]);
  const out = salesFrom(g, moves, price);
  check('a single sale is one sale post', out.length === 1 && out[0].kind === 'sale', `${out.length} event(s)`);
  check('  carries its hull and price', out[0]?.tokenIds[0] === 1709 && formatEther(out[0].priceWei) === '2.4');
}

// Three hulls, one buyer: three entries, each with its own seller and price.
{
  const [moves, price] = scene([[12, BUYER_A, 1.1, 1], [44, BUYER_A, 2.2, 2], [101, BUYER_A, 3.3, 3]]);
  const out = salesFrom(g, moves, price);
  check('three hulls to one captain are three entries', out.length === 3 && out.every((e) => e.kind === 'sale'), `${out.length} event(s)`);
  check('  each entry names one hull', out.every((e) => e.tokenIds.length === 1));
  check('  each keeps its own price', out.map((e) => formatEther(e.priceWei)).join(',') === '1.1,2.2,3.3');
  check('  each keeps its own seller', new Set(out.map((e) => e.from)).size === 3);
  check('  dedup keys are distinct', new Set(out.map((e) => e.key)).size === 3, out.map((e) => e.key.split(':').pop()).join(','));
  check('  no hull is dropped', out.flatMap((e) => e.tokenIds).sort((a, b) => a - b).join(',') === '12,44,101');
}

// At the threshold: one post, every hull on it.
{
  const spec = [12, 44, 101, 205, 309].map((id, i) => [id, BUYER_A, 1, i]);
  const [moves, price] = scene(spec);
  const out = salesFrom(g, moves, price);
  check(`${spec.length} hulls become one sweep`, out.length === 1 && out[0].kind === 'sweep', `${out.length} event(s)`);
  check('  the sweep carries all of them', out[0]?.tokenIds.length === 5);
  check('  the total is the sum', formatEther(out[0].priceWei) === '5');
}

// Two captains in one transaction, four hulls each way.
{
  const [moves, price] = scene([
    [12, BUYER_A, 1, 1], [44, BUYER_A, 1, 2],
    [101, BUYER_B, 1, 3], [205, BUYER_B, 1, 4], [309, BUYER_B, 1, 5], [412, BUYER_B, 1, 6], [517, BUYER_B, 1, 7],
  ]);
  const out = salesFrom(g, moves, price);
  const sales = out.filter((e) => e.kind === 'sale');
  const sweeps = out.filter((e) => e.kind === 'sweep');
  check('buyers are judged separately', sales.length === 2 && sweeps.length === 1, `${sales.length} sale(s), ${sweeps.length} sweep(s)`);
  check('  the sweep is the one over the threshold', sweeps[0]?.tokenIds.length === 5);
}

// A hull with no provable price is not published, and does not take the rest down.
{
  const [moves, price] = scene([[12, BUYER_A, 1, 1], [44, BUYER_A, 2, 2]]);
  moves.push({ from: seller(9), to: BUYER_A, tokenId: 999n, logIndex: 9 }); // no entry in byToken
  const out = salesFrom(g, moves, price);
  check('an unpriced hull is skipped, the rest survive', out.length === 2 && !out.some((e) => e.tokenIds.includes(999)));
}

console.log(`\n  ${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);
