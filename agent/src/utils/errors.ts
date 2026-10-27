/** Erreur attendue : affichée sans pile d'appels par la CLI, code de sortie 1. */
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
  }
}

export class BudgetExceededError extends AppError {
  constructor(spentUsd: number, maxUsd: number) {
    super(
      `Garde-fou de coût atteint : ${spentUsd.toFixed(4)} $ dépensés pour un maximum de ${maxUsd} $ par run (LLM_MAX_COST_PER_RUN).`,
    );
    this.name = 'BudgetExceededError';
  }
}

export class StructuredOutputError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StructuredOutputError';
  }
}

interface IssueLike {
  path: PropertyKey[];
  message: string;
}

/** Met en forme les erreurs Zod en une ligne lisible. */
export function formatZodIssues(error: { issues: IssueLike[] }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(racine)'} : ${issue.message}`)
    .join(' ; ');
}
