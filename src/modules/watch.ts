import { config, club } from '../config';
import { log } from '../logger';
import { getStats } from '../api/nyc';
import { getRegatta, getRelayStats } from '../api/relay';
import { erc721EnumerableAbi } from '../chain/abi';
import { headBlock, publicClient, totalMinted } from '../chain/client';
import { enqueue } from '../poster';
import { renderWatchCard } from '../render/card';
import { watchPost } from '../templates';
import { fmtInt, logDate, watchName } from '../util';
import { getState, setLastWatch } from '../store';

const l = log('watch');

/**
 * Module E. Twice a day, three numbers anyone can recompute:
 *   afloat    = totalMinted()        (chain, always)
 *   fleet     = hulls that exist     (chain when NORMIES_CONTRACT is set, club API otherwise)
 *   unclaimed = fleet - afloat
 * Nothing else. A number we cannot point at is a number we do not publish.
 */
export async function runWatch(force = false): Promise<void> {
  const [minted, block] = await Promise.all([totalMinted(), headBlock()]);
  const afloat = Number(minted);

  let fleet: number;
  let burnedFromChain = false;

  if (config.normiesContract) {
    try {
      const supply = await publicClient.readContract({
        address: config.normiesContract as `0x${string}`,
        abi: erc721EnumerableAbi,
        functionName: 'totalSupply',
      });
      fleet = club.contract.normiesSupplyCap - Number(supply);
      burnedFromChain = true;
    } catch (e) {
      l.warn('Normies totalSupply() failed, falling back to the club API', e);
      fleet = (await getStats(true)).yachts;
    }
  } else {
    fleet = (await getStats(true)).yachts;
  }

  const unclaimed = Math.max(0, fleet - afloat);
  const prev = getState().lastWatch;
  const deltaAfloat = prev ? afloat - prev.afloat : null;

  if (!force && prev && deltaAfloat === 0 && prev.fleet === fleet) {
    l.info('nothing moved since the last watch - staying quiet');
    setLastWatch({ at: new Date().toISOString(), afloat, fleet, unclaimed });
    return;
  }

  const at = new Date();

  // The relay counts captains; the chain counts hulls. Where they overlap they
  // are cross-checked, and the chain always wins.
  const relay = await getRelayStats();
  if (relay && relay.afloat !== afloat) {
    l.warn(`relay says afloat=${relay.afloat}, the contract says ${afloat} - publishing the contract`);
  }

  // The season, when one is running. Straight from the club's relay, no scoring
  // and no captains - only which season it is and how far along.
  let season: string | null = null;
  try {
    const r = await getRegatta();
    const sn = r?.season;
    if (sn && sn.status === 'active' && sn.day && sn.days) season = `${sn.name}, day ${sn.day} of ${sn.days}.`;
  } catch (e) {
    l.debug('regatta unavailable', e);
  }

  let chips: [string, string][] | undefined;
  try {
    const st = await getStats();
    chips = Object.entries(st.classes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, fmtInt(v)] as [string, string]);
  } catch {
    chips = undefined;
  }

  const media = renderWatchCard(
    [
      ['Afloat', fmtInt(afloat)],
      [burnedFromChain ? 'Born from burns' : 'Fleet on record', fmtInt(fleet)],
      ['Awaiting claim', fmtInt(unclaimed)],
      ...(relay?.members ? ([['Captains', fmtInt(relay.members)]] as [string, string][]) : []),
    ],
    `${watchName(at)} watch`,
    logDate(at),
    `totalMinted() at block ${fmtInt(Number(block))} \u00b7 verify it yourself`,
    { bar: { label: 'Claimed', value: afloat, total: fleet }, chips, subtitle: season ?? undefined },
  );

  enqueue({
    key: force ? `watch:forced:${Date.now()}` : `watch:${at.toISOString().slice(0, 13)}`,
    kind: 'watch',
    text: watchPost({ afloat, fleet, unclaimed, deltaAfloat, burnedFromChain, block, regatta: season }, at),
    media,
    priority: 50,
  });

  setLastWatch({ at: at.toISOString(), afloat, fleet, unclaimed });
}
