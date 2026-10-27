import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import type { HttpClient } from './http.js';

/** URLs vérifiées le 27/10/2026 (guide PISTE §12.2, documentation DILA V3 du 17/09/2025). */
export const PISTE_URLS = {
  sandbox: {
    oauth: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
    legifrance: 'https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app',
    judilibre: 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0',
  },
  production: {
    oauth: 'https://oauth.piste.gouv.fr/api/oauth/token',
    legifrance: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app',
    judilibre: 'https://api.piste.gouv.fr/cassation/judilibre/v1.0',
  },
} as const;

export type PisteEnv = keyof typeof PISTE_URLS;

export interface PisteCredentials {
  clientId: string;
  clientSecret: string;
  env: PisteEnv;
}

export function pisteCredentials(env: Env): PisteCredentials | null {
  if (!env.PISTE_CLIENT_ID || !env.PISTE_CLIENT_SECRET) return null;
  return {
    clientId: env.PISTE_CLIENT_ID,
    clientSecret: env.PISTE_CLIENT_SECRET,
    env: env.PISTE_ENV,
  };
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Jeton OAuth2 PISTE (client credentials, scope openid) mis en cache jusqu'à expiration,
 * renouvelé une minute avant. Body : grant_type, client_id, client_secret, scope.
 */
export class PisteAuth {
  private token: { value: string; expiresAt: number } | null = null;
  requests = 0;

  constructor(
    private readonly credentials: PisteCredentials,
    private readonly http: HttpClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    this.requests += 1;
    const response = await this.http.postForm(PISTE_URLS[this.credentials.env].oauth, {
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: 'openid',
    });
    const data = response.json<TokenResponse>();
    if (!data.access_token) throw new AppError('PISTE : réponse OAuth2 sans access_token');
    const ttl = Math.max(60, (data.expires_in ?? 3600) - 60) * 1000;
    this.token = { value: data.access_token, expiresAt: this.now() + ttl };
    return data.access_token;
  }

  async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }
}
