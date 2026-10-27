import type { ConfianceDetail } from '../store/types.js';

/** Pondérations de la formule documentée dans docs/architecture.md. */
export const CONFIDENCE_WEIGHTS = { llm: 0.5, verbatim: 0.3, article: 0.2 } as const;

export function computeConfidence(detail: ConfianceDetail): number {
  const value =
    CONFIDENCE_WEIGHTS.llm * Math.min(1, Math.max(0, detail.llm)) +
    CONFIDENCE_WEIGHTS.verbatim * detail.verbatim_retrouve +
    CONFIDENCE_WEIGHTS.article * detail.article_existe;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type ConfidenceLevel = 'vert' | 'orange' | 'rouge';

export function confidenceLevel(confiance: number): ConfidenceLevel {
  if (confiance >= 0.8) return 'vert';
  if (confiance >= 0.6) return 'orange';
  return 'rouge';
}

/** À relire en priorité : confiance sous 0,6 ou extrait / article non vérifié. */
export function needsPriorityReview(confiance: number, verifieDansSource: boolean): boolean {
  return confiance < 0.6 || !verifieDansSource;
}
