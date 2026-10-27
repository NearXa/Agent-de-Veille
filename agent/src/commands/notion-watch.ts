import { watchNotion } from '../notion/watch.js';

export interface NotionWatchCommandOptions {
  interval?: string;
  once?: boolean;
}

export default async function notionWatchCommand(
  options: NotionWatchCommandOptions,
): Promise<void> {
  const interval = Number(options.interval ?? '5');
  await watchNotion({
    intervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : 5,
    once: options.once,
  });
}
