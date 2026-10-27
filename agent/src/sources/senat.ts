import { parseDateFr } from '../ingest/dates.js';
import type { Logger } from '../utils/logger.js';
import type { HttpClient } from './http.js';
import { RssPageConnector } from './rss-page.js';
import type {
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

/** Export open data du Sénat (vérifié le 27/10/2026) : CSV ISO-8859-1, séparateur « ; », mis à jour chaque nuit. */
export const SENAT_DOSSIERS_CSV = 'https://data.senat.fr/data/dosleg/dossiers-legislatifs.csv';

export interface DossierSenat {
  titre: string;
  type: string;
  date_initiale: string | null;
  url: string;
  etat: string;
  numero_loi: string | null;
  themes: string[];
}

/** Parse un CSV « ; » avec guillemets doubles (RFC 4180 simplifié). */
export function parseCsv(text: string, separator = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Dates du CSV : AAAA-MM-JJ, JJ/MM/AAAA ou « 23 octobre 2026 ». */
export function parseSenatDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return parseDateFr(v);
}

/** Lignes du CSV → dossiers (en-tête : Titre;Type de dossier;Date initiale;URL du dossier;État du dossier;…;Numéro de la loi;Thèmes). */
export function parseDossiersSenat(csv: string): DossierSenat[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.findIndex((h) => h.startsWith(name));
  const iTitre = col('titre');
  const iType = col('type');
  const iDate = col('date initiale');
  const iUrl = col('url');
  const iEtat = col('état') >= 0 ? col('état') : col('etat');
  const iLoi = col('numéro de la loi') >= 0 ? col('numéro de la loi') : col('numero de la loi');
  const iThemes = col('thèmes') >= 0 ? col('thèmes') : col('themes');
  return rows.slice(1).flatMap((r) => {
    const url = (r[iUrl] ?? '').trim();
    if (!url) return [];
    return [
      {
        titre: (r[iTitre] ?? '').trim(),
        type: (r[iType] ?? '').trim(),
        date_initiale: parseSenatDate(r[iDate] ?? ''),
        url,
        etat: (r[iEtat] ?? '').trim(),
        numero_loi: (r[iLoi] ?? '').trim() || null,
        themes: (r[iThemes] ?? '')
          .split(/[|,;]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      },
    ];
  });
}

export interface SenatOptions {
  csv?: string;
  feeds?: string[];
  motsCles?: string[];
  log?: Logger;
}

/**
 * Connecteur Sénat : dossiers législatifs de l'open data (CSV quotidien) filtrés par date et mots-clés,
 * complétés par les flux RSS officiels (textes déposés, thèmes) ; pages HTML du dossier récupérées
 * et segmentées par le connecteur générique.
 */
export class SenatConnector implements SourceConnector {
  readonly id = 'senat' as const;
  private readonly pages: RssPageConnector;

  constructor(
    private readonly http: HttpClient,
    private readonly options: SenatOptions,
  ) {
    this.pages = new RssPageConnector(http, {
      id: 'senat',
      feeds: options.feeds ?? [],
      typeParDefaut: 'Projet de loi',
      motsCles: options.motsCles,
      log: options.log,
    });
  }

  async listDossiers(since?: string): Promise<DossierSenat[]> {
    if (!this.options.csv) return [];
    const response = await this.http.get(this.options.csv, {
      accept: 'text/csv, text/plain;q=0.9, */*;q=0.5',
    });
    const text = new TextDecoder('iso-8859-1').decode(response.body);
    const dossiers = parseDossiersSenat(text);
    const limit = since ? since.slice(0, 10) : null;
    const motsCles = (this.options.motsCles ?? []).map((k) => k.toLowerCase());
    return dossiers.filter((d) => {
      if (limit && d.date_initiale && d.date_initiale < limit) return false;
      if (motsCles.length === 0) return true;
      const haystack = `${d.titre} ${d.themes.join(' ')}`.toLowerCase();
      return motsCles.some((k) => haystack.includes(k));
    });
  }

  async listRecent(since?: string): Promise<ReferenceRecente[]> {
    const refs: ReferenceRecente[] = [];
    try {
      for (const d of await this.listDossiers(since)) {
        refs.push({
          reference: d.url,
          titre: d.titre || null,
          url_officielle: d.url,
          date: d.date_initiale,
          type: /proposition/i.test(d.type) ? 'Proposition de loi' : 'Projet de loi',
        });
      }
    } catch (error) {
      this.options.log?.warn({ err: (error as Error).message }, 'Open data Sénat illisible');
    }
    for (const ref of await this.pages.listRecent(since)) {
      if (!refs.some((r) => r.reference === ref.reference)) refs.push(ref);
    }
    return refs;
  }

  fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    return this.pages.fetchDocument(request);
  }

  parse(raw: DocumentBrut): Promise<TexteNormalise> {
    return this.pages.parse(raw);
  }
}
