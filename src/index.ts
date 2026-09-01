import cron from 'node-cron';
import { createServer } from 'node:http';
import { club, config, hasXCredentials, yoko } from './config';
import { log } from './logger';
import { initStore, budget, effectiveCeiling, getState } from './store';
import { initFonts } from './render/card';
import { classify } from './chain/classify';
import { poll, resolveStartBlock } from './chain/watcher';
import { handleEvent } from './modules/events';
import { runWatch } from './modules/watch';
import { runLookup } from './modules/lookup';
import { runTide } from './modules/tide';
import { runForgeWatch } from './modules/forge';
import { runJournal } from './modules/journal';
import { queueStats } from './poster';
import { redactUrl, sleep } from './util';

const l = log('main');

let cursor = 0n;
let stopping = false;
let consecutiveErrors = 0;

function banner(): void {
  const entries = Object.entries(config.modules);
  const on = entries.filter(([, v]) => v).map(([k, v]) => (v === 'auto' ? `${k}(auto)` : k));
  const off = entries.filter(([, v]) => !v).map(([k]) => k);
  l.info(`${club.club.name} Activity Log \u2014 official, CC0. ${club.voice.disclaimer}`);
  l.info(`mode: ${config.dryRun ? 'DRY RUN (nothing is posted)' : 'LIVE'}`);
  l.info(`modules on : ${on.join(', ') || 'none'}`);
  l.info(`modules off: ${off.join(', ') || 'none'}`);
  l.info(`rpc: ${config.rpcUrls.map(redactUrl).join(' , ')}`);
  if (!config.dryRun && !hasXCredentials()) l.warn('LIVE mode without X credentials \u2014 posts will fail. Set the four X_* values.');
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const { groups, next } = await poll(cursor);
      cursor = next;
      consecutiveErrors = 0;

      for (const g of groups) {
        const events = await classify(g);
        for (const ev of events) await handleEvent(ev);
      }
    } catch (e) {
      consecutiveErrors++;
      const backoff = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(consecutiveErrors, 6));
      l.error(`poll failed (${consecutiveErrors}), backing off ${Math.round(backoff / 1000)}s`, e);
      await sleep(backoff);
      continue;
    }
    await sleep(config.pollIntervalMs);
  }
}

function health(): void {
  if (!config.healthPort) return;
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      dryRun: config.dryRun,
      cursor: cursor.toString(),
      queue: queueStats(),
      lastWatch: getState().lastWatch,
      startedAt: getState().startedAt,
    }, null, 2));
  }).listen(config.healthPort, () => l.info(`health on :${config.healthPort}`));
}

async function main(): Promise<void> {
  banner();
  initStore();
  initFonts();
  health();

  cursor = await resolveStartBlock();
  l.info(`starting at block ${cursor}`);
  const b = budget();
  const ceiling = effectiveCeiling();
  l.info(`budget this month: $${b.usedUsd.toFixed(3)} of $${b.maxUsd} (${b.used}/${b.max} posts)`);
  l.info(`ceiling: ${ceiling.posts} posts, bound by ${ceiling.boundBy} at $${config.costPerPostUsd} each. A busy month stops there.`);

  if (config.modules.watch) {
    cron.schedule(config.watchCronMorning, () => { void runWatch().catch((e) => l.error('watch failed', e)); }, { timezone: 'UTC' });
    cron.schedule(config.watchCronEvening, () => { void runWatch().catch((e) => l.error('watch failed', e)); }, { timezone: 'UTC' });
    l.info(`watch scheduled: "${config.watchCronMorning}" and "${config.watchCronEvening}" UTC`);
  }

  if (config.modules.journal) {
    cron.schedule(config.journalCron, () => { void runJournal().catch((e) => l.error('journal failed', e)); }, { timezone: 'UTC' });
    l.info(`Yoko's entry scheduled: "${config.journalCron}" UTC (agent #${yoko.agent.agentId}, Normie #${yoko.agent.tokenId})`);
  }

  if (config.modules.tide) {
    const tick = () => { void runTide().catch((e) => l.error('tide failed', e)); };
    tick();
    setInterval(tick, config.tidePollMs);
    l.info(`tide polling every ${Math.round(config.tidePollMs / 60000)} min via ${config.relayUrl}`);
  }

  if (config.modules.forge !== false) {
    const tick = () => { void runForgeWatch().catch((e) => l.error('forge watch failed', e)); };
    tick();
    setInterval(tick, config.forgePollMs);
    l.info(`forge phase ${config.modules.forge === 'auto' ? 'follows the relay' : 'forced on'}`);
  }

  if (config.modules.lookup) {
    setInterval(() => { void runLookup().catch((e) => l.error('lookup failed', e)); }, 3 * 60 * 1000);
    l.info('lookup polling every 3 minutes');
  }

  await loop();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    l.info(`${sig} \u2014 the log closes. Cursor saved.`);
    stopping = true;
    setTimeout(() => process.exit(0), 1500);
  });
}

process.on('unhandledRejection', (e) => l.error('unhandled rejection', e));

main().catch((e) => {
  l.error('fatal', e);
  process.exit(1);
});
