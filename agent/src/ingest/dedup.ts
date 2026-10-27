import type { TexteRecord } from '../store/types.js';
import { normalizeForMatch } from '../utils/text.js';

export interface DuplicateMatch {
  record: TexteRecord;
  raison: 'reference' | 'hash' | 'titre';
}

/** Titre normalisé pour la déduplication inter-sources (mentions EEE et parenthèses finales retirées). */
export function normalizeTitle(titre: string): string {
  return normalizeForMatch(
    titre.replace(/\(texte présentant de l[’']intérêt pour l[’']eee\)/i, ''),
  );
}

/**
 * Déduplication (SPEC.md, section 9) : clé (source, référence), puis hash de contenu, puis titre
 * normalisé pour un même texte vu sur plusieurs sources.
 */
export function findDuplicate(
  textes: TexteRecord[],
  candidate: { source: string; reference: string; hash_sha256: string; titre: string },
): DuplicateMatch | undefined {
  const byRef = textes.find(
    (t) => t.source === candidate.source && t.reference === candidate.reference,
  );
  if (byRef) return { record: byRef, raison: 'reference' };
  const byHash = textes.find((t) => t.hash_sha256 === candidate.hash_sha256);
  if (byHash) return { record: byHash, raison: 'hash' };
  const title = normalizeTitle(candidate.titre);
  if (title.length < 20) return undefined;
  const byTitle = textes.find((t) => normalizeTitle(t.titre) === title);
  return byTitle ? { record: byTitle, raison: 'titre' } : undefined;
}
