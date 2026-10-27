import { diffLines } from 'diff';
import type { ArticleRecord } from '../store/types.js';
import { collapseWhitespace, truncate } from '../utils/text.js';

export interface ArticleDiff {
  numero: string;
  lignes_ajoutees: number;
  lignes_supprimees: number;
  extrait: string;
}

export interface TexteDiff {
  articles_ajoutes: string[];
  articles_supprimes: string[];
  articles_modifies: string[];
  details: ArticleDiff[];
}

/** Diff par article entre deux versions d'un texte (ajouté, supprimé, modifié avec extrait). */
export function diffArticles(before: ArticleRecord[], after: ArticleRecord[]): TexteDiff {
  const byNumero = (list: ArticleRecord[]): Map<string, ArticleRecord> =>
    new Map(list.map((a) => [a.numero.toLowerCase(), a] as const));
  const prev = byNumero(before);
  const next = byNumero(after);
  const result: TexteDiff = {
    articles_ajoutes: [],
    articles_supprimes: [],
    articles_modifies: [],
    details: [],
  };

  for (const [key, article] of next) {
    const old = prev.get(key);
    if (!old) {
      result.articles_ajoutes.push(article.numero);
      continue;
    }
    const oldText = collapseWhitespace(old.contenu);
    const newText = collapseWhitespace(article.contenu);
    if (oldText === newText && (old.titre ?? '') === (article.titre ?? '')) continue;
    result.articles_modifies.push(article.numero);
    const parts = diffLines(`${oldText}\n`, `${newText}\n`);
    let added = 0;
    let removed = 0;
    const samples: string[] = [];
    for (const part of parts) {
      if (part.added) {
        added += part.count ?? 0;
        if (samples.length < 4) samples.push(`+ ${truncate(part.value.trim(), 160)}`);
      } else if (part.removed) {
        removed += part.count ?? 0;
        if (samples.length < 4) samples.push(`- ${truncate(part.value.trim(), 160)}`);
      }
    }
    result.details.push({
      numero: article.numero,
      lignes_ajoutees: added,
      lignes_supprimees: removed,
      extrait: samples.join('\n'),
    });
  }
  for (const [key, article] of prev) {
    if (!next.has(key)) result.articles_supprimes.push(article.numero);
  }
  return result;
}

export function summarizeDiff(diff: TexteDiff): string {
  return `${diff.articles_ajoutes.length} ajouté(s), ${diff.articles_supprimes.length} supprimé(s), ${diff.articles_modifies.length} modifié(s)`;
}
