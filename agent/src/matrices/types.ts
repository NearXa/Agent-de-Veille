export type MatrixId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

export interface MatrixDefinition {
  id: MatrixId;
  slug: string;
  titre: string;
  objectif: string;
  colonnes: readonly string[];
}

export type CellValue = string | number | boolean | null;
export type MatrixRow = Record<string, CellValue>;

export interface MatrixFooter {
  genere_le: string;
  run_id: string | null;
  texte_id: string | null;
  nombre_exigences: number;
  pourcentage_verifiees: number;
  only_validated: boolean;
}

export interface MatrixTable {
  definition: MatrixDefinition;
  rows: MatrixRow[];
  footer: MatrixFooter;
}

export const MATRIX_DEFINITIONS: Record<MatrixId, MatrixDefinition> = {
  M1: {
    id: 'M1',
    slug: 'M1-tracabilite',
    titre: 'M1 Traçabilité',
    objectif: 'Relier chaque exigence à son article et à ses échéances',
    colonnes: [
      'ID exigence',
      'Titre',
      'Texte',
      'Article(s)',
      'Extrait verbatim',
      'URL officielle',
      'Échéance',
      "Type d'échéance",
      'Destinataires',
      'Confiance',
      'Vérifié',
      'Statut de validation',
    ],
  },
  M2: {
    id: 'M2',
    slug: 'M2-impact',
    titre: 'M2 Impact',
    objectif: 'Processus, systèmes, données et contrats concernés',
    colonnes: [
      'ID exigence',
      'Titre',
      'Processus',
      'Systèmes',
      'Données',
      'Contrats et tiers',
      'Départements',
      'Effort estimé',
      'Justification',
    ],
  },
  M3: {
    id: 'M3',
    slug: 'M3-couverture',
    titre: 'M3 Couverture',
    objectif: 'Comparer les exigences aux contrôles existants',
    colonnes: [
      'ID exigence',
      'Titre',
      'Contrôles existants',
      'Couverture',
      'Écart',
      "Lot d'action proposé",
    ],
  },
  M4: {
    id: 'M4',
    slug: 'M4-risque',
    titre: 'M4 Risque',
    objectif: 'Conséquences potentielles et risques résiduels',
    colonnes: [
      'ID risque',
      'ID exigence',
      'Scénario',
      'Catégorie',
      'Probabilité',
      'Impact',
      'Criticité brute',
      'Contrôles atténuants',
      'Risque résiduel',
      'Niveau résiduel',
      'Traitement',
      'Propriétaire',
    ],
  },
  M5: {
    id: 'M5',
    slug: 'M5-jurisprudence',
    titre: 'M5 Jurisprudence',
    objectif: 'Décisions pertinentes par exigence',
    colonnes: [
      'ID exigence',
      'ID décision',
      'Juridiction',
      'Date',
      'Numéro',
      'Résumé',
      'Solution retenue',
      'Portée',
      'Pertinence',
      'URL officielle',
    ],
  },
};
