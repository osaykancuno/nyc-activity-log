import { createPublicClient, http, fallback, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { config, club } from '../config';
import { nycAbi } from './abi';
import { log } from '../logger';

const l = log('chain');

export const publicClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    config.rpcUrls.map((u) => http(u, { batch: true, retryCount: 3, timeout: 20_000 })),
    { rank: false },
  ),
});

export const NYC = club.contract.address;

export const totalMinted = () =>
  publicClient.readContract({ address: NYC, abi: nycAbi, functionName: 'totalMinted' });

export const ownerOf = (id: number | bigint) =>
  publicClient.readContract({ address: NYC, abi: nycAbi, functionName: 'ownerOf', args: [BigInt(id)] });

/** A revert, as opposed to an RPC that did not answer. */
const reverted = (e: unknown): boolean =>
  Boolean((e as { walk?: (fn: (c: unknown) => boolean) => unknown })?.walk?.((c) => (c as Error)?.name === 'ContractFunctionRevertedError'));

/** Does this token exist? A revert says no; a failed read is thrown, never taken for a no. */
const exists = (id: number): Promise<boolean> =>
  ownerOf(id).then(() => true, (e) => { if (reverted(e)) return false; throw e; });

/**
 * How many islands have been forged, from the contract alone. Islands are
 * numbered idBase + plot with no gaps, so the count is the first id whose
 * ownerOf reverts - found in a handful of calls however many there are.
 */
export async function islandsForged(): Promise<number> {
  const base = club.islands.idBase;
  if (!(await exists(base))) return 0;
  let lo = 0, hi = 1;
  while (await exists(base + hi)) { lo = hi; hi *= 2; }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(base + mid)) lo = mid; else hi = mid;
  }
  return lo + 1;
}

export interface FleetCount {
  /** totalMinted(): every yacht ever claimed, burned ones included. */
  claimed: number;
  islands: number;
  burned: number;
  /** Yachts that still exist. */
  afloat: number;
}

/**
 * Yachts afloat. totalMinted() counts every yacht ever claimed and never goes
 * down when one is burned: on 14 Sep 2026 it read 828 both before and after the
 * first forge took ten yachts out of the fleet, and the watch went on printing
 * it as "Afloat". Every island burned hullsPerIsland yachts, so afloat is
 * claimed less islands x 10 - and the relay's own count is that plus the islands.
 */
export async function fleetCount(): Promise<FleetCount> {
  const [minted, islands] = await Promise.all([totalMinted(), islandsForged()]);
  const claimed = Number(minted);
  const burned = islands * club.islands.hullsPerIsland;
  return { claimed, islands, burned, afloat: claimed - burned };
}

export const isClaimed = (id: number | bigint) =>
  publicClient.readContract({ address: NYC, abi: nycAbi, functionName: 'claimed', args: [BigInt(id)] });

const ensCache = new Map<string, { at: number; name: string | null }>();
const ENS_TTL = 24 * 60 * 60 * 1000;

/** Best effort. A missing ENS is never an error — we fall back to a short address. */
export async function ensName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  const hit = ensCache.get(key);
  if (hit && Date.now() - hit.at < ENS_TTL) return hit.name;
  try {
    const name = await publicClient.getEnsName({ address: address as `0x${string}` });
    ensCache.set(key, { at: Date.now(), name: name ?? null });
    return name ?? null;
  } catch (e) {
    l.debug(`ens lookup failed for ${address}`, e);
    return null;
  }
}

export async function headBlock(): Promise<bigint> {
  return publicClient.getBlockNumber();
}
