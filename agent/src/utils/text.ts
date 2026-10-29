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

const ACRONYME = /^[\p{Lu}\p{N}]{2,8}$/u;

function echapperRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Vrai si `keyword` apparaît dans `text` en tant que mot, sans tenir compte des accents.
 * - Sigle en majuscules (TIC, NIS, DORA) : mot entier, casse respectée, chiffres permis à la suite (« NIS2 », « NIS 2 ») ;
 *   « article », « définis », « États-Unis » ou « dorade » ne le contiennent donc pas.
 * - Autre mot-clé : début de mot, casse ignorée (« cyber » retient « cybersécurité », « sanction » retient « sanctions »).
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  const cle = keyword.trim();
  if (cle.length === 0) return false;
  if (ACRONYME.test(cle)) {
    const sansAccents = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return new RegExp(`(?<![\\p{L}\\p{N}])${echapperRegex(cle)}(?!\\p{L})`, 'u').test(sansAccents);
  }
  const motif = normalizeForMatch(cle);
  return motif.length > 0 && ` ${normalizeForMatch(text)}`.includes(` ${motif}`);
}

/** Filtre de veille : vrai sans mots-clés, sinon si l'un d'eux apparaît (voir `matchesKeyword`). */
export function matchesAnyKeyword(text: string, keywords: readonly string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return true;
  return keywords.some((k) => matchesKeyword(text, k));
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
