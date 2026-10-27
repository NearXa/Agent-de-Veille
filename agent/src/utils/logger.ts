import pino, { type Logger } from 'pino';
import pretty from 'pino-pretty';

const level = process.env.LOG_LEVEL ?? 'info';
const usePretty = (process.env.LOG_FORMAT ?? 'pretty') !== 'json';

/** Logger structuré (pino). Format lisible par défaut, JSON avec LOG_FORMAT=json. */
export const logger: Logger = usePretty
  ? pino(
      { level, base: undefined },
      pretty({ colorize: process.stdout.isTTY, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }),
    )
  : pino({ level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });

export type { Logger };

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
