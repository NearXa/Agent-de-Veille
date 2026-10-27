import { z } from 'zod';
import type { Organisation, Risques } from '../config/schemas.js';
import { Confiance, EffortEstime } from './common.js';
import { EcheanceExtraiteSchema, SanctionExtraiteSchema } from './exigence.js';

/** Applicabilité du texte à l'organisation (SPEC.md, section 8). */
export const ApplicabiliteSchema = z.object({
  applicable: z.enum(['oui', 'non', 'indetermine']),
  justification: z.string().min(20).max(1500),
  criteres: z
    .array(
      z.object({
        critere: z
          .string()
          .describe(
            "Critère issu de l'article de champ d'application, ex. « être une entité financière »",
          ),
        satisfait: z.boolean(),
        article_preuve: z
          .string()
          .nullable()
          .describe('Article du texte qui fonde le critère, ex. « Art. 2 §1, point l) »'),
        extrait: z
          .string()
          .max(400)
          .nullable()
          .describe('Citation exacte du chunk fondant le critère, sinon null'),
      }),
    )
    .min(1),
  confiance: Confiance,
  resume: z
    .string()
    .min(50)
    .max(800)
    .describe('Résumé du texte en trois à cinq phrases pour le fil de veille'),
});
export type Applicabilite = z.infer<typeof ApplicabiliteSchema>;

/** Enrichissement d'une exigence par les articles transversaux (échéances, sanctions, définitions). */
export const EnrichissementExigenceSchema = z.object({
  exigence_id: z.string(),
  echeance: EcheanceExtraiteSchema.nullable(),
  sanction: SanctionExtraiteSchema.nullable(),
  destinataires: z.array(z.string()),
  justification: z.string().max(400),
});
export const EnrichissementSchema = z.object({ exigences: z.array(EnrichissementExigenceSchema) });
export type Enrichissement = z.infer<typeof EnrichissementSchema>;

function closedEnum(values: string[], label: string): z.ZodType<string> {
  const unique = Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
  if (unique.length === 0) return z.string().describe(label);
  return z.enum(unique as [string, ...string[]]).describe(label);
}

/** Impact : les valeurs appartiennent aux listes fermées de config/organisation.yaml (énumérations dynamiques). */
export function buildImpactSchema(org: Organisation) {
  return z.object({
    exigence_id: z.string(),
    processus: z.array(closedEnum(org.processus, "Processus de l'organisation")),
    systemes: z.array(closedEnum(org.systemes, "Systèmes de l'organisation")),
    donnees: z.array(closedEnum(org.donnees, 'Données concernées')),
    contrats: z.array(closedEnum(org.contrats, 'Contrats et tiers concernés')),
    departements: z.array(closedEnum(org.departements, 'Départements concernés')),
    effort_estime: EffortEstime,
    justification: z.string().max(500),
    confiance: Confiance,
  });
}
export function buildImpactBatchSchema(org: Organisation) {
  return z.object({ exigences: z.array(buildImpactSchema(org)) });
}
export type Impact = z.infer<ReturnType<typeof buildImpactSchema>>;

/** Couverture d'une exigence par les contrôles du catalogue. */
export const CouvertureSchema = z.object({
  exigence_id: z.string(),
  controles: z.array(
    z.object({
      controle_id: z.string().describe('Identifiant du catalogue, ex. CT-0012'),
      couverture: z.enum(['totale', 'partielle', 'nulle']),
      ecart: z.string().nullable().describe("Ce qui manque pour couvrir l'exigence, sinon null"),
    }),
  ),
  statut_global: z.enum(['Couverte', 'Partielle', 'Non couverte']),
  justification: z.string().max(500),
});
export const CouvertureBatchSchema = z.object({ exigences: z.array(CouvertureSchema) });
export type CouvertureAnalyse = z.infer<typeof CouvertureSchema>;

/** Scénario de risque pour une exigence non couverte ou partiellement couverte. */
export function buildRisqueSchema(grille: Risques) {
  return z.object({
    exigence_id: z.string(),
    intitule: z.string().min(5).max(150),
    scenario: z
      .string()
      .min(20)
      .max(800)
      .describe("Ce qui se passe pour l'organisation si l'exigence n'est pas respectée"),
    categorie: closedEnum(grille.categories, 'Catégorie de risque'),
    probabilite: z.number().int().min(1).max(4),
    impact: z.number().int().min(1).max(4),
    justification_scores: z.string().max(500),
    traitement_propose: closedEnum(grille.traitements, 'Traitement proposé'),
  });
}
export function buildRisqueBatchSchema(grille: Risques) {
  return z.object({ risques: z.array(buildRisqueSchema(grille)) });
}
export type RisqueAnalyse = z.infer<ReturnType<typeof buildRisqueSchema>>;

/** Requêtes de recherche jurisprudentielle (3 à 5 par exigence). */
export const JurisprudenceRequetesSchema = z.object({
  exigences: z.array(
    z.object({ exigence_id: z.string(), requetes: z.array(z.string().min(3)).min(1).max(5) }),
  ),
});

/** Pertinence d'une décision pour une exigence. */
export const JurisprudenceMatchSchema = z.object({
  exigence_id: z.string(),
  decision_id: z.string(),
  pertinence: Confiance,
  resume: z.string().max(600),
  solution_retenue: z.string().max(400),
  portee: z.string().max(500).describe("Portée pour l'organisation"),
  justification: z.string().max(400),
});
export const JurisprudenceMatchBatchSchema = z.object({
  matches: z.array(JurisprudenceMatchSchema),
});
export type JurisprudenceMatch = z.infer<typeof JurisprudenceMatchSchema>;
