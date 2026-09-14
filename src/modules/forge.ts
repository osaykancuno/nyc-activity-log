import { config } from '../config';
import { log } from '../logger';
import { getForge } from '../api/relay';
import { enqueue } from '../poster';
import { renderWatchCard } from '../render/card';
import { forgeOpenPost } from '../templates';
import { runtime } from '../runtime';
import { fmtInt } from '../util';
import { alreadyPosted, markPosted } from '../store';

const l = log('forge');

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
