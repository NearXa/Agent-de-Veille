import { describe, expect, it } from 'vitest';
import {
  containsNormalized,
  estimateTokens,
  normalizeForMatch,
  truncate,
} from '../src/utils/text.js';

describe('normalizeForMatch', () => {
  it('retire accents, ponctuation, casse et espaces multiples', () => {
    expect(normalizeForMatch("  Les entités financières disposent d'un   cadre ! ")).toBe(
      'les entites financieres disposent d un cadre',
    );
  });

  it('traite les guillemets typographiques et les espaces insécables comme des séparateurs', () => {
    expect(normalizeForMatch('« cadre\u00a0de gestion »\u202f;')).toBe('cadre de gestion');
    expect(normalizeForMatch('d’un cadre')).toBe(normalizeForMatch("d'un cadre"));
  });
});

describe('containsNormalized', () => {
  const source =
    'Article 6\n1.   Les entités financières disposent d’un cadre de gestion du risque lié aux TIC solide, complet et bien documenté, qui fait partie de leur système global de gestion des risques.';

  it('retrouve un extrait malgré apostrophes, accents et espaces différents', () => {
    expect(
      containsNormalized(
        source,
        "Les entites financieres disposent d'un cadre de gestion du risque lie aux TIC solide, complet et bien documente",
      ),
    ).toBe(true);
  });

  it('rejette un extrait absent ou vide', () => {
    expect(containsNormalized(source, 'cadre de gestion du risque de crédit')).toBe(false);
    expect(containsNormalized(source, '   ')).toBe(false);
  });
});

describe('estimateTokens et truncate', () => {
  it('estime environ un token pour 3,5 caractères', () => {
    expect(estimateTokens('a'.repeat(350))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('tronque avec une ellipse', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });
});
