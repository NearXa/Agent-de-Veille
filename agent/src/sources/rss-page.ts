import { normalizeDocument } from '../ingest/normalize.js';
import type { SourceId, TypeTexte } from '../schemas/common.js';
import { sha256 } from '../utils/hash.js';
import type { Logger } from '../utils/logger.js';
import { collapseWhitespace, matchesAnyKeyword, slugify } from '../utils/text.js';
import type { HttpClient } from './http.js';
import { extractPdfText } from './local-file.js';
import { itemsSince, parseFeed, type FeedItem } from './rss.js';
import type {
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

export interface RssPageOptions {
  id: SourceId;
  /** Flux RSS ou Atom officiels (URL vérifiées, déclarées dans config/sources.yaml). */
  feeds: string[];
  typeParDefaut?: TypeTexte;
  /** Mots-clés : si fournis, seules les entrées dont le titre ou la description en contient un sont retenues. */
  motsCles?: string[];
  log?: Logger;
}

function matchesKeywords(item: FeedItem, motsCles: string[] | undefined): boolean {
  return matchesAnyKeyword(`${item.titre} ${item.description ?? ''}`, motsCles);
}

/** Référence stable d'une entrée de flux : guid si c'est une URL ou un identifiant, sinon le lien. */
export function feedReference(item: FeedItem): string {
  const candidate = item.guid && item.guid.length <= 200 ? item.guid : item.lien;
  return candidate || slugify(item.titre);
}

/**
 * Connecteur générique « flux + page » : veille par flux RSS/Atom officiels, récupération de la
 * page HTML (ou du PDF) de chaque entrée, segmentation de repli par regex. Utilisé pour
 * l'Assemblée nationale, le Sénat, la CNIL et l'ANSSI.
 */
export class RssPageConnector implements SourceConnector {
  readonly id: SourceId;

  constructor(
    private readonly http: HttpClient,
    private readonly options: RssPageOptions,
  ) {
    this.id = options.id;
  }

  async listRecent(since?: string): Promise<ReferenceRecente[]> {
    const refs: ReferenceRecente[] = [];
    for (const feedUrl of this.options.feeds) {
      try {
        const response = await this.http.get(feedUrl, {
          accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        });
        const feed = parseFeed(response.text());
        for (const item of itemsSince(feed.items, since)) {
          if (!item.lien || !matchesKeywords(item, this.options.motsCles)) continue;
          const reference = feedReference(item);
          if (refs.some((r) => r.reference === reference)) continue;
          refs.push({
            reference,
            titre: item.titre || null,
            url_officielle: item.lien,
            date: item.date,
            type: this.options.typeParDefaut,
          });
        }
      } catch (error) {
        this.options.log?.warn({ feed: feedUrl, err: (error as Error).message }, 'Flux illisible');
      }
    }
    return refs;
  }

  async fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    const response = await this.http.get(request.url_officielle, { acceptLanguage: 'fr' });
    const contentType = (response.contentType ?? '').toLowerCase();
    const isPdf =
      contentType.includes('application/pdf') ||
      response.body.subarray(0, 4).toString('latin1') === '%PDF';
    return {
      source: this.id,
      reference: request.reference,
      url_officielle: request.url_officielle,
      format: isPdf ? 'pdf' : 'html',
      contenu: response.body,
      fichier: null,
      recupere_le: new Date().toISOString(),
      titre_hint: request.titre,
      type_hint: request.type ?? this.options.typeParDefaut,
    };
  }

  async parse(raw: DocumentBrut): Promise<TexteNormalise> {
    if (raw.format === 'pdf') {
      const text = await extractPdfText(raw.contenu);
      const texte = normalizeDocument({
        ...raw,
        format: 'txt',
        contenu: Buffer.from(text, 'utf8'),
      });
      texte.metadonnees.format = 'pdf';
      texte.metadonnees.parser = 'unpdf+regex';
      return texte;
    }
    const texte = normalizeDocument(raw);
    if (texte.articles.length === 0) {
      // Page sans articles (actualité, délibération, avis) : le document entier devient une section unique.
      const contenu = collapseWhitespace(
        Buffer.from(raw.contenu).toString('utf8').length > 0 ? texte.contenu_texte || '' : '',
      );
      const body =
        contenu ||
        collapseWhitespace(
          (await import('../ingest/html-text.js')).htmlToText(raw.contenu.toString('utf8')),
        );
      texte.articles = [
        {
          numero: 'document',
          titre: texte.titre,
          contenu: body,
          ancre: null,
          url: raw.url_officielle,
          type: 'section',
          position: 0,
        },
      ];
      texte.contenu_texte = body;
      texte.hash_sha256 = sha256(body);
    }
    return texte;
  }
}
