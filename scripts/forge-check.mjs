/**
 * What a forge transaction becomes on the timeline.
 *
 * The first forge (14 Sep 2026, island #1000000) went out as two posts: the ten
 * burns as a forge, and the island's own mint as "Yacht #1000000 is afloat,
 * born from Normie #0, Cruiser". An island is a token of the same contract, so
 * a mint is not a claim just because it comes from 0x0. Checked here against
 * the shape of that real transaction, with no network call.
 *
 *   npm run tools:forge
 */
const { classify } = await import('../src/chain/classify.ts');
const { forgePost } = await import('../src/templates.ts');
const { isIsland, tweetLength } = await import('../src/util.ts');

const ZERO = '0x0000000000000000000000000000000000000000';
const CAPTAIN = '0x41b199A5194c58b29559A482E919331E1c8EEF85';
const OTHER = '0xbbbb000000000000000000000000000000000002';
const TX = '0x17646fc3a23579037af8589d098c8d936cc5a18d01ad8f04b33793612b29c878';
const BURNED = [57, 150, 244, 282, 297, 290, 302, 431, 1392, 1387]; // the chain's own order

const group = (transfers) => ({
  txHash: TX, blockNumber: 25_976_968n, timestamp: new Date('2026-09-14T16:43:35Z'),
  transfers: transfers.map((t, i) => ({ ...t, tokenId: BigInt(t.tokenId), logIndex: 1127 + i })),
});
const burn = (id, from = CAPTAIN) => ({ from, to: ZERO, tokenId: id });
const mint = (id, to = CAPTAIN) => ({ from: ZERO, to, tokenId: id });

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('');
check('island #1000000 is an island', isIsland(1000000) && isIsland(1000000n));
check('  and the highest yacht id is not', !isIsland(2704) && !isIsland(9999));

// The real transaction: ten burns, then the island minted to the same captain.
{
  const out = await classify(group([...BURNED.map((id) => burn(id)), mint(1000000)]));
  check('the first forge is ONE event', out.length === 1, `${out.length}: ${out.map((e) => e.kind).join(', ')}`);
  check('  a forge, not a claim', out[0]?.kind === 'forge' && !out.some((e) => e.kind === 'claim'));
  check('  it names the island', out[0]?.islandIds?.join(',') === '1000000');
  check('  and carries the ten yachts, sorted', out[0]?.tokenIds.join(',') === '57,150,244,282,290,297,302,431,1387,1392');
  check('  from the captain who forged it', out[0]?.from === CAPTAIN);
  check('  under the same dedup key as before the fix', out[0]?.key === `forge:${TX}:${CAPTAIN}`);
}

// A yacht claim is still a claim.
{
  const out = await classify(group([mint(1709, OTHER)]));
  check('a yacht claim is still a claim', out.length === 1 && out[0].kind === 'claim' && out[0].tokenIds[0] === 1709);
}

// A claim and a forge in one transaction stay two different things.
{
  const out = await classify(group([mint(1709, OTHER), ...BURNED.map((id) => burn(id)), mint(1000001)]));
  check('a claim beside a forge: one claim, one forge', out.filter((e) => e.kind === 'claim').length === 1 && out.filter((e) => e.kind === 'forge').length === 1);
}

// Burns with no island are not a forge.
{
  const out = await classify(group(BURNED.map((id) => burn(id))));
  check('burns with no island minted publish nothing', out.length === 0, `${out.length} event(s)`);
}

// Another captain's burns in the same transaction are not this island's.
{
  const out = await classify(group([...BURNED.map((id) => burn(id)), burn(5, OTHER), mint(1000000)]));
  check("another captain's burn is not counted in the island", out.length === 1 && out[0].tokenIds.length === 10);
}

// Two islands to one captain in one transaction: still one post.
{
  const twenty = [...BURNED, ...BURNED.map((id) => id + 1)];
  const out = await classify(group([...twenty.map((id) => burn(id)), mint(1000001), mint(1000002)]));
  check('two islands to one captain are one forge event', out.length === 1 && out[0].islandIds?.join(',') === '1000001,1000002' && out[0].tokenIds.length === 20);
}

// An island changing hands is never published as a yacht (and needs no receipt).
{
  const out = await classify(group([{ from: CAPTAIN, to: OTHER, tokenId: 1000000 }]));
  check('an island moving is not a yacht sale', out.length === 0, `${out.length} event(s)`);
}

// The post itself.
const y = (g) => ({ class: g === 'Commodore' ? 'Superyacht' : g, tier: g });
const yachts = [...Array(8)].map(() => y('Sloop')).concat([y('Superyacht'), y('Superyacht')]);
const owner = { addr: CAPTAIN, ens: null };
{
  const facts = { grade: 'Isle', score: 26, residents: 26, services: 2, wakeAp: 2600 };
  const text = forgePost([1000000], BURNED, yachts, owner, 25_976_968n, facts);
  console.log(`\n${text}\n`);
  check('the post opens on the island', text.startsWith('Island #1000000 is forged.'));
  check('  never calls it a yacht', !/Yacht #1000000|Normie #0|Cruiser/.test(text));
  check("  prints the club's grade, score and wake cost", text.includes('Isle · score 26 · wakes for 2,600 Anchor Points'));
  check('  does not repeat the score as a weight', !text.includes('weight 26'));
  check('  fleet net from the chain', text.includes('Fleet net -9.'));
  check('  fits', tweetLength(text) <= 272, `${tweetLength(text)} chars`);
  check('  no null, undefined or NaN', !/null|undefined|NaN/.test(text));
}
{
  const text = forgePost([1000000], BURNED, yachts, owner, 25_976_968n, null);
  check('ungraded: no grade invented, the weight stays', !/Cay|Isle|Estate|Flagship/.test(text) && text.includes('weight 26'));
}
{
  const long = { addr: CAPTAIN, ens: 'a-very-long-captain-name-that-someone-registered.eth' };
  const text = forgePost([1000000], BURNED, yachts, long, 25_976_968n, { grade: 'Flagship', score: 120, residents: 120, services: 12, wakeAp: 12000 });
  check('a long ENS still fits', tweetLength(text) <= 275, `${tweetLength(text)} chars`);
}

console.log(`\n  ${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);
