import { z } from 'zod';

export const CadreGouvernance = z.enum(['TOGAF', 'ITIL', 'Hybride']);
export type CadreGouvernance = z.infer<typeof CadreGouvernance>;

/** Recommandation de cadre de gouvernance (SPEC.md, sections 8 et 12). L'agent recommande, l'humain décide. */
export const GouvernanceSchema = z.object({
  cadre_recommande: CadreGouvernance,
  score_togaf: z
    .number()
    .min(0)
    .max(100)
    .describe('Poids des obligations de transformation d’architecture, sur 100'),
  score_itil: z
    .number()
    .min(0)
    .max(100)
    .describe('Poids des obligations de run et de processus opérationnels, sur 100'),
  criteres: z
    .array(
      z.object({
        critere: z.string(),
        poids: z.number().min(0).max(10),
        evaluation: z
          .string()
          .max(400)
          .describe('Ce que les exigences du texte impliquent pour ce critère'),
      }),
    )
    .min(3),
  justification: z.string().min(50).max(2000),
  mapping: z.array(
    z.object({
      exigence_id: z.string(),
      cadre: z.enum(['TOGAF', 'ITIL']),
      phase_ou_pratique: z.string().describe('Ex. « TOGAF Phase B » ou « ITIL Change Enablement »'),
      livrable: z
        .string()
        .describe(
          'Ex. « Architecture Definition Document » ou « Procédure de gestion des changements »',
        ),
    }),
  ),
  alternatives: z.string().max(1200).describe('Les autres choix possibles et leurs conséquences'),
  points_de_decision_humaine: z.array(z.string()).min(1),
});
export type Gouvernance = z.infer<typeof GouvernanceSchema>;

export const TOGAF_PHASES = [
  'TOGAF Phase A (Architecture Vision)',
  'TOGAF Phase B (Business Architecture)',
  'TOGAF Phase C (Information Systems Architectures)',
  'TOGAF Phase D (Technology Architecture)',
  'TOGAF Phase E (Opportunities and Solutions)',
  'TOGAF Phase F (Migration Planning)',
  'TOGAF Phase G (Implementation Governance)',
  'TOGAF Phase H (Architecture Change Management)',
] as const;

export const ITIL_PRACTICES = [
  'ITIL Incident Management',
  'ITIL Change Enablement',
  'ITIL Service Continuity Management',
  'ITIL Monitoring and Event Management',
  'ITIL Supplier Management',
  'ITIL Information Security Management',
  'ITIL Service Level Management',
  'ITIL Risk Management',
] as const;
