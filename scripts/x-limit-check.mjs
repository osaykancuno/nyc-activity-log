/**
 * X gives a free account 280 characters, and counts most emoji as two.
 * This proves our estimator never counts fewer than X does - an undercount is
 * the only failure mode that matters, because it is the one that gets a post
 * refused at the door.
 */
import { tweetLength, truncateTweet } from '../src/util.ts';

const cases = [
  ['plain latin', 'hello world', 11],
  ['anchor', '\u2693', 2],
  ['wave', '\uD83C\uDF0A', 2],
  ['sailboat + VS16', '\u26F5\uFE0F', 2],
  ['the log header', 'LOG OF THE NORMIES YACHT CLUB \u26F5\uFE0F', 32],
  ['the sign-off', 'See you in The Marina \u2693', 24],
  ['280 plain', 'a'.repeat(280), 280],
];

let bad = 0;
for (const [name, text, xCounts] of cases) {
  const ours = tweetLength(text);
  const ok = ours >= xCounts;
  if (!ok) bad++;
  console.log(`  ${name.padEnd(18)} X ${String(xCounts).padStart(3)}  ours ${String(ours).padStart(3)}  ${ok ? (ours === xCounts ? 'exact' : 'conservative') : 'UNDERCOUNT'}`);
}

const long = truncateTweet('x'.repeat(400));
console.log(`\n  truncateTweet caps at ${tweetLength(long)} chars`);
console.log(`  poster refuses over 280 (src/poster.ts)`);
console.log(bad ? `\n  ${bad} UNDERCOUNT(S)` : '\n  no undercount: every post is measured at or above what X will charge it');
process.exit(bad ? 1 : 0);
