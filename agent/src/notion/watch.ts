import { logger, type Logger } from '../utils/logger.js';
import { pullFromNotion } from './pull.js';
import { pushToNotion } from './push.js';

export interface NotionWatchOptions {
  intervalMinutes: number;
  once?: boolean;
  log?: Logger;
}

/** Worker push / pull périodique (toutes les 5 minutes par défaut). */
export async function watchNotion(options: NotionWatchOptions): Promise<void> {
  const log = options.log ?? logger;
  const cycle = async (): Promise<void> => {
    const push = await pushToNotion({ log });
    const pull = await pullFromNotion({ log });
    log.info({ push: { textes: push.textes, exigences: push.exigences, relations: push.relations }, pull }, 'Cycle push / pull terminé');
  };
  await cycle();
  if (options.once) return;
  const interval = Math.max(1, options.intervalMinutes) * 60_000;
  log.info({ interval_minutes: options.intervalMinutes }, 'Worker Notion démarré (Ctrl+C pour arrêter)');
  await new Promise<void>(() => {
    setInterval(() => {
      cycle().catch((error: unknown) => log.error({ err: error }, 'Cycle push / pull en erreur'));
    }, interval);
  });
}
