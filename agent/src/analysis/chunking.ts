import type { ArticleRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { estimateTokens } from '../utils/text.js';

export interface Chunk {
  id: string;
  index: number;
  articles: ArticleRecord[];
  texte: string;
  tokens_estimes: number;
}

export interface ChunkOptions {
  texteId: string;
  /** Taille cible maximale d'un chunk en tokens estimés (spec : 8 000 à 15 000). */
  maxTokens?: number;
}

/** « 5-16 », « 5,7,9-12 » → numéros d'articles présents ; `undefined` → tous les articles. */
export function selectArticles(articles: ArticleRecord[], range?: string): ArticleRecord[] {
  if (!range || range.trim() === '' || range.trim().toLowerCase() === 'all') return articles;
  const wanted = new Set<string>();
  for (const part of range.split(',')) {
    const token = part.trim();
    if (token === '') continue;
    const span = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (span) {
      const from = Number(span[1]);
      const to = Number(span[2]);
      if (from > to) throw new AppError(`Plage d'articles invalide : ${token}`);
      for (let n = from; n <= to; n += 1) wanted.add(String(n));
    } else if (/^\d+[a-z]*$/i.test(token)) {
      wanted.add(token.toLowerCase());
    } else {
      throw new AppError(`Plage d'articles invalide : ${token} (attendu : 5-16 ou 5,7,9-12)`);
    }
  }
  const selected = articles.filter(
    (a) => a.type === 'article' && wanted.has(a.numero.toLowerCase()),
  );
  if (selected.length === 0) throw new AppError(`Aucun article ne correspond à la plage ${range}`);
  return selected;
}

export function formatArticle(article: ArticleRecord): string {
  const heading = article.type === 'annexe' ? article.numero : `Article ${article.numero}`;
  return `${heading}${article.titre ? ` – ${article.titre}` : ''}\n${article.contenu}`;
}

/**
 * Regroupe les articles en chunks équilibrés sans jamais couper un article.
 * Un article plus grand que la cible forme un chunk à lui seul.
 */
export function buildChunks(articles: ArticleRecord[], options: ChunkOptions): Chunk[] {
  if (articles.length === 0) return [];
  const maxTokens = options.maxTokens ?? 12_000;
  const sizes = articles.map((a) => estimateTokens(formatArticle(a)) + 8);
  const total = sizes.reduce((acc, n) => acc + n, 0);
  const parts = Math.max(1, Math.ceil(total / maxTokens));
  const target = Math.ceil(total / parts);

  const chunks: Chunk[] = [];
  let current: ArticleRecord[] = [];
  let currentTokens = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!.numero;
    const last = current[current.length - 1]!.numero;
    const index = chunks.length;
    const texte = current.map(formatArticle).join('\n\n');
    chunks.push({
      id: `${options.texteId}-chunk-${String(index + 1).padStart(2, '0')}-art${first}-${last}`,
      index,
      articles: current,
      texte,
      tokens_estimes: estimateTokens(texte),
    });
    current = [];
    currentTokens = 0;
  };

  articles.forEach((article, i) => {
    const size = sizes[i]!;
    if (current.length > 0 && currentTokens + size > target) flush();
    current.push(article);
    currentTokens += size;
  });
  flush();
  return chunks;
}
