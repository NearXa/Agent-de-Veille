import { describe, expect, it } from 'vitest';
import {
  containsNormalized,
  estimateTokens,
  matchesAnyKeyword,
  matchesKeyword,
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

describe('matchesKeyword (filtre de veille)', () => {
  it('reconnaît un sigle comme mot entier, chiffres permis à la suite', () => {
    expect(matchesKeyword('Règlement (UE) 2022/2554 sur la résilience (DORA)', 'DORA')).toBe(true);
    expect(matchesKeyword('directive NIS2 et directive NIS 2', 'NIS')).toBe(true);
    expect(matchesKeyword('gestion du risque lié aux TIC', 'TIC')).toBe(true);
    expect(matchesKeyword('ICT risk management framework', 'ICT')).toBe(true);
  });

  it('ne trouve plus de sigle au milieu d’un mot (faux positifs du 29/10/2026)', () => {
    expect(matchesKeyword("modifiant l'article 11, paragraphe 1, dudit règlement", 'TIC')).toBe(
      false,
    );
    expect(matchesKeyword('ARTICLE PREMIER', 'TIC')).toBe(false);
    expect(matchesKeyword('les pays tiers définis et les États-Unis', 'NIS')).toBe(false);
    expect(matchesKeyword('accord entre l’Union et la Tunisie', 'NIS')).toBe(false);
    expect(matchesKeyword('mesures techniques pour la dorade rose', 'DORA')).toBe(false);
    expect(matchesKeyword('un contrôle strict', 'ICT')).toBe(false);
  });

  it('retient les mots ordinaires en début de mot, sans accents ni casse', () => {
    expect(matchesKeyword('Stratégie de cybersécurité', 'cyber')).toBe(true);
    expect(matchesKeyword('Délibération : SANCTIONS de 7 millions', 'sanction')).toBe(true);
    expect(
      matchesKeyword("L'intelligence artificielle générative", 'intelligence artificielle'),
    ).toBe(true);
    expect(matchesKeyword('Règlement délégué de la Commission', 'réglement')).toBe(true);
    expect(matchesKeyword('le marché intérieur', 'numérique')).toBe(false);
    expect(matchesKeyword('anticyber', 'cyber')).toBe(false);
  });

  it('sans mots-clés, tout passe ; sinon au moins un doit apparaître', () => {
    expect(matchesAnyKeyword('n’importe quel titre', undefined)).toBe(true);
    expect(matchesAnyKeyword('n’importe quel titre', [])).toBe(true);
    expect(
      matchesAnyKeyword('normes harmonisées des sèche-linge', ['TIC', 'NIS', 'DORA', 'numérique']),
    ).toBe(false);
    expect(matchesAnyKeyword('Le règlement DORA', ['TIC', 'DORA'])).toBe(true);
  });
});
