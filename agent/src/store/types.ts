import { z } from 'zod';
import {
  Applicabilite,
  Confiance,
  Couverture,
  EffortEstime,
  ID_PATTERNS,
  IsoDate,
  IsoDateTime,
  NiveauSanction,
  SourceId,
  StatutTexte,
  StatutValidation,
  TypeEcheance,
  TypeObligation,
  TypeTexte,
} from '../schemas/common.js';

/** Un article (ou une annexe, un considérant) issu de la segmentation d'un texte. */
export const ArticleRecordSchema = z.object({
  numero: z.string().min(1),
  titre: z.string().nullable(),
  contenu: z.string(),
  ancre: z.string().nullable(),
  url: z.string().nullable().optional(),
  type: z.enum(['article', 'annexe', 'considerant', 'section']).default('article'),
  position: z.number().int().nonnegative(),
});
export type ArticleRecord = z.infer<typeof ArticleRecordSchema>;

/** Une version collectée d'un texte et le diff par article avec la version précédente. */
export const VersionRecordSchema = z.object({
  version: z.number().int().positive(),
  hash_sha256: z.string().length(64),
  collecte_le: IsoDateTime,
  run_id: z.string(),
  articles_ajoutes: z.array(z.string()).default([]),
  articles_supprimes: z.array(z.string()).default([]),
  articles_modifies: z.array(z.string()).default([]),
});
export type VersionRecord = z.infer<typeof VersionRecordSchema>;

/** Enregistrement de `data/store/textes.json`. */
export const TexteRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.TX),
  source: SourceId,
  reference: z.string().min(1),
  titre: z.string().min(1),
  type: TypeTexte,
  url_officielle: z.url(),
  urls_connues: z.array(z.url()).default([]),
  date_publication: IsoDate.nullable(),
  date_entree_en_vigueur: IsoDate.nullable(),
  date_entree_en_application: IsoDate.nullable(),
  statut_texte: StatutTexte.default('En vigueur'),
  hash_sha256: z.string().length(64),
  collecte_le: IsoDateTime,
  derniere_modification_detectee: IsoDateTime.nullable(),
  fichier_source: z.string().nullable(),
  applicable: Applicabilite.default('À déterminer'),
  justification_applicabilite: z.string().nullable(),
  confiance_applicabilite: Confiance.nullable(),
  resume: z.string().nullable(),
  nombre_articles: z.number().int().nonnegative(),
  articles: z.array(ArticleRecordSchema),
  run_id: z.string().regex(ID_PATTERNS.RUN),
  version: z.number().int().positive().default(1),
  historique: z.array(VersionRecordSchema).default([]),
});
export type TexteRecord = z.infer<typeof TexteRecordSchema>;

export const EcheanceSchema = z.object({
  date: IsoDate.nullable(),
  type: TypeEcheance,
  texte_source: z.string().nullable(),
});
export type Echeance = z.infer<typeof EcheanceSchema>;

export const SanctionSchema = z.object({
  description: z.string(),
  niveau: NiveauSanction,
  article: z.string().nullable(),
});
export type Sanction = z.infer<typeof SanctionSchema>;

export const ConfianceDetailSchema = z.object({
  llm: Confiance,
  verbatim_retrouve: z.union([z.literal(0), z.literal(1)]),
  article_existe: z.union([z.literal(0), z.literal(1)]),
});
export type ConfianceDetail = z.infer<typeof ConfianceDetailSchema>;

/** Enregistrement de `data/store/exigences.json`. */
export const ExigenceRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.EX),
  texte_id: z.string().regex(ID_PATTERNS.TX),
  titre: z.string().min(1),
  description: z.string().min(1),
  articles: z.array(z.string().min(1)).min(1),
  extrait_verbatim: z.string(),
  url_article: z.string().nullable(),
  verifie_dans_source: z.boolean(),
  type_obligation: TypeObligation,
  destinataires: z.array(z.string()).default([]),
  echeance: EcheanceSchema.nullable(),
  sanction: SanctionSchema.nullable(),
  confiance: Confiance,
  confiance_detail: ConfianceDetailSchema,
  justification_confiance: z.string().nullable(),
  statut_validation: StatutValidation.default('À valider'),
  validateur: z.string().nullable().default(null),
  date_validation: IsoDateTime.nullable().default(null),
  commentaire_validation: z.string().nullable().default(null),
  version_corrigee: z.record(z.string(), z.unknown()).nullable().default(null),
  processus_impactes: z.array(z.string()).default([]),
  systemes_impactes: z.array(z.string()).default([]),
  donnees_concernees: z.array(z.string()).default([]),
  contrats_concernes: z.array(z.string()).default([]),
  departements_impactes: z.array(z.string()).default([]),
  effort_estime: EffortEstime.nullable().default(null),
  impact_justification: z.string().nullable().default(null),
  couverture: Couverture.default('À évaluer'),
  couverture_detail: z
    .array(
      z.object({
        controle_id: z.string(),
        couverture: z.enum(['totale', 'partielle', 'nulle']),
        ecart: z.string().nullable(),
      }),
    )
    .default([]),
  couverture_justification: z.string().nullable().default(null),
  lot_propose: z.string().nullable().default(null),
  controles_ids: z.array(z.string()).default([]),
  risques_ids: z.array(z.string()).default([]),
  jurisprudence_ids: z.array(z.string()).default([]),
  lots_ids: z.array(z.string()).default([]),
  run_id: z.string().regex(ID_PATTERNS.RUN),
  chunk_id: z.string().nullable().default(null),
  avertissements: z.array(z.string()).default([]),
  /** Motif posé par l'agent quand un article cité a été modifié (statut « À revalider »). */
  revalidation_motif: z.string().nullable().default(null),
});
export type ExigenceRecord = z.infer<typeof ExigenceRecordSchema>;

