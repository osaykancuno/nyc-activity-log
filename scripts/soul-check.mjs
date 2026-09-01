/**
 * Every line Yoko owns, in every bank, against every guard.
 * Run it after editing data/yoko.json: `npm run tools:soul`.
 */
import { composeEntry, bankFor } from '../src/soul.ts';
import { getAgentFacts } from '../src/api/agent.ts';
import { tweetLength, voiceViolations } from '../src/util.ts';
import { yoko } from '../src/config.ts';

const agent = await getAgentFacts();
const shapes = [
  { claims: 0, moved: 0, tides: 0, forges: 0 },
  { claims: 0, moved: 0, tides: 1, forges: 0 },
  { claims: 1, moved: 0, tides: 0, forges: 0 },
  { claims: 4, moved: 0, tides: 0, forges: 0 },
  { claims: 0, moved: 1, tides: 0, forges: 0 },
  { claims: 0, moved: 7, tides: 1, forges: 0 },
  { claims: 3, moved: 12, tides: 1, forges: 1 },
  // Absurd on purpose: the busiest day this collection could ever have.
  { claims: 999, moved: 1234, tides: 9, forges: 9 },
];

// X gives a free account 280 characters. Every template in this repo aims at
// 272 and the poster refuses anything over 280, so the margin is checked here
// rather than discovered on a day when the log has something to say.
const X_FREE_LIMIT = 280;

let worst = 0, bad = 0, n = 0, longest = '';
const seen = new Set();

for (let d = 0; d < 40; d++) {
  const at = new Date(Date.UTC(2026, 8, 1 + d, 21, 45));
  for (const s of shapes) {
    const facts = { ...s, afloat: 824, at };
    const e = composeEntry(facts, agent, []);
    const len = tweetLength(e.text);
    n++;
    if (len > worst) { worst = len; longest = e.text; }
    seen.add(`${bankFor(facts)}|${e.text.split('\n')[3]}`);

    const problems = [];
    if (len > X_FREE_LIMIT) problems.push(`${len} chars, over X's free limit`);
    if (voiceViolations(e.text).length) problems.push(`voice: ${voiceViolations(e.text)}`);
    if (/https?:\/\//.test(e.text)) problems.push('url');
    if (/\{\w+\}/.test(e.text)) problems.push('unfilled placeholder');
    for (const r of yoko.forbid) if (new RegExp(r, 'i').test(e.text)) problems.push(`forbidden: ${r}`);
    if (problems.length) { bad++; console.log(`FAIL ${problems.join(', ')}\n${e.text}\n`); }
  }
}

console.log(`${n} entries composed, ${seen.size} distinct openers, longest ${worst} chars of ${X_FREE_LIMIT} (${X_FREE_LIMIT - worst} to spare), ${bad} failures`);
console.log(`longest entry:
${'─'.repeat(52)}
${longest}
${'─'.repeat(52)}`);

// One of each bank, printed, so the voice can be read rather than trusted.
for (const s of shapes) {
  const facts = { ...s, afloat: 824, at: new Date(Date.UTC(2026, 8, 4, 21, 45)) };
  const e = composeEntry(facts, agent, []);
  console.log(`\n── ${e.bank} (${s.claims} claimed, ${s.moved} moved, ${s.tides} tide) ${'─'.repeat(20)}\n${e.text}`);
}
process.exit(bad ? 1 : 0);
