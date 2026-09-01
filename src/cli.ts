import { parseEther } from 'viem';
import { club, config, hasXCredentials, yoko } from './config';
import { log } from './logger';
import { initStore } from './store';
import { initFonts, renderYachtCard } from './render/card';
import { getStats } from './api/nyc';
import { headBlock, totalMinted, publicClient } from './chain/client';
import { classify, type ChainEvent } from './chain/classify';
import { handleEvent } from './modules/events';
import { runWatch } from './modules/watch';
import { previewTide } from './modules/tide';
import { runForgeWatch } from './modules/forge';
import { runJournal } from './modules/journal';
import { parseHullId } from './modules/lookup';
import { enqueue, waitForQueue } from './poster';
import { lookupReply, pedigree, pedigreePost, suggestedBio } from './templates';
import { fmtInt } from './util';
import { resolveYacht, resolveYachts } from './yacht';
import { getChandlery, getForge, getRelayStats, getTide, relayHealth } from './api/relay';
import { club as clubData } from './config';

const l = log('cli');
const [, , cmd = 'help', ...rest] = process.argv;

const fakeEvent = (over: Partial<ChainEvent>): ChainEvent => ({
  kind: 'claim', key: `preview:${Date.now()}`, txHash: `0x${'0'.repeat(64)}`,
  blockNumber: 0n, at: new Date(), tokenIds: [0],
  from: '0x0000000000000000000000000000000000000000',
  to: '0x1111111111111111111111111111111111111111',
  priority: 99, ...over,
});

const HELP = `
  nyc-activity-log cli

    npm run cli -- verify                      check API, RPC, contract, X credentials
    npm run cli -- preview claim 1709          render + print a claim post
    npm run cli -- preview sale 1709 2.4       render + print a sale post at 2.4 ETH
    npm run cli -- preview sweep 12,44,1709    render + print a sweep post
    npm run cli -- preview lookup 1709         render + print a lookup reply
    npm run cli -- preview watch               build the watch post from live numbers
    npm run cli -- preview journal             write Yoko's entry for today, now
    npm run cli -- soul                        who is keeping this log, and on what numbers
    npm run cli -- tx 0xabc...                 replay a real transaction through the pipeline
    npm run cli -- backfill 25890000 25890500  replay a block range
    npm run cli -- pedigree 1,2,3,4,5,6,7,8,9,10   weight of a forge set
`;

