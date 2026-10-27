/**
 * Normalisation pour le test de sous-chaîne (vérification du verbatim) : retire les accents,
 * la ponctuation et les espaces multiples, passe en minuscules. Les guillemets typographiques,
 * apostrophes et espaces insécables sont traités comme des séparateurs.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vrai si `needle` normalisé est une sous-chaîne de `haystack` normalisé. */
export function containsNormalized(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length === 0) return false;
  return normalizeForMatch(haystack).includes(n);
}

/** Estimation grossière du nombre de tokens pour du français (environ 3,5 caractères par token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Réduit les espaces (y compris insécables) et les lignes vides successives. */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t\u00a0\u202f]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function slugify(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, '-').slice(0, 80);
}
