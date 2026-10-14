/**
 * Minimal logger wrapper (spec §9: no stray `console.log`).
 * Every module logs through this so output stays consistent and can be
 * redirected/replaced later without touching call sites.
 */
type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, message: string, meta?: unknown): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) {
    sink(line);
  } else {
    sink(line, meta);
  }
}

export const logger = {
  info(message: string, meta?: unknown): void {
    emit('info', message, meta);
  },
  warn(message: string, meta?: unknown): void {
    emit('warn', message, meta);
  },
  error(message: string, meta?: unknown): void {
    emit('error', message, meta);
  },
};

export type Logger = typeof logger;
