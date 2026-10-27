import { htmlToText } from '../ingest/html-text.js';
import type { TypeTexte } from '../schemas/common.js';
import { sha256 } from '../utils/hash.js';
import { collapseWhitespace } from '../utils/text.js';
import type { HttpClient } from './http.js';
import { PISTE_URLS, type PisteAuth, type PisteEnv } from './piste.js';
import type {
  ArticleNormalise,
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

/** Sous-ensemble de ConsultTextResponse (swagger lf-engine-app v2.4.2). */
export interface LegifranceArticle {
  id: string;
  cid?: string;
  num?: string | null;
  content?: string | null;
  etat?: string;
  intOrdre?: number;
}

export interface LegifranceSection {
  id: string;
  title?: string;
  etat?: string;
  articles?: LegifranceArticle[];
  sections?: LegifranceSection[];
}

export interface LegifranceTexte {
  id: string;
  cid?: string;
  title?: string;
  nature?: string;
  etat?: string;
  dateTexte?: string | number | null;
  dateParution?: string | number | null;
  dateDebutVersion?: string | number | null;
  nor?: string | null;
  eli?: string | null;
  articles?: LegifranceArticle[];
  sections?: LegifranceSection[];
}

export interface LegifranceSearchHit {
  titles?: {
    id?: string;
    cid?: string;
    title?: string;
    legalStatus?: string;
    startDate?: string | number;
  }[];
  nature?: string;
  datePublication?: string | number;
  dateSignature?: string | number;
  nor?: string;
  num?: string;
}

export interface LegifranceSearchResponse {
  totalResultNumber?: number;
  results?: LegifranceSearchHit[];
}

export function legifranceUrl(textId: string): string {
  return `https://www.legifrance.gouv.fr/loda/id/${textId}`;
}

export function legifranceArticleUrl(articleId: string): string {
  return `https://www.legifrance.gouv.fr/loda/article_lc/${articleId}`;
}

/** Date Légifrance (ISO ou epoch ms) → AAAA-MM-JJ, ou null. */
export function toIsoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function natureToType(nature: string | undefined): TypeTexte {
  switch ((nature ?? '').toUpperCase()) {
    case 'LOI':
    case 'LOI_ORGANIQUE':
    case 'LOI_CONSTIT':
      return 'Loi';
    case 'ORDONNANCE':
      return 'Ordonnance';
    case 'DECRET':
    case 'DECRET_LOI':
      return 'Décret';
    case 'ARRETE':
      return 'Arrêté';
    case 'DECISION':
      return 'Décision';
    default:
      return 'Référentiel';
  }
}

/** Aplatit sections et articles (ordre du document) en articles normalisés, articles abrogés exclus. */
export function flattenLegifrance(texte: LegifranceTexte): ArticleNormalise[] {
  const out: ArticleNormalise[] = [];
  const pushArticle = (article: LegifranceArticle, sectionTitle: string | null): void => {
    if (article.etat && /ABROGE/i.test(article.etat)) return;
    const numero = (article.num ?? '').trim() || article.id;
    out.push({
      numero,
      titre: sectionTitle,
      contenu: collapseWhitespace(htmlToText(article.content ?? '')),
      ancre: null,
      url: legifranceArticleUrl(article.id),
      type: 'article',
      position: out.length,
    });
  };
  const walk = (sections: LegifranceSection[] | undefined, parentTitle: string | null): void => {
    for (const section of sections ?? []) {
      const title = collapseWhitespace(section.title ?? '') || parentTitle;
      for (const article of [...(section.articles ?? [])].sort(
        (a, b) => (a.intOrdre ?? 0) - (b.intOrdre ?? 0),
      )) {
        pushArticle(article, title);
      }
      walk(section.sections, title);
    }
  };
  for (const article of [...(texte.articles ?? [])].sort(
    (a, b) => (a.intOrdre ?? 0) - (b.intOrdre ?? 0),
  ))
    pushArticle(article, null);
  walk(texte.sections, null);
  return out;
}

export interface LegifranceOptions {
  env: PisteEnv;
  references: { reference: string; titre?: string; suivi: boolean }[];
  motsCles?: string[];
}

/** Connecteur Légifrance via PISTE : texte consolidé par LEGITEXT, article par LEGIARTI, recherche LODA. */
export class LegifranceConnector implements SourceConnector {
  readonly id = 'legifrance' as const;
  private readonly base: string;

  constructor(
    private readonly auth: PisteAuth,
    private readonly http: HttpClient,
    private readonly options: LegifranceOptions,
  ) {
    this.base = PISTE_URLS[options.env].legifrance;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers = { ...(await this.auth.authHeaders()), accept: 'application/json' };
    const response = await this.http.postJson(`${this.base}${path}`, body, { headers });
    return response.json<T>();
  }

  /** Références suivies dans la configuration, complétées par une recherche plein texte sur les mots-clés depuis `since`. */
  async listRecent(since?: string): Promise<ReferenceRecente[]> {
    const refs: ReferenceRecente[] = this.options.references
      .filter((r) => r.suivi)
      .map((r) => ({
        reference: r.reference,
        titre: r.titre ?? null,
        url_officielle: legifranceUrl(r.reference),
        date: null,
      }));
    for (const motCle of this.options.motsCles ?? []) {
      const hits = await this.search(motCle, since);
      for (const hit of hits) if (!refs.some((r) => r.reference === hit.reference)) refs.push(hit);
    }
    return refs;
  }

  /** POST /search sur le fonds LODA_DATE, tri par date de publication décroissante. */
  async search(query: string, since?: string, pageSize = 20): Promise<ReferenceRecente[]> {
    const filtres: unknown[] = [];
    if (since)
      filtres.push({
        facette: 'DATE_PUBLICATION',
        dates: { start: since.slice(0, 10), end: new Date().toISOString().slice(0, 10) },
      });
    const body = {
      fond: 'LODA_DATE',
      recherche: {
        champs: [
          {
            typeChamp: 'ALL',
            criteres: [
              { typeRecherche: 'TOUS_LES_MOTS_DANS_UN_CHAMP', valeur: query, operateur: 'ET' },
            ],
            operateur: 'ET',
          },
        ],
        filtres,
        pageNumber: 1,
        pageSize,
        operateur: 'ET',
        sort: 'PUBLICATION_DATE_DESC',
        typePagination: 'DEFAUT',
      },
    };
    const data = await this.post<LegifranceSearchResponse>('/search', body);
    return (data.results ?? []).flatMap((hit) => {
      const title = hit.titles?.[0];
      if (!title?.id) return [];
      return [
        {
          reference: title.id,
          titre: title.title ?? null,
          url_officielle: legifranceUrl(title.id),
          date: toIsoDate(hit.datePublication ?? hit.dateSignature),
          type: natureToType(hit.nature),
        },
      ];
    });
  }

  /** POST /consult/legiPart : version consolidée du texte à la date du jour. */
  async fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    const data = await this.post<LegifranceTexte>('/consult/legiPart', {
      textId: request.reference,
      date: Date.now(),
    });
    return {
      source: 'legifrance',
      reference: request.reference,
      url_officielle: request.url_officielle || legifranceUrl(request.reference),
      format: 'json',
      contenu: Buffer.from(JSON.stringify(data), 'utf8'),
      fichier: null,
      recupere_le: new Date().toISOString(),
      titre_hint: request.titre,
      type_hint: request.type,
    };
  }

  /** POST /consult/getArticle : un article par identifiant LEGIARTI. */
  async getArticle(
    articleId: string,
  ): Promise<{ id: string; num?: string; texte?: string; texteHtml?: string } | null> {
    const data = await this.post<{
      article?: { id: string; num?: string; texte?: string; texteHtml?: string };
    }>('/consult/getArticle', { id: articleId });
    return data.article ?? null;
  }

  async parse(raw: DocumentBrut): Promise<TexteNormalise> {
    const texte = JSON.parse(raw.contenu.toString('utf8')) as LegifranceTexte;
    const articles = flattenLegifrance(texte);
    const contenuTexte = articles
      .map((a) => `Article ${a.numero}${a.titre ? ` – ${a.titre}` : ''}\n${a.contenu}`)
      .join('\n\n');
    const titre = raw.titre_hint ?? collapseWhitespace(texte.title ?? '') ?? raw.reference;
    return {
      source: 'legifrance',
      reference: raw.reference,
      titre: titre || raw.reference,
      type: raw.type_hint ?? natureToType(texte.nature),
      url_officielle: raw.url_officielle,
      dates: {
        publication: toIsoDate(texte.dateParution),
        entree_en_vigueur: toIsoDate(texte.dateDebutVersion),
        entree_en_application: null,
      },
      contenu_texte: contenuTexte,
      articles,
      hash_sha256: sha256(contenuTexte),
      collecte_le: raw.recupere_le,
      metadonnees: {
        format: 'json',
        parser: 'legifrance-legiPart',
        hash_brut_sha256: sha256(raw.contenu),
        nature: texte.nature ?? null,
        etat: texte.etat ?? null,
        nor: texte.nor ?? null,
        eli: texte.eli ?? null,
        cid: texte.cid ?? null,
      },
    };
  }
}
