import { z } from 'zod';

/** Énumérations partagées entre les schémas de sortie du LLM, le store et les bases Notion. */
export const SourceId = z.enum([
  'eurlex',
  'legifrance',
  'judilibre',
  'assemblee-nationale',
  'senat',
  'cnil',
  'anssi',
  'local-file',
]);
export type SourceId = z.infer<typeof SourceId>;

export const SOURCE_LABELS: Record<SourceId, string> = {
  eurlex: 'EUR-Lex',
  legifrance: 'Légifrance',
  judilibre: 'Judilibre',
  'assemblee-nationale': 'Assemblée nationale',
  senat: 'Sénat',
  cnil: 'CNIL',
  anssi: 'ANSSI',
  'local-file': 'Fichier local',
};

export const TypeTexte = z.enum([
  'Règlement UE',
  'Directive UE',
  'Loi',
  'Ordonnance',
  'Décret',
  'Arrêté',
  'Projet de loi',
  'Proposition de loi',
  'Décision',
  'Délibération',
  'Recommandation',
  'Référentiel',
]);
export type TypeTexte = z.infer<typeof TypeTexte>;

export const StatutTexte = z.enum(['En vigueur', 'Projet', 'Adopté', 'Abrogé', 'Modifié']);
export const Applicabilite = z.enum(['Oui', 'Non', 'À déterminer']);
export const TypeObligation = z.enum([
  'Obligation de faire',
  'Interdiction',
  'Notification',
  'Documentaire',
  'Gouvernance',
  'Contractuelle',
  'Technique',
]);
export type TypeObligation = z.infer<typeof TypeObligation>;

export const TypeEcheance = z.enum([
  'Entrée en application',
  'Transposition',
  'Délai de notification',
  'Périodique',
  'Non précisée',
]);
export const NiveauSanction = z.enum(['Faible', 'Moyen', 'Élevé', 'Critique', 'Non précisé']);
export const StatutValidation = z.enum([
  'À valider',
  'Validée',
  'Corrigée',
  'Rejetée',
  'À revalider',
]);
export type StatutValidation = z.infer<typeof StatutValidation>;
export const Couverture = z.enum(['Couverte', 'Partielle', 'Non couverte', 'À évaluer']);
export const EffortEstime = z.enum(['Faible', 'Moyen', 'Élevé']);

export const Confiance = z.number().min(0).max(1);
/** Date ISO 8601 (jour), ex. 2025-01-17. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ');
/** Horodatage ISO 8601 complet. */
export const IsoDateTime = z.string().min(10);

export const ID_PATTERNS = {
  TX: /^TX-\d{4,}$/,
  EX: /^EX-\d{4,}$/,
  CT: /^CT-\d{4,}$/,
  RK: /^RK-\d{4,}$/,
  JP: /^JP-\d{4,}$/,
  LA: /^LA-\d{4,}$/,
  RUN: /^RUN-\d{8}-\d{4}(-\d+)?$/,
} as const;
export type IdPrefix = Exclude<keyof typeof ID_PATTERNS, 'RUN'>;
