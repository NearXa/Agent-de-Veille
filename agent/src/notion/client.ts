import { Client, isNotionClientError } from '@notionhq/client';
import pLimit from 'p-limit';
import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';

export interface NotionConfig {
  token: string;
  parentPageId: string;
  apiVersion: string;
}

export function requireNotionConfig(env: Env): NotionConfig {
  if (!env.NOTION_TOKEN || !env.NOTION_PARENT_PAGE_ID) {
    throw new AppError('Notion non configuré : renseigner NOTION_TOKEN et NOTION_PARENT_PAGE_ID dans .env.');
  }
  return { token: env.NOTION_TOKEN, parentPageId: env.NOTION_PARENT_PAGE_ID, apiVersion: env.NOTION_API_VERSION };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  if (isNotionClientError(error) && 'status' in error && typeof error.status === 'number') return error.status;
  return undefined;
}

/**
 * Passerelle vers l'API Notion : une requête à la fois, espacement minimal (≈ 3 req/s),
 * nouvelles tentatives avec backoff exponentiel sur 429, 5xx et erreurs réseau.
 */
export class NotionGateway {
  readonly client: Client;
  private readonly limit = pLimit(1);
  private lastCall = 0;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly log: Logger;
  calls = 0;

  constructor(config: NotionConfig, options: { minIntervalMs?: number; maxAttempts?: number; log?: Logger; client?: Client } = {}) {
    this.client = options.client ?? new Client({ auth: config.token, notionVersion: config.apiVersion });
    this.minIntervalMs = options.minIntervalMs ?? 350;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.log = options.log ?? logger;
  }

  async call<T>(label: string, fn: (client: Client) => Promise<T>): Promise<T> {
    return this.limit(async () => {
      for (let attempt = 1; ; attempt += 1) {
        const wait = this.lastCall + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastCall = Date.now();
        this.calls += 1;
        try {
          return await fn(this.client);
        } catch (error) {
          const status = statusOf(error);
          const retryable = status === 429 || status === 529 || (status !== undefined && status >= 500) || status === undefined;
          if (!retryable || attempt >= this.maxAttempts) throw this.describe(label, error);
          const delay = Math.min(10_000, 1000 * 2 ** (attempt - 1));
          this.log.warn({ label, attempt, status, delay_ms: delay }, 'Notion : nouvelle tentative');
          await sleep(delay);
        }
      }
    });
  }

  private describe(label: string, error: unknown): Error {
    if (isNotionClientError(error)) {
      const status = statusOf(error);
      const hint =
        status === 401
          ? ' (token invalide)'
          : status === 403
            ? " (capacités de l'intégration insuffisantes : lire, mettre à jour, insérer du contenu, insérer des commentaires)"
            : status === 404
              ? " (objet introuvable ou page non partagée avec l'intégration)"
              : '';
      return new AppError(`Notion ${label} : ${error.code} ${error.message}${hint}`, { cause: error });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
