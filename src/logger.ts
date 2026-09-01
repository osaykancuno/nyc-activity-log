import { config } from './config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const min = LEVELS[(config.logLevel as Level)] ?? LEVELS.info;

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const emit = (level: Level, tag: string, msg: unknown, extra?: unknown) => {
  if (LEVELS[level] < min) return;
  const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${tag}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  extra === undefined ? stream(line) : stream(line, extra);
};

export const log = (tag: string) => ({
  debug: (m: unknown, e?: unknown) => emit('debug', tag, m, e),
  info: (m: unknown, e?: unknown) => emit('info', tag, m, e),
  warn: (m: unknown, e?: unknown) => emit('warn', tag, m, e),
  error: (m: unknown, e?: unknown) => emit('error', tag, m, e),
});