async function verify(): Promise<void> {
  console.log(`\n  ${club.club.name} Activity Log \u2014 preflight\n`);

  const stats = await getStats(true);
  console.log(`  club API      ok   fleet ${fmtInt(stats.yachts)}, snapshot ${stats.generatedAt}`);

  const [block, minted] = await Promise.all([headBlock(), totalMinted()]);
  console.log(`  rpc           ok   head block ${fmtInt(Number(block))}`);
  console.log(`  contract      ok   totalMinted() = ${fmtInt(Number(minted))} (${fmtInt(stats.yachts - Number(minted))} awaiting claim)`);

  const y = await resolveYacht(1709);
  console.log(`  metadata      ok   #${y.id} ${y.class}, art ${y.art.onPixels} lit pixels, source ${y.source}`);

  const health = await relayHealth();
  if (health) {
    console.log(`  club relay    ok   ${health}`);
    const [tide, forge, rstats, chandlery] = await Promise.all([getTide(), getForge(), getRelayStats(), getChandlery()]);
    if (tide?.round) {
      const r = tide.round;
      console.log(`  tide          ok   round ${r.id} for ${r.prize}, ${r.fleet?.length ?? 0} hulls in, closes ${new Date(r.closesAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    }
    if (forge) {
      const opens = forge.window?.opensAt ? new Date(forge.window.opensAt).toISOString().slice(0, 16).replace('T', ' ') : 'unannounced';
      console.log(`  forge         ok   phase "${forge.phase}", opens ${opens} UTC, ${forge.forged} forged`);
    }
    if (rstats && rstats.afloat !== Number(minted)) {
      console.log(`  cross-check   --   relay says afloat ${rstats.afloat}, the contract says ${minted}. The contract wins.`);
    } else if (rstats) {
      console.log(`  cross-check   ok   relay and contract agree: ${rstats.afloat} afloat, ${rstats.members} captains`);
    }
    if (chandlery?.catalog) {
      const drift = Object.entries(chandlery.catalog)
        .filter(([k, v]) => typeof (clubData.chandlery as any)[k] === 'number' && (clubData.chandlery as any)[k] !== v.price)
        .map(([k, v]) => `${k} ${(clubData.chandlery as any)[k]}->${v.price}`);
      console.log(drift.length
        ? `  chandlery     --   club.json is stale: ${drift.join(', ')}`
        : `  chandlery     ok   catalog matches club.json (${Object.keys(chandlery.catalog).length} items)`);
    }
  } else {
    console.log('  club relay    --   not answering; the Tide module will stay quiet');
  }

  if (hasXCredentials()) {
    try {
      const { whoAmI } = await import('./x/client');
      const me = await whoAmI();
      console.log(`  x account     ok   @${me.username} (id ${me.id})`);
      console.log(`\n  Put this in X_USER_ID: ${me.id}`);
    } catch (e: any) {
      console.log(`  x account     FAIL ${e?.data?.detail ?? e?.message ?? e}`);
    }
  } else {
    console.log('  x account     --   no credentials yet (fine while DRY_RUN=true)');
  }

  console.log(`\n  mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`\n  Suggested bio:\n  ${suggestedBio}\n`);
}

async function preview(args: string[]): Promise<void> {
  const [what, arg = '1709', extra] = args;
  const block = await headBlock();

  switch (what) {
    case 'claim':
      return handleEvent(fakeEvent({ kind: 'claim', tokenIds: [Number(arg)], blockNumber: block }));

    case 'sale':
      return handleEvent(fakeEvent({
        kind: 'sale', tokenIds: [Number(arg)], blockNumber: block,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x9f4c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b',
        priceWei: parseEther(extra ?? '2.4'), marketplace: 'Seaport', priceSource: 'seaport',
      }));

    case 'sweep':
      return handleEvent(fakeEvent({
        kind: 'sweep', tokenIds: arg.split(',').map(Number), blockNumber: block,
        priceWei: parseEther(extra ?? '7.1'), marketplace: 'Seaport', priceSource: 'seaport',
        to: '0x9f4c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b',
      }));

    case 'forge':
      return handleEvent(fakeEvent({
        kind: 'forge', tokenIds: arg.split(',').map(Number), blockNumber: block,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      }));

    case 'lookup': {
      const id = parseHullId(`#${arg}`) ?? Number(arg);
      const y = await resolveYacht(id);
      const media = renderYachtCard(y, 'lookup', {
        title: `Yacht #${y.id}`,
        subtitle: `${y.class}${y.rarityRank != null ? ` \u00b7 rank ${y.rarityRank}` : ''} \u00b7 ${y.anchorPointsPerDay} AP/day`,
        note: `born from Normie #${y.normieId}`,
      });
      enqueue({ key: `preview:lookup:${id}:${Date.now()}`, kind: 'lookup', text: lookupReply(y), media, priority: 99 });
      return;
    }

    case 'watch':
      return runWatch(true);

    case 'journal':
      return runJournal(true);

    case 'tide':
      return previewTide();

    case 'forge-phase':
      return runForgeWatch();

    default:
      l.error(`unknown preview "${what}"`);
  }
}

/** Replay one real transaction through the whole pipeline. The honest test. */
async function fromTx(hash?: string): Promise<void> {
  if (!hash) return l.error('give me a transaction hash');

  const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
  const blk = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  const transfers = receipt.logs
    .filter((lg) => lg.address.toLowerCase() === club.contract.address.toLowerCase() && lg.topics.length === 4)
    .map((lg, i) => ({
      from: `0x${lg.topics[1]!.slice(26)}` as `0x${string}`,
      to: `0x${lg.topics[2]!.slice(26)}` as `0x${string}`,
      tokenId: BigInt(lg.topics[3]!),
      logIndex: lg.logIndex ?? i,
    }));

  if (!transfers.length) return l.warn('no NYC transfers in that transaction');
  console.log(`  ${transfers.length} hull transfer(s) in ${hash}`);

  const events = await classify({
    txHash: hash as `0x${string}`,
    blockNumber: receipt.blockNumber,
    timestamp: new Date(Number(blk.timestamp) * 1000),
    transfers,
  });

  if (!events.length) return l.warn('classified as: nothing to publish (a transfer with no proven payment)');
  for (const ev of events) {
    console.log(`  -> ${ev.kind} via ${ev.marketplace ?? 'n/a'} (${ev.priceSource ?? 'no price'})`);
    await handleEvent(ev);
  }
}

async function backfill(args: string[]): Promise<void> {
  const from = BigInt(args[0] ?? '0');
  const to = BigInt(args[1] ?? args[0] ?? '0');
  if (!from) return l.error('give me a from-block');

  const { poll } = await import('./chain/watcher');
  let cursor = from - 1n;
  while (cursor < to) {
    const res = await poll(cursor);
    if (res.next === cursor) break;
    cursor = res.next;
    for (const g of res.groups) for (const ev of await classify(g)) await handleEvent(ev);
  }
  l.info('backfill done');
}

async function doPedigree(args: string[]): Promise<void> {
  const ids = (args[0] ?? '').split(',').filter(Boolean).map(Number);
  if (!ids.length) return l.error('give me hull ids, comma separated');
  console.log(`\n${pedigreePost(pedigree(await resolveYachts(ids)))}\n`);
}

/**
 * Who writes this log. Prints the agent's live numbers beside the snapshot in
 * data/yoko.json, so it is obvious at a glance which one the entries are using.
 */
async function soul(): Promise<void> {
  const { getAgentFacts, getPortrait } = await import('./api/agent');
  const { composeEntry } = await import('./soul');
  const { getJournal } = await import('./store');

  const a = await getAgentFacts(true);
  console.log(`
  ${yoko.agent.name} — agent #${a.agentId}, bound to Normie #${a.tokenId} (${yoko.agent.type})`);
  console.log(`  numbers from  ${a.source === 'api' ? `the agent API, read ${a.readAt.slice(0, 19)}Z` : 'data/yoko.json (the API did not answer)'}`);
  console.log(`  canvas        level ${a.level}, ${a.actionPoints} action points, ${a.transformations} passes`);
  console.log(`  pixels        +${a.pixelsAdded} / -${a.pixelsRemoved}, net ${a.pixelsNet}`);

  const p = await getPortrait();
  console.log(`  portrait      ${p ? `${(p.bits.match(/1/g) ?? []).length} lit pixels, cached` : 'unavailable'}`);

  const j = getJournal();
  console.log(`  today         ${j.claims} claimed, ${j.moved} moved, ${j.tides} tide, entry ${j.lastEntryDay === j.day ? 'written' : 'not written yet'}`);
  console.log(`  vocabulary    ${Object.entries(yoko.lines).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);

  const sample = composeEntry(
    { claims: j.claims, moved: j.moved, tides: j.tides, forges: j.forges, afloat: 0, at: new Date() },
    a,
    [...j.recent],
  );
  console.log(`
${'─'.repeat(52)}
${sample.text}
${'─'.repeat(52)}
`);
}

async function main(): Promise<void> {
  initStore();
  initFonts();
  switch (cmd) {
    case 'verify': return verify();
    case 'preview': return preview(rest);
    case 'tx': return fromTx(rest[0]);
    case 'backfill': return backfill(rest);
    case 'pedigree': return doPedigree(rest);
    case 'soul': return soul();
    default: console.log(HELP);
  }
}

main()
  .then(waitForQueue)
  .catch((e) => {
    l.error('cli failed', e);
    process.exit(1);
  });
