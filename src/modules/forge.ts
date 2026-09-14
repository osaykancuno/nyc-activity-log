import { config } from '../config';
import { log } from '../logger';
import { getActivation, getForge, getIslands } from '../api/relay';
import { enqueue } from '../poster';
import { renderWatchCard } from '../render/card';
import { forgeOpenPost, type IslandFacts } from '../templates';
import { runtime } from '../runtime';
import { fmtInt, sleep } from '../util';
import { alreadyPosted, markPosted } from '../store';

const l = log('forge');

/**
 * The club's grade for an island that was forged a minute ago. The relay may
 * not have graded it yet, so it is asked a few times, about a minute and a half
 * in all; after that the post goes out without a grade rather than not at all.
 * `/islands` also names the owner - that field is never read.
 */
export async function islandFacts(islandId: number, tries = 4): Promise<IslandFacts | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const row = (await getIslands())?.islands?.find((i) => Number(i.islandId) === islandId);
    if (row?.grade) {
      const act = await getActivation(islandId);
      return {
        grade: row.grade,
        score: row.score ?? null,
        residents: row.residents ?? null,
        services: row.services ?? null,
        wakeAp: act?.currency === 'AP' && act.price != null ? act.price : null,
      };
    }
    if (attempt < tries) {
      l.info(`island #${islandId} is not graded by the relay yet (try ${attempt}/${tries}) - asking again in 31s`);
      await sleep(31_000); // past the 30s cache on /islands
    }
  }
  l.warn(`island #${islandId} still has no grade on the relay - the post goes out without one`);
  return null;
}

/**
 * Module I, half of it. The burn detector lives in the classifier; this decides
 * when it is armed, by asking the club rather than by trusting a date typed
 * into a config file months earlier. `MODULE_FORGE=auto` is the default.
 */
export async function runForgeWatch(): Promise<void> {
  if (config.modules.forge === false) return;

  if (config.modules.forge === true) {
    if (!runtime.forgeArmed) l.info('forge detection armed by configuration');
    runtime.forgeArmed = true;
    return;
  }

  const forge = await getForge();
  if (!forge) return;

  const open = forge.phase !== 'announced' && forge.phase !== 'closed';
  if (open !== runtime.forgeArmed) {
    l.info(`relay says the forge is "${forge.phase}" - burn detection ${open ? 'armed' : 'disarmed'}`);
    runtime.forgeArmed = open;
  }

  if (!open) return;

  const opensAt = forge.window?.opensAt ?? null;
  const key = `forge:open:${opensAt ?? forge.phase}`;
  if (alreadyPosted(key)) return;

  // The forge opens once and never closes, so this post can only be news in the
  // first minutes. Past that, note it and say nothing: a log that restarted with
  // an empty ledger posted "The forge is open" three times on 14 Sep 2026.
  const FRESH = 60 * 60 * 1000;
  if (!opensAt || Date.now() - opensAt > FRESH) {
    markPosted(key, { kind: 'seed' });
    l.info(`the forge opened ${opensAt ? new Date(opensAt).toISOString() : 'at an unknown time'} - too long ago to announce, noted`);
    return;
  }
  const media = renderWatchCard(
    [
      ['Yachts per island', fmtInt(10)],
      ['Islands forged', fmtInt(forge.forged ?? 0)],
      ['Fleet net', '-9'],
    ],
    'the forge',
    'The forge is open',
    'It never closes again. Visiting is never limited.',
  );

  enqueue({
    key,
    kind: 'forge-open',
    text: forgeOpenPost(opensAt),
    media,
    priority: 92,
  });
}
