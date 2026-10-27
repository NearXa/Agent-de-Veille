import { sha256 } from '../utils/hash.js';
import { collapseWhitespace } from '../utils/text.js';
import type { HttpClient } from './http.js';
import { PISTE_URLS, type PisteEnv } from './piste.js';
import type {
  ArticleNormalise,
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

/** Résultat de GET /search (swagger public Judilibre v1.2.5). */
export interface JudilibreHit {
  id: string;
  score?: number;
  jurisdiction?: string;
  chamber?: string;
  number?: string;
  numbers?: string[];
  ecli?: string;
  formation?: string;
  publication?: string[];
  decision_date?: string;
  type?: string;
  solution?: string;
  summary?: string;
  themes?: string[];
  highlights?: Record<string, string[]>;
}

export interface JudilibreSearchResponse {
  page?: number;
  page_size?: number;
  total?: number;
  next_page?: string | null;
  results?: JudilibreHit[];
}

/** Résultat de GET /decision. */
export interface JudilibreDecision extends JudilibreHit {
  text?: string;
  zones?: Record<string, { start: number; end: number }[]>;
  visa?: { id?: string; url?: string; title?: string }[];
  update_date?: string;
}

export interface JudilibreSearchParams {
  query: string;
  dateStart?: string;
  dateEnd?: string;
  jurisdictions?: string[];
  pageSize?: number;
  page?: number;
  sort?: 'score' | 'scorepub' | 'date';
  order?: 'asc' | 'desc';
  operator?: 'or' | 'and' | 'exact';
}

export const JURIDICTION_LABELS: Record<string, string> = {
  cc: 'Cour de cassation',
  ca: "Cour d'appel",
  tj: 'Tribunal judiciaire',
  tcom: 'Tribunal de commerce',
  cph: "Conseil de prud'hommes",
};

export function judilibreDecisionUrl(id: string): string {
  return `https://www.courdecassation.fr/decision/${id}`;
}

/** Client Judilibre (Cour de cassation) via PISTE : en-tête KeyId (clé API), endpoints GET. */
export class JudilibreClient {
  readonly base: string;

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpClient,
    env: PisteEnv,
  ) {
    this.base = PISTE_URLS[env].judilibre;
  }

  private async get<T>(path: string, params: URLSearchParams): Promise<T> {
    const response = await this.http.get(`${this.base}${path}?${params.toString()}`, {
      headers: { KeyId: this.apiKey },
      accept: 'application/json',
    });
    return response.json<T>();
  }

  async search(params: JudilibreSearchParams): Promise<JudilibreSearchResponse> {
    const query = new URLSearchParams();
    query.set('query', params.query);
    if (params.operator) query.set('operator', params.operator);
    if (params.dateStart) query.set('date_start', params.dateStart);
    if (params.dateEnd) query.set('date_end', params.dateEnd);
    for (const j of params.jurisdictions ?? []) query.append('jurisdiction[]', j);
    query.set('page_size', String(Math.min(50, params.pageSize ?? 10)));
    query.set('page', String(params.page ?? 0));
    query.set('sort', params.sort ?? 'scorepub');
    query.set('order', params.order ?? 'desc');
    query.set('resolve_references', 'false');
    return this.get<JudilibreSearchResponse>('/search', query);
  }

  async decision(id: string): Promise<JudilibreDecision> {
    const query = new URLSearchParams({ id, resolve_references: 'true' });
    return this.get<JudilibreDecision>('/decision', query);
  }

  async healthcheck(): Promise<boolean> {
    try {
      const data = await this.get<{ status?: string }>('/healthcheck', new URLSearchParams());
      return data.status === 'disponible';
    } catch {
      return false;
    }
  }
}

