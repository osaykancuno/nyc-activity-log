import { config } from '../config';
import { log } from '../logger';
import { getForge } from '../api/relay';
import { enqueue } from '../poster';
import { renderWatchCard } from '../render/card';
import { forgeOpenPost } from '../templates';
import { runtime } from '../runtime';
import { fmtInt } from '../util';

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

  // Arm quietly if the forge opened long before this log did.
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  if (opensAt && Date.now() - opensAt > WEEK) return;
  const media = renderWatchCard(
    [
      ['Hulls per island', fmtInt(10)],
      ['Islands forged', fmtInt(forge.forged ?? 0)],
      ['Fleet net', '-9'],
    ],
    'the forge',
    'The forge is open',
    'It never closes again. Visiting is never limited.',
  );

  enqueue({
    key: `forge:open:${opensAt ?? forge.phase}`,
    kind: 'forge-open',
    text: forgeOpenPost(opensAt),
    media,
    priority: 92,
  });
}
