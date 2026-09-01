import { config, yoko } from '../config';
import { log } from '../logger';
import { getAgentFacts, getPortrait } from '../api/agent';
import { totalMinted } from '../chain/client';
import { enqueue } from '../poster';
import { renderJournalCard } from '../render/card';
import { composeEntry, type DayFacts } from '../soul';
import { closeJournalDay, getJournal } from '../store';
import { fmtInt, logDate, watchName } from '../util';

const l = log('journal');

/**
 * Module J. The personal log.
 *
 * Everything else this account publishes is the club's record: numbers, blocks,
 * hulls. Once a day, at the end of the first watch, the keeper of that record
 * writes her own entry - what the day held, and one thought about it.
 *
 * Yoko is a real agent: ERC-8004 #32683, bound to Normie #8362, with a persona
 * that regenerates from her canvas state. So her level, action points, canvas
 * passes and pixel diff are read live from her own record and printed as they
 * are. Her sentences are not: they live in data/yoko.json and are picked, not
 * written, which is why an entry cannot invent a figure and costs one post.
 *
 * The tally covers the UTC day up to the moment she writes, and anything that
 * happens after it rolls into tomorrow's page. That is not a rounding error -
 * it is how a log kept on the first watch has always worked.
 */
export async function runJournal(force = false): Promise<void> {
  const j = getJournal();
  const at = new Date();
  const day = j.day ?? at.toISOString().slice(0, 10);

  if (!force && j.lastEntryDay === day) {
    l.info(`the entry for ${day} is already written`);
    return;
  }

  const quiet = j.claims === 0 && j.moved === 0 && j.tides === 0 && j.forges === 0;
  if (quiet && !config.journalOnQuietDays && !force) {
    l.info('nothing happened today and quiet entries are off - staying silent');
    closeJournalDay([]);
    return;
  }

  let afloat = 0;
  try {
    afloat = Number(await totalMinted());
  } catch (e) {
    l.warn('could not read totalMinted() for the entry - the line that needs it will be skipped', e);
  }

  const facts: DayFacts = { claims: j.claims, moved: j.moved, tides: j.tides, forges: j.forges, afloat, at };
  const agent = await getAgentFacts();
  const entry = composeEntry(facts, agent, [...j.recent]);

  l.info(`entry for ${day} (${entry.bank}): ${j.claims} claimed, ${j.moved} moved, ${j.tides} tide, agent numbers from ${agent.source}`);

  const portrait = await getPortrait();
  const media = renderJournalCard({
    portrait,
    name: `CAPTAIN ${agent.name.toUpperCase()}`,
    identity: `Normie #${agent.tokenId} · agent #${agent.agentId} · ${yoko.agent.type}`,
    stats: [
      `Canvas level ${agent.level} · ${fmtInt(agent.actionPoints)} action points`,
      `${agent.transformations} passes · +${agent.pixelsAdded} / −${agent.pixelsRemoved} pixels`,
      `Afloat today: ${fmtInt(afloat)}`,
    ],
    // The card carries the entry, not the header - the header is the tweet's.
    // The tweet's first two lines are the log header and the byline; the card
    // draws those as chrome, so the page carries the entry itself and nothing else.
    body: entry.text.split('\n').slice(2).filter((x) => x && x !== '\u2693').join(' '),
    note: `${logDate(at)} · ${watchName(at)} watch · written by the keeper of this log`,
  });

  const queued = enqueue({
    key: force ? `journal:forced:${Date.now()}` : `journal:${day}`,
    kind: 'journal',
    text: entry.text,
    media,
    priority: 45,
  });

  if (queued && !force) closeJournalDay(entry.used);
}