/** Zones de la décision (exposé, moyens, motivations, dispositif) en sections normalisées. */
export function decisionToArticles(decision: JudilibreDecision): ArticleNormalise[] {
  const text = decision.text ?? '';
  const zones = decision.zones ?? {};
  const names = ['introduction', 'expose', 'moyens', 'motivations', 'dispositif', 'annexes'];
  const out: ArticleNormalise[] = [];
  for (const name of names) {
    const spans = zones[name];
    if (!spans || spans.length === 0) continue;
    const contenu = collapseWhitespace(spans.map((s) => text.slice(s.start, s.end)).join('\n'));
    if (!contenu) continue;
    out.push({
      numero: name,
      titre: null,
      contenu,
      ancre: null,
      url: null,
      type: 'section',
      position: out.length,
    });
  }
  if (out.length === 0 && text)
    out.push({
      numero: 'texte',
      titre: null,
      contenu: collapseWhitespace(text),
      ancre: null,
      url: null,
      type: 'section',
      position: 0,
    });
  return out;
}

export interface JudilibreConnectorOptions {
  env: PisteEnv;
  requete?: string;
  juridictions?: string[];
}

/** Connecteur Judilibre : décisions récentes pour une requête configurée, décision par identifiant. */
export class JudilibreConnector implements SourceConnector {
  readonly id = 'judilibre' as const;
  readonly client: JudilibreClient;

  constructor(
    apiKey: string,
    http: HttpClient,
    private readonly options: JudilibreConnectorOptions,
  ) {
    this.client = new JudilibreClient(apiKey, http, options.env);
  }

  async listRecent(since?: string): Promise<ReferenceRecente[]> {
    if (!this.options.requete) return [];
    const data = await this.client.search({
      query: this.options.requete,
      dateStart: since?.slice(0, 10),
      jurisdictions: this.options.juridictions,
      sort: 'date',
      pageSize: 20,
    });
    return (data.results ?? []).map((hit) => ({
      reference: hit.id,
      titre:
        `${JURIDICTION_LABELS[hit.jurisdiction ?? ''] ?? hit.jurisdiction ?? 'Décision'} ${hit.number ?? ''} du ${hit.decision_date ?? '?'}`.trim(),
      url_officielle: judilibreDecisionUrl(hit.id),
      date: hit.decision_date ?? null,
      type: 'Décision',
    }));
  }

  async fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    const decision = await this.client.decision(request.reference);
    return {
      source: 'judilibre',
      reference: request.reference,
      url_officielle: request.url_officielle || judilibreDecisionUrl(request.reference),
      format: 'json',
      contenu: Buffer.from(JSON.stringify(decision), 'utf8'),
      fichier: null,
      recupere_le: new Date().toISOString(),
      titre_hint: request.titre,
      type_hint: 'Décision',
    };
  }

  async parse(raw: DocumentBrut): Promise<TexteNormalise> {
    const decision = JSON.parse(raw.contenu.toString('utf8')) as JudilibreDecision;
    const articles = decisionToArticles(decision);
    const contenuTexte = articles.map((a) => `${a.numero}\n${a.contenu}`).join('\n\n');
    const juridiction =
      JURIDICTION_LABELS[decision.jurisdiction ?? ''] ?? decision.jurisdiction ?? 'Juridiction';
    return {
      source: 'judilibre',
      reference: raw.reference,
      titre:
        raw.titre_hint ??
        `${juridiction}, ${decision.chamber ?? ''} ${decision.number ?? ''} du ${decision.decision_date ?? '?'}`
          .replace(/\s+/g, ' ')
          .trim(),
      type: 'Décision',
      url_officielle: raw.url_officielle,
      dates: {
        publication: decision.decision_date ?? null,
        entree_en_vigueur: null,
        entree_en_application: null,
      },
      contenu_texte: contenuTexte,
      articles,
      hash_sha256: sha256(contenuTexte),
      collecte_le: raw.recupere_le,
      metadonnees: {
        format: 'json',
        parser: 'judilibre-decision',
        hash_brut_sha256: sha256(raw.contenu),
        ecli: decision.ecli ?? null,
        numero: decision.number ?? null,
        solution: decision.solution ?? null,
        themes: decision.themes ?? [],
        summary: decision.summary ?? null,
      },
    };
  }
}
