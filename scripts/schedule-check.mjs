/** What the bot will actually do, and when, in both clocks. */
import { config } from '../src/config.ts';

const now = new Date();
const offset = (tz) => {
  const l = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const u = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((l - u) / 3600000);
};
const off = offset(config.cronTz);
const winter = (() => {
  const d = new Date('2026-12-01T12:00:00Z');
  const l = new Date(d.toLocaleString('en-US', { timeZone: config.cronTz }));
  const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((l - u) / 3600000);
})();

console.log(`\n  scheduling zone: ${config.cronTz}  (UTC+${off} today, UTC+${winter} after the October change)\n`);
const pad = (h) => String(((h % 24) + 24) % 24).padStart(2, '0');
for (const [name, expr] of [
  ["morning watch", config.watchCronMorning],
  ["evening watch", config.watchCronEvening],
  ["Yoko's entry", config.journalCron],
]) {
  const [, h] = expr.split(' ');
  console.log(`  ${name.padEnd(15)} "${expr}"   ${pad(+h)}:00 local  =  ${pad(+h - off)}:00 UTC now, ${pad(+h - winter)}:00 UTC in winter`);
}
console.log(`\n  SWEEP_MIN               ${config.sweepMin}   (below this, one post per hull)`);
console.log(`  journal module          ${config.modules.journal}`);
console.log(`  entry on quiet days     ${config.journalOnQuietDays}`);
console.log(`  watch module            ${config.modules.watch}   (now posts even when nothing moved)`);
console.log(`  art source              ${config.artSource}`);
console.log(`  dry run                 ${config.dryRun}\n`);
