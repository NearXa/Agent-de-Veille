import { z } from 'zod';
import { Confiance, NiveauSanction, TypeEcheance, TypeObligation } from './common.js';

/** Échéance telle que le LLM peut la lire dans le chunk (jamais inventée : `null` sinon). */
export const EcheanceExtraiteSchema = z.object({
  date: z
    .string()
    .nullable()
    .describe(
      'Date au format AAAA-MM-JJ si le chunk la donne explicitement pour cette obligation, sinon null',
    ),
  type: TypeEcheance,
  texte_source: z
    .string()
    .nullable()
    .describe("Article ou passage du chunk qui fonde l'échéance (ex. « Art. 64 »), sinon null"),
});

export const SanctionExtraiteSchema = z.object({
  description: z.string().describe('Sanction décrite par le chunk pour cette obligation'),
  niveau: NiveauSanction,
  article: z
    .string()
    .nullable()
    .describe("Article qui prévoit la sanction, s'il figure dans le chunk"),
});

/** Contrat de sortie du LLM pour une exigence (SPEC.md, section 8). */
export const ExigenceExtraiteSchema = z.object({
  titre: z
    .string()
    .min(5)
    .max(200)
    .describe(
      "Titre court à l'infinitif, ex. « Mettre en place un cadre de gestion du risque lié aux TIC »",
    ),
  description: z
    .string()
    .min(20)
    .max(1200)
    .describe(
      'Obligation reformulée en une phrase actionnable, fidèle au texte, sans interprétation',
    ),
  articles: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Références exactes aux articles du chunk, format « Art. 6 §1 » ou « Art. 9 §4, point c) »',
    ),
  extrait_verbatim: z
    .string()
    .min(20)
    .max(400)
    .describe(
      'Citation exacte copiée du chunk (orthographe, ponctuation, accents), 400 caractères max, sans « … »',
    ),
  type_obligation: TypeObligation,
  destinataires: z
    .array(z.string())
    .describe(
      'Destinataires nommés par le texte, ex. « Entités financières », « Prestataires tiers de services TIC »',
    ),
  echeance: EcheanceExtraiteSchema.nullable(),
  sanction: SanctionExtraiteSchema.nullable(),
  confiance: Confiance.describe(
    '1 = obligation explicite et sans ambiguïté, 0,5 = implicite ou sujette à interprétation',
  ),
  justification_confiance: z.string().max(400),
});
export type ExigenceExtraite = z.infer<typeof ExigenceExtraiteSchema>;

/** Résultat d'un appel d'extraction sur un chunk. */
export const ExtractionResultSchema = z.object({
  texte_id: z.string(),
  chunk_id: z.string(),
  exigences: z.array(ExigenceExtraiteSchema),
  sections_traitees: z.array(z.string()).describe('Numéros des articles analysés, ex. ["5", "6"]'),
  avertissements: z
    .array(z.string())
    .describe('Points ambigus ou interprétations à soumettre à validation humaine'),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
