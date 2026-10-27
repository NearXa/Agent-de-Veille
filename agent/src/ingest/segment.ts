import type { ArticleNormalise } from '../sources/types.js';
import { collapseWhitespace } from '../utils/text.js';

const ARTICLE_HEADING =
  /^(?:Article|Art\.)\s+(\d+[a-z]*(?:\s*(?:bis|ter|quater))?)\s*(?:[-–—:.]\s*(.*))?$/i;
const ANNEX_HEADING = /^ANNEXE\s+([IVXLC]+|\d+)?\s*(?:[-–—:.]\s*(.*))?$/i;

/**
 * Segmentation de repli sur texte brut (TXT, PDF converti, HTML inconnu) : un article commence
 * à une ligne « Article N » ; le titre est la ligne courte qui suit ; les annexes sont des sections.
 */
export function segmentPlainText(text: string): ArticleNormalise[] {
  const lines = collapseWhitespace(text).split('\n');
  const articles: ArticleNormalise[] = [];
  let current: ArticleNormalise | null = null;
  let buffer: string[] = [];
  let expectTitle = false;

  const flush = (): void => {
    if (current) {
      current.contenu = buffer.join('\n').trim();
      articles.push(current);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const article = ARTICLE_HEADING.exec(line);
    const annex = ANNEX_HEADING.exec(line);
    if (article) {
      flush();
      current = {
        numero: article[1]!.replace(/\s+/g, ''),
        titre: article[2]?.trim() || null,
        contenu: '',
        ancre: null,
        type: 'article',
        position: articles.length,
      };
      expectTitle = current.titre === null;
      continue;
    }
    if (annex) {
      flush();
      current = {
        numero: `Annexe ${annex[1] ?? ''}`.trim(),
        titre: annex[2]?.trim() || null,
        contenu: '',
        ancre: null,
        type: 'annexe',
        position: articles.length,
      };
      expectTitle = current.titre === null;
      continue;
    }
    if (!current) continue;
    if (expectTitle && line.length > 0) {
      expectTitle = false;
      if (line.length <= 100 && !/^\d/.test(line) && !/[.;:!?]$/.test(line)) {
        current.titre = line;
        continue;
      }
    }
    if (line.length > 0) buffer.push(line);
  }
  flush();
  return articles;
}
