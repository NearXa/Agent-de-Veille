import pLimit from 'p-limit';
import { AppError } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';

/** User-Agent honnête : le projet s'identifie, sans usurper un navigateur. */
export const USER_AGENT =
  'veille-grc-epita/0.1 (agent de veille reglementaire, projet etudiant EPITA)';

export interface HttpResponse {
  status: number;
  ok: boolean;
  url: string;
  contentType: string | null;
  body: Buffer;
  text: () => string;
  json: <T = unknown>() => T;
}

export class HttpError extends AppError {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpError';
  }
}

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  /** Espacement minimal entre deux requêtes (limitation de débit par source). */
  minIntervalMs?: number;
  userAgent?: string;
  log?: Logger;
  /** Un 202 sans corps est traité comme un refus (protection anti-bot EUR-Lex) et non comme un succès. */
  rejectEmpty202?: boolean;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  accept?: string;
  acceptLanguage?: string;
  method?: 'GET' | 'POST';
  body?: string | URLSearchParams;
  contentType?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client HTTP commun aux connecteurs : délai, 3 nouvelles tentatives avec backoff exponentiel
 * (erreurs réseau, 429, 5xx), limitation du débit, User-Agent explicite. `fetch` est injectable
 * pour les tests.
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private readonly log: Logger;
  private readonly rejectEmpty202: boolean;
  private readonly limit = pLimit(1);
  private lastCall = 0;
  requests = 0;

  constructor(options: HttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.minIntervalMs = options.minIntervalMs ?? 500;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.log = options.log ?? logger;
    this.rejectEmpty202 = options.rejectEmpty202 ?? true;
  }

  async get(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.request(url, { ...options, method: 'GET' });
  }

  async postJson(
    url: string,
    payload: unknown,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    return this.request(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: options.accept ?? 'application/json',
    });
  }

  async postForm(
    url: string,
    params: Record<string, string>,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    return this.request(url, {
      ...options,
      method: 'POST',
      body: new URLSearchParams(params),
      contentType: 'application/x-www-form-urlencoded',
      accept: options.accept ?? 'application/json',
    });
  }

  async request(url: string, options: RequestOptions): Promise<HttpResponse> {
    return this.limit(async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= this.retries + 1; attempt += 1) {
        const wait = this.lastCall + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastCall = Date.now();
        this.requests += 1;
        try {
          const response = await this.once(url, options);
          if (response.ok) return response;
          const retryable = response.status === 429 || response.status >= 500;
          lastError = new HttpError(`HTTP ${response.status} sur ${url}`, response.status, url);
          if (!retryable) throw lastError;
        } catch (error) {
          if (error instanceof HttpError && !(error.status === 429 || (error.status ?? 500) >= 500))
            throw error;
          lastError = error;
        }
        if (attempt <= this.retries) {
          const delay = Math.min(15_000, 1000 * 2 ** (attempt - 1));
          this.log.warn({ url, attempt, delay_ms: delay }, 'Requête HTTP : nouvelle tentative');
          await sleep(delay);
        }
      }
      if (lastError instanceof HttpError) throw lastError;
      throw new HttpError(
        `Échec réseau sur ${url} : ${(lastError as Error)?.message ?? String(lastError)}`,
        null,
        url,
        {
          cause: lastError,
        },
      );
    });
  }

  private async once(url: string, options: RequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...(options.acceptLanguage ? { 'Accept-Language': options.acceptLanguage } : {}),
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      ...(options.headers ?? {}),
    };
    const response = await this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'follow',
    });
    const body = Buffer.from(await response.arrayBuffer());
    const status = response.status;
    let ok = response.ok;
    if (this.rejectEmpty202 && status === 202 && body.length === 0) ok = false;
    const result: HttpResponse = {
      status,
      ok,
      url: response.url || url,
      contentType: response.headers.get('content-type'),
      body,
      text: () => body.toString('utf8'),
      json: <T>() => JSON.parse(body.toString('utf8')) as T,
    };
    if (!ok && status === 202) {
      throw new HttpError(
        `HTTP 202 sans contenu sur ${url} : la source refuse probablement les clients automatisés ; utiliser le connecteur fichier local`,
        202,
        url,
      );
    }
    return result;
  }
}
