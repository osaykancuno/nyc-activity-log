import { config, club } from '../config';
import { log } from '../logger';
import { getStats } from '../api/nyc';
import { getRegatta, getRelayStats } from '../api/relay';
import { erc721EnumerableAbi } from '../chain/abi';
import { claimOpen, fleetCount, headBlock, publicClient } from '../chain/client';
import { enqueue } from '../poster';
import { renderWatchCard } from '../render/card';
import { watchPost } from '../templates';
import { fmtInt, logDate, watchName } from '../util';
import { getState, setLastWatch } from '../store';

const l = log('watch');

/**
 * Module E. Twice a day, three numbers anyone can recompute:
 *   afloat    = totalMinted() - yachts burned in forges   (chain, always)
 *   fleet     = hulls that exist     (chain when NORMIES_CONTRACT is set, club API otherwise)
 *   unclaimed = fleet - totalMinted()
 * Nothing else. A number we cannot point at is a number we do not publish.
 */
export async function runWatch(force = false): Promise<void> {
  const [count, block, open] = await Promise.all([fleetCount(), headBlock(), claimOpen()]);
  const { afloat, claimed, burned, islands } = count;
  // From 2 Nov 2026 12:00 UTC nothing awaits a claim: what was not claimed is never built.
  const claimClosed = open === false;

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

  // A burned yacht was claimed first, so it still counts against the unclaimed.
  const unclaimed = Math.max(0, fleet - claimed);
  const prev = getState().lastWatch;
  // A watch saved before 14 Sep 2026 stored totalMinted() as "afloat". Measured
  // against the yachts really afloat, every forge so far would read as a change
  // since that watch - so that one comparison is skipped, as on a first watch.
  const deltaAfloat = prev && prev.claimed != null ? afloat - prev.afloat : null;

  /*
   * The watch is kept twice a day whether or not the fleet moved. It used to
   * fall silent on a still day, which was honest and also made the log vanish
   * for days at a stretch - a watch kept only on busy days is not a watch.
   *
   * What keeps it from reading as the same post twice is that a still day is
   * written as a different one: it leads with how far the chain travelled while
   * nothing changed hands, which is a figure nobody has seen before and one
   * anyone can check.
   */
  const blocksSince = prev?.block ? block - BigInt(prev.block) : null;
  // After the close a Normie burned makes no yacht, so the fleet count no longer
  // says anything moved: only the yachts afloat do.
  const still = !!prev && deltaAfloat === 0 && (claimClosed || prev.fleet === fleet);
  if (still) l.info(`nothing moved since the last watch - logging the ${blocksSince ?? '?'} blocks that passed anyway`);

  const at = new Date();

  // The relay counts captains; the chain counts hulls. Where they overlap they
  // are cross-checked, and the chain always wins.
  const relay = await getRelayStats();
  // What the relay counts as "afloat" has moved under us: 819 = 818 yachts + 1
  // island on 14 Sep 2026, 808 = the yachts alone on 16 Sep. The contract is
  // published either way; only a figure that is neither is worth a warning.
  if (relay && relay.afloat !== afloat) {
    if (relay.afloat === afloat + islands) l.info(`relay counts its ${islands} island(s) in afloat=${relay.afloat}; this log publishes ${afloat} yachts`);
    else l.warn(`relay says afloat=${relay.afloat}, the contract says ${afloat} yachts (${islands} island(s) besides) - publishing the contract`);
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

  // The club API's class counts describe the claim set, yachts never built
  // included: true while the claim is open, not once it has closed.
  let chips: [string, string][] | undefined;
  if (!claimClosed) try {
    const st = await getStats();
    chips = Object.entries(st.classes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, fmtInt(v)] as [string, string]);
  } catch {
    chips = undefined;
  }

  // The note carries the standing detail rather than a fifth row: five rows
  // would run the bar and the chips into the caption.
  const source = burned
    ? `totalMinted() ${fmtInt(claimed)} less ${fmtInt(burned)} burned`
    : 'totalMinted()';
  const note = still && blocksSince
    ? `${fmtInt(Number(blocksSince))} blocks since the last watch \u00b7 ${source} at ${fmtInt(Number(block))}`
    : `${source} at block ${fmtInt(Number(block))} \u00b7 verify it yourself`;

  const captains = relay?.members ? ([['Captains', fmtInt(relay.members)]] as [string, string][]) : [];
  const media = claimClosed
    ? renderWatchCard(
      [['Afloat', fmtInt(afloat)], ['Islands', fmtInt(islands)], ['Yachts burned', fmtInt(burned)], ...captains],
      `${watchName(at)} watch`,
      logDate(at),
      note,
      { subtitle: season ?? undefined },
    )
    : renderWatchCard(
      [
        ['Afloat', fmtInt(afloat)],
        [burnedFromChain ? 'Born from burns' : 'Fleet on record', fmtInt(fleet)],
        ['Awaiting claim', fmtInt(unclaimed)],
        ...captains,
      ],
      `${watchName(at)} watch`,
      logDate(at),
      note,
      { bar: { label: 'Claimed', value: claimed, total: fleet }, chips, subtitle: season ?? undefined },
    );

  enqueue({
    key: force ? `watch:forced:${Date.now()}` : `watch:${at.toISOString().slice(0, 13)}`,
    kind: 'watch',
    text: watchPost({ afloat, fleet, unclaimed, deltaAfloat, burnedFromChain, block, regatta: season, blocksSince, burned, claimClosed, islands }, at),
    media,
    priority: 50,
  });

  setLastWatch({ at: at.toISOString(), afloat, claimed, fleet, unclaimed, block: block.toString() });
}
