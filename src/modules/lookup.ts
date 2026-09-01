import { config } from '../config';
import { log } from '../logger';
import { enqueue } from '../poster';
import { renderYachtCard } from '../render/card';
import { lookupReply } from '../templates';
import { getState, setMentionSinceId } from '../store';
import { fetchMentions } from '../x/client';
import { resolveYacht } from '../yacht';

const l = log('lookup');

const MAX_ID = 20000;

/** Module D. One reply per mention, traits and art only. Never an owner. */
export async function runLookup(): Promise<void> {
  if (!config.modules.lookup) return;

  let mentions;
  try {
    mentions = await fetchMentions(getState().mentionSinceId);
  } catch (e: any) {
    l.error('mentions unavailable (the X free tier grants no read access)', e?.data ?? e);
    return;
  }
  if (!mentions.length) return;

  for (const m of mentions) {
    setMentionSinceId(m.id);
    const id = parseHullId(m.text);
    if (id === null) continue;

    try {
      const y = await resolveYacht(id);
      const media = renderYachtCard(y, 'lookup', {
        title: `Yacht #${y.id}`,
        subtitle: `${y.class}${y.rarityRank != null ? ` \u00b7 rank ${y.rarityRank}` : ''} \u00b7 ${y.anchorPointsPerDay} AP/day`,
        note: `born from Normie #${y.normieId}`,
      });
      enqueue({ key: `lookup:${m.id}`, kind: 'lookup', text: lookupReply(y), media, replyTo: m.id, priority: 30 });
    } catch (e) {
      l.warn(`no hull #${id}`, e);
    }
  }
}

/** "#1709" anywhere in the text. First match wins, one reply per mention. */
export function parseHullId(text: string): number | null {
  const m = text.match(/#(\d{1,5})\b/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id >= 0 && id < MAX_ID ? id : null;
}
