import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config';
import { log } from './logger';
import { alreadyPosted, budget, countPost, markPosted, noteActivity } from './store';
import { postToX } from './x/client';
import { tweetLength, voiceViolations } from './util';

const l = log('poster');

export interface Job {
  key: string;
  kind: string;
  text: string;
  media?: Buffer;
  replyTo?: string;
  /** Higher goes first, and survives longer when the monthly budget runs low. */
  priority: number;
}

const queue: Job[] = [];
let running = false;
let lastPostAt = 0;
let posted = 0;
let skipped = 0;

export const queueStats = () => ({ pending: queue.length, posted, skipped, ...budget() });

/** Resolves once everything queued has been dealt with. Used by the CLI. */
export async function waitForQueue(): Promise<void> {
  while (queue.length || running) await new Promise((r) => setTimeout(r, 200));
}

export function enqueue(job: Job): boolean {
  if (alreadyPosted(job.key)) {
    l.debug(`already logged: ${job.key}`);
    return false;
  }
  if (queue.some((j) => j.key === job.key)) return false;

  const bad = voiceViolations(job.text);
  if (bad.length) {
    l.error(`refused: marketplace voice in ${job.key} -> ${bad.join(', ')}`);
    skipped++;
    return false;
  }
  // X charges $0.015 for a post and $0.200 for a post carrying a URL. The log
  // never needed links - it prints block numbers - so a link here is a mistake,
  // and a thirteenfold one.
  if (/https?:\/\/|t\.co\//i.test(job.text)) {
    l.error(`refused: ${job.key} contains a URL, which X bills at $0.200 instead of $0.015`);
    skipped++;
    return false;
  }
  if (tweetLength(job.text) > 280) {
    l.error(`refused: ${job.key} is ${tweetLength(job.text)} chars`);
    skipped++;
    return false;
  }

  queue.push(job);
  queue.sort((a, b) => b.priority - a.priority);
  l.info(`queued ${job.kind} ${job.key} (${queue.length} pending)`);
  void drain();
  return true;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const wait = config.postMinIntervalMs - (Date.now() - lastPostAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      const job = queue.shift()!;
      if (alreadyPosted(job.key)) continue;

      const b = budget();
      if (b.leftUsd <= 0 || b.left <= 0) {
        l.warn(`monthly budget spent ($${b.usedUsd.toFixed(3)} of $${b.maxUsd}, ${b.used} posts). Dropping ${job.key}.`);
        skipped++;
        continue;
      }
      if ((b.leftUsd <= config.budgetReserveUsd || b.left <= config.budgetReserve) && job.priority < 80) {
        l.warn(`budget reserve reached ($${b.leftUsd.toFixed(3)} left). Keeping it for claims, sweeps and settled rounds; dropping ${job.kind}.`);
        skipped++;
        continue;
      }

      try {
        if (config.dryRun) {
          writeDryRun(job);
        } else {
          await postToX({ text: job.text, media: config.attachMedia ? job.media : undefined, replyTo: job.replyTo });
          countPost();
        }
        markPosted(job.key, { kind: job.kind, dryRun: config.dryRun });
        noteActivity(job.kind);
        lastPostAt = Date.now();
        posted++;
      } catch (e: any) {
        const status = e?.code ?? e?.data?.status;
        if (status === 429) {
          l.warn('rate limited by X, backing off 15 minutes');
          queue.unshift(job);
          await new Promise((r) => setTimeout(r, 15 * 60 * 1000));
        } else if (status === 402) {
          // The account has no write credits on its X plan. Nothing is wrong with
          // the post, so keep it and stop trying: retrying only burns rate limit.
          l.error('X says the plan has no posting credits left (402). Holding the queue for 30 minutes; check the plan in the developer portal.', e?.data ?? e);
          queue.unshift(job);
          await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
        } else if (status === 403 || status === 401) {
          l.error('X refused the request (auth or permissions). Check the app is Read+Write and the tokens were made after that change.', e?.data ?? e);
          skipped++;
        } else {
          l.error(`post failed for ${job.key}, retrying once later`, e?.data ?? e);
          skipped++;
        }
      }
    }
  } finally {
    running = false;
  }
}

function writeDryRun(job: Job): void {
  mkdirSync(config.paths.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}_${job.kind}_${job.key.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`;
  writeFileSync(resolve(config.paths.out, `${base}.txt`), `${job.text}\n`);
  if (job.media) writeFileSync(resolve(config.paths.out, `${base}.png`), job.media);
  l.info(`DRY RUN -> out/${base}.txt${job.media ? ' (+ png)' : ''}`);
  console.log(`\n${'\u2500'.repeat(52)}\n${job.text}\n${'\u2500'.repeat(52)} ${tweetLength(job.text)} chars\n`);
}
