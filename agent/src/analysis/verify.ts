import type { ArticleRecord, TexteRecord } from '../store/types.js';
import { containsNormalized, normalizeForMatch } from '../utils/text.js';

/** « Art. 6 §1 », « Article 9, paragraphe 4, point c) », « art 5bis » → « 6 », « 9 », « 5bis ». */
export function parseArticleNumber(reference: string): string | null {
  const match = /\bart(?:icle)?s?\.?\s*(\d+)\s*(bis|ter|quater|[a-z])?\b/i.exec(reference);
  if (!match) return null;
  const suffix = match[2] ? match[2].toLowerCase() : '';
  return `${match[1]}${suffix}`;
}

export interface ArticleCheck {
  ok: boolean;
  numeros: string[];
  manquants: string[];
}

/** Vérifie que chaque article cité existe dans la segmentation du texte. */
export function verifyArticles(references: string[], articles: ArticleRecord[]): ArticleCheck {
  const known = new Set(articles.map((a) => a.numero.toLowerCase()));
  const numeros: string[] = [];
  const manquants: string[] = [];
  for (const ref of references) {
    const numero = parseArticleNumber(ref);
    if (numero && known.has(numero.toLowerCase())) {
      if (!numeros.includes(numero)) numeros.push(numero);
    } else {
      manquants.push(ref);
    }
  }
  return { ok: manquants.length === 0 && numeros.length > 0, numeros, manquants };
}

export interface VerbatimCheck {
  ok: boolean;
  /** Vrai si l'extrait est retrouvé dans l'un des articles cités (sinon dans le reste du texte). */
  dans_articles_cites: boolean;
}

/** Test de sous-chaîne normalisée : d'abord dans les articles cités, puis dans tout le texte. */
export function verifyVerbatim(
  extrait: string,
  articles: ArticleRecord[],
  numerosCites: string[],
): VerbatimCheck {
  if (normalizeForMatch(extrait).length === 0) return { ok: false, dans_articles_cites: false };
  const cited = articles.filter((a) =>
    numerosCites.some((n) => n.toLowerCase() === a.numero.toLowerCase()),
  );
  if (cited.some((a) => containsNormalized(a.contenu, extrait)))
    return { ok: true, dans_articles_cites: true };
  if (articles.some((a) => containsNormalized(a.contenu, extrait)))
    return { ok: true, dans_articles_cites: false };
  return { ok: false, dans_articles_cites: false };
}

/** URL de l'article (URL officielle + ancre) quand la source fournit une ancre. */
export function articleUrl(
  texte: Pick<TexteRecord, 'url_officielle' | 'articles'>,
  numero: string,
): string | null {
  const article = texte.articles.find((a) => a.numero.toLowerCase() === numero.toLowerCase());
  if (!article) return null;
  if (article.url) return article.url;
  if (!article.ancre) return texte.url_officielle;
  return `${texte.url_officielle}${article.ancre}`;
}

/** Normalise une référence d'article pour les clés d'identifiants (« Art. 6 §1 » → « art 6 1 »). */
export function normalizeArticleRef(reference: string): string {
  return normalizeForMatch(reference.replace(/§/g, ' '));
}
