import { looksLikeEurlex } from '../ingest/html-text.js';
import { normalizeDocument } from '../ingest/normalize.js';
import { sha256 } from '../utils/hash.js';
import { matchesAnyKeyword } from '../utils/text.js';
import type { Logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { HttpError, type HttpClient } from './http.js';
import { itemsSince, parseFeed } from './rss.js';
import type {
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

/** URL officielle de la version HTML française d'un acte par identifiant CELEX (SPEC.md, section 9). */
export const EURLEX_HTML_URL =
  'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri={reference}';

export interface EurlexOptions {
  urlHtml?: string;
  /** Flux RSS/Atom officiels (déclarés dans config/sources.yaml après vérification). */
  feeds?: string[];
  references: { reference: string; titre?: string; suivi: boolean }[];
  /** URL alternatives (Cellar de l'Office des publications), essayées après l'URL EUR-Lex. */
  urlsAlternatives?: string[];
  motsCles?: string[];
  log?: Logger;
}

export function normalizeCelex(reference: string): string {
  const trimmed = reference.trim();
  return /^CELEX:/i.test(trimmed) ? `CELEX:${trimmed.slice(6)}` : `CELEX:${trimmed}`;
}

/** Identifiant CELEX contenu dans un lien ou un guid de flux (uri=CELEX:… ou …/celex/…). */
export function celexFromLink(link: string): string | null {
  const match =
    /CELEX(?::|%3A)([0-9][0-9A-Z()]+)/i.exec(link) ?? /\/celex\/([0-9][0-9A-Z()]+)/i.exec(link);
  return match ? `CELEX:${match[1]!.toUpperCase()}` : null;
}

/**
 * Connecteur EUR-Lex : récupération par CELEX (HTML officiel), veille par flux RSS, repli vers
 * les URL alternatives du Cellar. EUR-Lex répond un 202 vide aux clients automatisés qu'il refuse :
 * l'erreur est explicite et invite à utiliser le connecteur fichier local.
 */
export class EurlexConnector implements SourceConnector {
  readonly id = 'eurlex' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly options: EurlexOptions,
  ) {}

  htmlUrl(reference: string): string {
    return (this.options.urlHtml ?? EURLEX_HTML_URL).replace(
      '{reference}',
      encodeURIComponent(normalizeCelex(reference)).replace('%3A', ':'),
    );
  }

  async listRecent(since?: string): Promise<ReferenceRecente[]> {
    const refs: ReferenceRecente[] = this.options.references
      .filter((r) => r.suivi)
      .map((r) => ({
        reference: normalizeCelex(r.reference),
        titre: r.titre ?? null,
        url_officielle: this.htmlUrl(r.reference),
        date: null,
      }));
    for (const feedUrl of this.options.feeds ?? []) {
      try {
        const response = await this.http.get(feedUrl, {
          accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5',
        });
        for (const item of itemsSince(parseFeed(response.text()).items, since)) {
          const celex = celexFromLink(item.lien) ?? celexFromLink(item.guid ?? '');
          if (!celex || refs.some((r) => r.reference === celex)) continue;
          if (!matchesAnyKeyword(`${item.titre} ${item.description ?? ''}`, this.options.motsCles))
            continue;
          refs.push({
            reference: celex,
            titre: item.titre || null,
            url_officielle: this.htmlUrl(celex),
            date: item.date,
          });
        }
      } catch (error) {
        this.options.log?.warn(
          { feed: feedUrl, err: (error as Error).message },
          'Flux EUR-Lex illisible',
        );
      }
    }
    return refs;
  }

  async fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    const reference = normalizeCelex(request.reference);
    const urlOfficielle = request.url_officielle || this.htmlUrl(reference);
    const candidates = [
      urlOfficielle,
      ...(this.options.urlsAlternatives ?? []).map((u) => u.replace('{celex}', reference.slice(6))),
    ];
    const errors: string[] = [];
    for (const url of candidates) {
      try {
        const response = await this.http.get(url, {
          accept: 'text/html,application/xhtml+xml',
          acceptLanguage: 'fr, fra',
        });
        const html = response.text();
        if (!looksLikeEurlex(html)) {
          errors.push(
            `${url} : HTTP ${response.status} sans structure EUR-Lex (${response.body.length} octets, page de contrôle anti-bot ?)`,
          );
          continue;
        }
        return {
          source: 'eurlex',
          reference,
          url_officielle: urlOfficielle,
          format: 'html',
          contenu: response.body,
          fichier: null,
          recupere_le: new Date().toISOString(),
          titre_hint: undefined, // le titre officiel du document (p.oj-doc-ti) prime sur celui du flux
          type_hint: request.type,
        };
      } catch (error) {
        errors.push(
          error instanceof HttpError
            ? `${url} : HTTP ${error.status ?? 'réseau'}`
            : `${url} : ${(error as Error).message}`,
        );
      }
    }
    throw new AppError(
      `EUR-Lex inaccessible pour ${reference} (${errors.join(' ; ')}). Enregistrer la page HTML depuis un navigateur dans data/sources/ et utiliser le connecteur fichier local.`,
    );
  }

  async parse(raw: DocumentBrut): Promise<TexteNormalise> {
    const texte = normalizeDocument(raw);
    if (texte.articles.length === 0) {
      throw new AppError(
        `EUR-Lex ${raw.reference} : aucun article détecté (hash brut ${sha256(raw.contenu).slice(0, 12)})`,
      );
    }
    return texte;
  }
}
