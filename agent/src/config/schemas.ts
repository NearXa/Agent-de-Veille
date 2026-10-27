import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AppError, formatZodIssues } from '../utils/errors.js';
import { paths } from '../utils/paths.js';

// --- Énumérations partagées avec les bases Notion ---
export const StatutControle = z.enum(['En place', 'Partiel', 'Planifié', 'Absent']);
export const EfficaciteControle = z.enum(['Non évaluée', 'Faible', 'Satisfaisante', 'Forte']);
export const Referentiel = z.enum(['ISO 27001:2022', 'NIST CSF 2.0', 'CIS v8', 'Interne', 'Autre']);
export const NiveauRisque = z.enum(['Faible', 'Modéré', 'Élevé', 'Critique']);

// --- config/organisation.yaml ---
export const OrganisationSchema = z.object({
  organisation: z.object({
    nom: z.string().min(1),
    nom_court: z.string().optional(),
    forme_juridique: z.string().optional(),
    pays: z.string().min(1),
    siege: z.string().optional(),
    effectif: z.number().int().positive(),
    secteur: z.string().min(1),
    description: z.string().min(1),
    agrements: z.array(z.object({ autorite: z.string(), type: z.string() })).default([]),
    statuts_reglementaires: z.array(z.string()).default([]),
    exclusions_connues: z.array(z.string()).default([]),
  }),
  systeme_information: z.object({
    modele: z.string().min(1),
    cloud: z.array(z.string()).default([]),
    on_premise: z.array(z.string()).default([]),
    objectifs_continuite: z
      .object({ rto_cible_heures: z.number(), rpo_cible_heures: z.number() })
      .optional(),
    gouvernance_tic: z.record(z.string(), z.unknown()).optional(),
  }),
  processus: z.array(z.string().min(1)).min(1),
  systemes: z.array(z.string().min(1)).min(1),
  donnees: z.array(z.string().min(1)).min(1),
  contrats: z.array(z.string().min(1)).min(1),
  departements: z.array(z.string().min(1)).min(1),
  prestataires_tic_critiques: z
    .array(
      z.object({
        nom: z.string(),
        service: z.string(),
        criticite: z.string(),
        localisation: z.string().optional(),
      }),
    )
    .default([]),
  raci_roles: z.array(z.string()).default([]),
});
export type Organisation = z.infer<typeof OrganisationSchema>;

// --- config/controles.yaml ---
export const ControleSchema = z.object({
  id: z.string().regex(/^CT-\d{4,}$/, 'identifiant attendu au format CT-0001'),
  nom: z.string().min(1),
  description: z.string().min(1),
  referentiel: Referentiel,
  reference: z.string().min(1),
  proprietaire: z.string().min(1),
  statut: StatutControle,
  efficacite: EfficaciteControle,
  preuves: z.string().optional(),
});
export type Controle = z.infer<typeof ControleSchema>;

export const ControlesSchema = z
  .object({
    referentiels: z.array(z.string()).default([]),
    controles: z.array(ControleSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const controle of value.controles) {
      if (seen.has(controle.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `identifiant de contrôle en double : ${controle.id}`,
        });
      }
      seen.add(controle.id);
    }
  });
export type Controles = z.infer<typeof ControlesSchema>;

// --- config/risques.yaml ---
const EchelleSchema = z.record(
  z.string(),
  z.object({ libelle: z.string(), description: z.string().optional() }),
);

export const RisquesSchema = z.object({
  probabilite: EchelleSchema,
  impact: EchelleSchema,
  niveaux: z
    .array(
      z.object({ nom: NiveauRisque, min: z.number().int().min(1), max: z.number().int().max(16) }),
    )
    .min(1),
  seuil_acceptation: NiveauRisque,
  attenuation: z.record(z.string(), z.union([z.number(), z.record(z.string(), z.number())])),
  categories: z.array(z.string()).min(1),
  traitements: z.array(z.string()).min(1),
});
export type Risques = z.infer<typeof RisquesSchema>;

// --- config/sources.yaml ---
export const DocumentLocalSchema = z.object({
  fichier: z.string().min(1),
  source_origine: z.string().min(1),
  reference: z.string().min(1),
  url_officielle: z.url(),
  titre: z.string().optional(),
});
export type DocumentLocal = z.infer<typeof DocumentLocalSchema>;

export const SourceConfigSchema = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  enabled: z.boolean().default(false),
  description: z.string().optional(),
  cron: z.string().optional(),
  analyse_automatique: z.boolean().optional(),
  rss: z.array(z.string()).optional(),
  mots_cles: z.array(z.string()).optional(),
  requete: z.string().optional(),
  juridictions: z.array(z.string()).optional(),
  env: z.enum(['sandbox', 'production']).optional(),
  url_html: z.string().optional(),
  urls_alternatives: z.array(z.string()).optional(),
  csv: z.string().optional(),
  documents: z.array(DocumentLocalSchema).optional(),
  references: z
    .array(
      z.object({
        reference: z.string().min(1),
        titre: z.string().optional(),
        suivi: z.boolean().default(false),
      }),
    )
    .optional(),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const SourcesSchema = z.object({
  defaults: z.object({
    cron: z.string(),
    timeout_ms: z.number().int().positive(),
    retries: z.number().int().nonnegative(),
    rate_limit_per_minute: z.number().int().positive(),
    analyse_automatique: z.boolean().default(false),
    fenetre_initiale_jours: z.number().int().positive().default(30),
    max_par_passage: z.number().int().positive().default(20),
  }),
  sources: z.array(SourceConfigSchema).min(1),
});
export type Sources = z.infer<typeof SourcesSchema>;

// --- Chargement ---
function loadYaml<T>(file: string, schema: z.ZodType<T>): T {
  const filePath = paths.config(file);
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new AppError(`Impossible de lire ${filePath} : ${(error as Error).message}`, {
      cause: error,
    });
  }
  const parsed = schema.safeParse(doc);
  if (!parsed.success) {
    throw new AppError(`${file} invalide : ${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
}

export const loadOrganisation = (): Organisation =>
  loadYaml('organisation.yaml', OrganisationSchema);
export const loadControles = (): Controles => loadYaml('controles.yaml', ControlesSchema);
export const loadRisques = (): Risques => loadYaml('risques.yaml', RisquesSchema);
export const loadSources = (): Sources => loadYaml('sources.yaml', SourcesSchema);

export interface AllConfig {
  organisation: Organisation;
  controles: Controles;
  risques: Risques;
  sources: Sources;
}

export function loadAllConfig(): AllConfig {
  return {
    organisation: loadOrganisation(),
    controles: loadControles(),
    risques: loadRisques(),
    sources: loadSources(),
  };
}
