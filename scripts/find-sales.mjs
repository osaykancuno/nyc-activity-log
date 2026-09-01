import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';

const NYC = '0x87306c282eBd62Fe1c80AA69Dd9408331Dc11f64';
const ZERO = '0x0000000000000000000000000000000000000000';
const client = createPublicClient({ chain: mainnet, transport: http(process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com') });
const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

const head = await client.getBlockNumber();
const chunk = 100n;
let found = [];
for (let i = 0n; i < 150n && found.length < 6; i++) {
  const to = head - i * chunk;
  const from = to - chunk + 1n;
  let logs = [];
  try { logs = await client.getLogs({ address: NYC, event: ev, fromBlock: from, toBlock: to }); } catch (e) { console.error('range fail', from, e.message.slice(0,80)); continue; }
  for (const lg of logs) {
    if (lg.args.from.toLowerCase() === ZERO) continue;
    found.push({ tx: lg.transactionHash, block: lg.blockNumber.toString(), tokenId: lg.args.tokenId.toString(), from: lg.args.from, to: lg.args.to });
  }
  if (logs.length) console.error(`blocks ${from}-${to}: ${logs.length} transfers`);
}
console.log(JSON.stringify(found.slice(0, 8), null, 2));
