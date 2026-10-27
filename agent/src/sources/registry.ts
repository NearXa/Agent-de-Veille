import type { Env } from '../config/env.js';
import type { SourceConfig, Sources } from '../config/schemas.js';
import type { Logger } from '../utils/logger.js';
import { EurlexConnector } from './eurlex.js';
import { HttpClient } from './http.js';
import { JudilibreConnector } from './judilibre.js';
import { LegifranceConnector } from './legifrance.js';
import { LocalFileConnector } from './local-file.js';
import { PisteAuth, pisteCredentials } from './piste.js';
import { RssPageConnector } from './rss-page.js';
import { SenatConnector } from './senat.js';
import type { SourceId, TypeTexte } from '../schemas/common.js';
import type { SourceConnector } from './types.js';

export interface ConnectorDeps {
  env: Env;
  config: SourceConfig;
  defaults: Sources['defaults'];
  log: Logger;
  fetchImpl?: typeof fetch;
}

export type ConnectorFactory = (deps: ConnectorDeps) => SourceConnector | null;

/** Fabriques par identifiant de source ; les connecteurs réseau s'enregistrent ici. */
export const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
  'local-file': (deps) => new LocalFileConnector(deps.config.documents ?? []),
  eurlex: (deps) =>
    new EurlexConnector(httpForSource(deps), {
      urlHtml: deps.config.url_html,
      feeds: deps.config.rss,
      references: (deps.config.references ?? []).map((r) => ({
        reference: r.reference,
        titre: r.titre,
        suivi: r.suivi,
      })),
      urlsAlternatives: deps.config.urls_alternatives,
      motsCles: deps.config.mots_cles,
      log: deps.log,
    }),
  'assemblee-nationale': (deps) => rssConnector(deps, 'assemblee-nationale', 'Projet de loi'),
  senat: (deps) =>
    new SenatConnector(httpForSource(deps), {
      csv: deps.config.csv,
      feeds: deps.config.rss,
      motsCles: deps.config.mots_cles,
      log: deps.log,
    }),
  cnil: (deps) => rssConnector(deps, 'cnil', 'Délibération'),
  anssi: (deps) => rssConnector(deps, 'anssi', 'Recommandation'),
  legifrance: (deps) => {
    const credentials = pisteCredentials(deps.env);
    if (!credentials) {
      deps.log.warn(
        'Légifrance : PISTE_CLIENT_ID / PISTE_CLIENT_SECRET absents, connecteur désactivé',
      );
      return null;
    }
    const env = deps.config.env ?? credentials.env;
    const http = httpForSource(deps);
    return new LegifranceConnector(new PisteAuth({ ...credentials, env }, http), http, {
      env,
      references: (deps.config.references ?? []).map((r) => ({
        reference: r.reference,
        titre: r.titre,
        suivi: r.suivi,
      })),
      motsCles: deps.config.mots_cles,
    });
  },
  judilibre: (deps) => {
    if (!deps.env.PISTE_API_KEY) {
      deps.log.warn('Judilibre : PISTE_API_KEY absente (en-tête KeyId), connecteur désactivé');
      return null;
    }
    return new JudilibreConnector(deps.env.PISTE_API_KEY, httpForSource(deps), {
      env: deps.config.env ?? deps.env.PISTE_ENV,
      requete: deps.config.requete,
      juridictions: deps.config.juridictions,
    });
  },
};

function rssConnector(
  deps: ConnectorDeps,
  id: SourceId,
  typeParDefaut: TypeTexte,
): SourceConnector | null {
  const feeds = deps.config.rss ?? [];
  if (feeds.length === 0) {
    deps.log.warn(`${id} : aucun flux RSS déclaré dans config/sources.yaml, connecteur désactivé`);
    return null;
  }
  return new RssPageConnector(httpForSource(deps), {
    id,
    feeds,
    typeParDefaut,
    motsCles: deps.config.mots_cles,
    log: deps.log,
  });
}

export function registerConnector(id: string, factory: ConnectorFactory): void {
  CONNECTOR_FACTORIES[id] = factory;
}

export function httpForSource(deps: ConnectorDeps): HttpClient {
  const perMinute = deps.defaults.rate_limit_per_minute;
  return new HttpClient({
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.defaults.timeout_ms,
    retries: deps.defaults.retries,
    minIntervalMs: Math.ceil(60_000 / Math.max(1, perMinute)),
    log: deps.log,
  });
}

/** Connecteur d'une source configurée, ou `null` s'il n'est pas implémenté ou non configuré. */
export function createConnector(deps: ConnectorDeps): SourceConnector | null {
  const factory = CONNECTOR_FACTORIES[deps.config.id];
  return factory ? factory(deps) : null;
}
