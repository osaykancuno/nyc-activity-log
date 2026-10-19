/**
 * The two shapes of a watch, side by side, at their longest.
 * A still watch has to read as a different post, not the same one again.
 */
import { watchPost } from '../src/templates.ts';
import { tweetLength } from '../src/util.ts';

const at = new Date(Date.UTC(2026, 8, 2, 5, 30));
const evening = new Date(Date.UTC(2026, 8, 2, 18, 30));
const season = 'The Reckoning Regatta, day 9 of 21.';

const cases = [
  ['moving, morning', { afloat: 831, fleet: 2703, unclaimed: 1872, deltaAfloat: 7, burnedFromChain: false, block: 25886919n, regatta: season, blocksSince: 1247n }, at],
  ['still, morning', { afloat: 824, fleet: 2703, unclaimed: 1879, deltaAfloat: 0, burnedFromChain: false, block: 25886919n, regatta: season, blocksSince: 1247n }, at],
  ['still, evening', { afloat: 824, fleet: 2703, unclaimed: 1879, deltaAfloat: 0, burnedFromChain: false, block: 25890533n, regatta: season, blocksSince: 3614n }, evening],
  ['first ever watch', { afloat: 824, fleet: 2703, unclaimed: 1879, deltaAfloat: null, burnedFromChain: true, block: 25886919n, regatta: season, blocksSince: null }, at],
  ['still, no season', { afloat: 824, fleet: 2703, unclaimed: 1879, deltaAfloat: 0, burnedFromChain: false, block: 25886919n, regatta: null, blocksSince: 1247n }, at],
  // After a forge: ten yachts left the fleet, so afloat went down.
  ['after a forge', { afloat: 818, fleet: 2705, unclaimed: 1877, deltaAfloat: -10, burnedFromChain: false, block: 25977500n, regatta: season, blocksSince: 3614n, burned: 10 }, evening],
  // Season 4's name is longer than season 2's: the line must survive a moving watch.
  ['moving, a long season name', { afloat: 838, fleet: 3006, unclaimed: 2128, deltaAfloat: 1, burnedFromChain: false, block: 26227139n, regatta: 'The Autumn Passage Regatta, day 12 of 21.', blocksSince: 3614n, burned: 40 }, at],
  // After 2 Nov 2026 12:00 UTC: mintOpen() is false and nothing awaits a claim.
  ['claim closed, moving', { afloat: 890, fleet: 3020, unclaimed: 2130, deltaAfloat: -10, burnedFromChain: true, block: 26300000n, regatta: season, blocksSince: 3614n, burned: 50, claimClosed: true, islands: 5 }, at],
  ['claim closed, still', { afloat: 890, fleet: 3020, unclaimed: 2130, deltaAfloat: 0, burnedFromChain: true, block: 26300000n, regatta: season, blocksSince: 3614n, burned: 50, claimClosed: true, islands: 5 }, evening],
];

let bad = 0;
const seen = new Map();
for (const [name, n, when] of cases) {
  const text = watchPost(n, when);
  const len = tweetLength(text);
  if (len > 280) bad++;
  if (/\+-|\(\+0\)|null|undefined|NaN/.test(text)) { console.log(`  BAD TEXT in "${name}"`); bad++; }
  if (n.regatta && !/Regatta, day/.test(text)) { console.log(`  "${name}": the season line was dropped`); bad++; }
  if (n.claimClosed && /awaiting|Born from burns/i.test(text)) { console.log(`  "${name}": a closed claim has no queue`); bad++; }
  if (n.deltaAfloat === -10 && !/\(-10\)/.test(text)) { console.log(`  "${name}": a forge should print (-10)`); bad++; }
  if (seen.has(text)) { console.log(`  DUPLICATE: "${name}" is identical to "${seen.get(text)}"`); bad++; }
  seen.set(text, name);
  console.log(`\n── ${name} ${'─'.repeat(30)} ${len} chars${len > 280 ? '  OVER LIMIT' : ''}\n${text}`);
}

console.log(`\n  ${cases.length} watches, ${seen.size} distinct, ${bad ? `${bad} PROBLEM(S)` : 'none over the limit, none identical'}\n`);
process.exit(bad ? 1 : 0);
