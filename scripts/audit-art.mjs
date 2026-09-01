import { fromChain } from '../src/yacht.ts';
const ids = [0,1,2,3,5,9,13,21,34,55,89,144,233,377,610,987,1234,1597,1709,1800,2000,2222,2500,2702];
let bad = [];
for (const id of ids) {
  await new Promise(r => setTimeout(r, 700));
  let c; try { c = await fromChain(id); } catch { process.stdout.write('?'); continue; }
  const a = await (await fetch(`https://normiesyachtclub.com/api/v1/yacht/${id}.json`)).json();
  let d = 0;
  for (let i = 0; i < 1600; i++) if (c.art.bits[i] !== a.art.bits[i]) d++;
  if (d) bad.push({ id, differing: d });
  process.stdout.write(d ? 'x' : '.');
}
console.log(`\nchecked ${ids.length} hulls, ${bad.length} differ`);
console.log(bad);
