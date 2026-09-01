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
