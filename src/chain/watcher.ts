import type { Log } from 'viem';
import { config } from '../config';
import { log } from '../logger';
import { getState, setLastBlock } from '../store';
import { nycAbi } from './abi';
import { NYC, headBlock, publicClient } from './client';

const l = log('watcher');

export interface TransferRow {
  from: `0x${string}`;
  to: `0x${string}`;
  tokenId: bigint;
  logIndex: number;
}

export interface TxGroup {
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: Date;
  transfers: TransferRow[];
}

let span = BigInt(config.maxBlockSpan);
const MIN_SPAN = 20n;

/** Resolve the starting cursor: saved > START_BLOCK > head. */
export async function resolveStartBlock(): Promise<bigint> {
  const saved = getState().lastBlock;
  if (saved) return BigInt(saved);
  if (config.startBlock !== 'latest' && /^\d+$/.test(config.startBlock)) return BigInt(config.startBlock);
  const head = await headBlock();
  return head - config.confirmations;
}

const isRangeError = (e: unknown): boolean =>
  /invalid param|range|limit|too many|exceed|query returned more/i.test(String((e as Error)?.message ?? e));

/**
 * One polling pass. Transfers come back grouped by transaction, oldest first,
 * so a sweep is seen as one event and not as N sales.
 *
 * Public RPCs cap how wide an eth_getLogs window may be, and they disagree on
 * the cap. Rather than make that the operator's problem, the span shrinks on
 * refusal and creeps back up when the provider is happy.
 */
export async function poll(cursor: bigint): Promise<{ groups: TxGroup[]; next: bigint }> {
  const head = await headBlock();
  const safeHead = head - config.confirmations;
  if (safeHead <= cursor) return { groups: [], next: cursor };

  const from = cursor + 1n;

  for (let attempt = 0; attempt < 4; attempt++) {
    const to = safeHead - from > span ? from + span : safeHead;
    try {
      const logs = await publicClient.getLogs({
        address: NYC,
        event: nycAbi[5] as any, // Transfer
        fromBlock: from,
        toBlock: to,
      });

      if (logs.length) l.info(`blocks ${from}-${to}: ${logs.length} transfer(s)`);
      else l.debug(`blocks ${from}-${to}: quiet`);

      if (span < BigInt(config.maxBlockSpan)) span = span * 2n > BigInt(config.maxBlockSpan) ? BigInt(config.maxBlockSpan) : span * 2n;

      const groups = await groupByTx(logs as Log[]);
      setLastBlock(to);
      return { groups, next: to };
    } catch (e) {
      if (!isRangeError(e) || span <= MIN_SPAN) throw e;
      span = span / 2n > MIN_SPAN ? span / 2n : MIN_SPAN;
      l.warn(`provider refused that window, narrowing to ${span} blocks`);
    }
  }

  throw new Error('getLogs kept failing even at the narrowest window');
}

async function groupByTx(logs: Log[]): Promise<TxGroup[]> {
  const map = new Map<string, TxGroup>();

  for (const raw of logs) {
    const a = (raw as any).args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
    if (!a) continue;
    const txHash = raw.transactionHash as `0x${string}`;
    let g = map.get(txHash);
    if (!g) {
      g = { txHash, blockNumber: raw.blockNumber!, timestamp: new Date(0), transfers: [] };
      map.set(txHash, g);
    }
    g.transfers.push({ from: a.from, to: a.to, tokenId: a.tokenId, logIndex: raw.logIndex ?? 0 });
  }

  // Block timestamps, one call per distinct block.
  const blocks = [...new Set([...map.values()].map((g) => g.blockNumber))];
  const stamps = new Map<bigint, Date>();
  for (const b of blocks) {
    try {
      const blk = await publicClient.getBlock({ blockNumber: b });
      stamps.set(b, new Date(Number(blk.timestamp) * 1000));
    } catch {
      stamps.set(b, new Date());
    }
  }

  for (const g of map.values()) {
    g.timestamp = stamps.get(g.blockNumber) ?? new Date();
    g.transfers.sort((x, y) => x.logIndex - y.logIndex);
  }

  return [...map.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}