/** Journal des décisions humaines (`data/store/validations.json`). */
export const ValidationRecordSchema = z.object({
  id: z.string().min(1),
  exigence_id: z.string().regex(ID_PATTERNS.EX),
  action: z.enum(['Validée', 'Corrigée', 'Rejetée', 'À revalider']),
  validateur: z.string().min(1),
  date: IsoDateTime,
  commentaire: z.string().nullable(),
  champs_modifies: z.record(z.string(), z.unknown()).nullable(),
  source: z.enum(['cockpit', 'notion', 'agent']),
});
export type ValidationRecord = z.infer<typeof ValidationRecordSchema>;

/** Enregistrement de `data/store/controles.json` (catalogue de config/controles.yaml + liens). */
export const ControleRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.CT),
  nom: z.string().min(1),
  description: z.string(),
  referentiel: z.string(),
  reference: z.string(),
  proprietaire: z.string(),
  statut: z.enum(['En place', 'Partiel', 'Planifié', 'Absent']),
  efficacite: z.enum(['Non évaluée', 'Faible', 'Satisfaisante', 'Forte']),
  preuves: z.string().nullable().default(null),
  exigences_ids: z.array(z.string()).default([]),
  risques_ids: z.array(z.string()).default([]),
  ecart_constate: z.string().nullable().default(null),
  run_id: z.string().nullable().default(null),
});
export type ControleRecord = z.infer<typeof ControleRecordSchema>;

export const NiveauResiduel = z.enum(['Faible', 'Modéré', 'Élevé', 'Critique']);

/** Enregistrement de `data/store/risques.json`. */
export const RisqueRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.RK),
  exigence_id: z.string().regex(ID_PATTERNS.EX),
  intitule: z.string().min(1),
  scenario: z.string().min(1),
  categorie: z.enum(['Juridique', 'Financier', 'Opérationnel', 'Réputationnel', 'Cyber']),
  probabilite: z.number().int().min(1).max(4),
  impact: z.number().int().min(1).max(4),
  criticite_brute: z.number().int().min(1).max(16),
  justification_scores: z.string().nullable().default(null),
  controles_attenuants: z.array(z.string()).default([]),
  risque_residuel: z.number().int().min(1).max(16),
  niveau_residuel: NiveauResiduel,
  traitement: z.enum(['Réduire', 'Accepter', 'Transférer', 'Éviter']),
  proprietaire: z.string(),
  statut: z.enum(['Identifié', 'En traitement', 'Accepté', 'Clos']).default('Identifié'),
  lots_ids: z.array(z.string()).default([]),
  run_id: z.string(),
});
export type RisqueRecord = z.infer<typeof RisqueRecordSchema>;

/** Enregistrement de `data/store/jurisprudence.json`. */
export const JurisprudenceRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.JP),
  juridiction: z.enum([
    'Cour de cassation',
    "Conseil d'État",
    'CJUE',
    "Cour d'appel",
    'CNIL',
    'Autre',
  ]),
  numero: z.string(),
  date_decision: IsoDate.nullable(),
  url_officielle: z.string(),
  resume: z.string(),
  solution_retenue: z.string().nullable().default(null),
  portee: z.string().nullable().default(null),
  pertinence: Confiance,
  exigences_ids: z.array(z.string()).default([]),
  mots_cles: z.array(z.string()).default([]),
  source: z.enum(['judilibre', 'local-file', 'legifrance']).default('judilibre'),
  source_id: z.string().nullable().default(null),
  run_id: z.string(),
});
export type JurisprudenceRecord = z.infer<typeof JurisprudenceRecordSchema>;

/** Enregistrement de `data/store/lots.json` (lots d'action). */
export const LotRecordSchema = z.object({
  id: z.string().regex(ID_PATTERNS.LA),
  titre: z.string().min(1),
  description: z.string(),
  exigences_ids: z.array(z.string()).default([]),
  risques_ids: z.array(z.string()).default([]),
  priorite: z.enum(['P1', 'P2', 'P3', 'P4']),
  responsable: z.string(),
  echeance_cible: IsoDate.nullable(),
  statut: z.enum(['À planifier', 'En cours', 'Terminé', 'Bloqué']).default('À planifier'),
  cadre_gouvernance: z.enum(['TOGAF', 'ITIL', 'Hybride']),
  phase_ou_pratique: z.string(),
  livrable_attendu: z.string(),
  effort: z.enum(['Faible', 'Moyen', 'Élevé']),
  run_id: z.string(),
});
export type LotRecord = z.infer<typeof LotRecordSchema>;

/** Décision humaine de cadre de gouvernance (output/gouvernance/decision.json). */
export const DecisionGouvernanceSchema = z.object({
  cadre: z.enum(['TOGAF', 'ITIL', 'Hybride']),
  auteur: z.string().min(1),
  date: IsoDateTime,
  commentaire: z.string().nullable(),
  texte_id: z.string().nullable(),
  recommandation_run_id: z.string().nullable(),
});
export type DecisionGouvernance = z.infer<typeof DecisionGouvernanceSchema>;

export type StoreCollectionName =
  'textes' | 'exigences' | 'controles' | 'risques' | 'jurisprudence' | 'lots' | 'validations';
