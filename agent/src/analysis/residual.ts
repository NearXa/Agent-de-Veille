import type { Risques } from '../config/schemas.js';
import type { ControleRecord, RisqueRecord } from '../store/types.js';

export type NiveauResiduel = RisqueRecord['niveau_residuel'];

/** Niveau selon les plages de config/risques.yaml. */
export function levelFor(value: number, grille: Risques): NiveauResiduel {
  const niveau = grille.niveaux.find((n) => value >= n.min && value <= n.max);
  if (niveau) return niveau.nom;
  return value <= 3 ? 'Faible' : value <= 6 ? 'Modéré' : value <= 9 ? 'Élevé' : 'Critique';
}

/** Facteur d'atténuation d'un contrôle selon son statut et son efficacité (table `attenuation`). */
export function attenuationFactor(
  controle: Pick<ControleRecord, 'statut' | 'efficacite'>,
  grille: Risques,
): number {
  const byStatut = grille.attenuation[controle.statut];
  if (byStatut === undefined) return 1;
  if (typeof byStatut === 'number') return byStatut;
  return byStatut[controle.efficacite] ?? 1;
}

export interface ResidualResult {
  criticite_brute: number;
  facteur: number;
  risque_residuel: number;
  niveau_residuel: NiveauResiduel;
}

/**
 * Résiduel calculé par code : brut = P × I, multiplié par le produit des facteurs des contrôles
 * atténuants, arrondi à l'entier supérieur et borné à [1, 16].
 */
export function computeResidual(
  probabilite: number,
  impact: number,
  controles: Pick<ControleRecord, 'statut' | 'efficacite'>[],
  grille: Risques,
): ResidualResult {
  const brut = probabilite * impact;
  const facteur = controles.reduce((acc, c) => acc * attenuationFactor(c, grille), 1);
  const residuel = Math.min(16, Math.max(1, Math.ceil(brut * facteur - 1e-9)));
  return {
    criticite_brute: brut,
    facteur,
    risque_residuel: residuel,
    niveau_residuel: levelFor(residuel, grille),
  };
}

/** Propriétaire par défaut d'un risque selon sa catégorie (rôles RACI de l'organisation). */
export function defaultOwner(categorie: string): string {
  switch (categorie) {
    case 'Cyber':
      return 'RSSI';
    case 'Juridique':
      return 'Juridique';
    case 'Opérationnel':
      return 'DSI';
    case 'Financier':
      return 'Direction';
    case 'Réputationnel':
      return 'Conformité';
    default:
      return 'Direction';
  }
}
