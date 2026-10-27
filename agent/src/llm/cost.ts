import { BudgetExceededError } from '../utils/errors.js';

/** Prix en dollars US par million de tokens. Source : platform.claude.com/docs/en/about-claude/pricing (27/10/2026). */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** Convertit l'objet `usage` de l'AI SDK (champs optionnels) en compteurs numériques. */
export function toTokenUsage(usage: unknown): TokenUsage {
  const obj = (usage ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const inputDetails = (obj.inputTokenDetails ?? {}) as Record<string, unknown>;
  const outputDetails = (obj.outputTokenDetails ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(obj.inputTokens),
    outputTokens: num(obj.outputTokens),
    cacheReadTokens: num(inputDetails.cacheReadTokens ?? obj.cachedInputTokens),
    cacheWriteTokens: num(inputDetails.cacheWriteTokens),
    reasoningTokens: num(outputDetails.reasoningTokens ?? obj.reasoningTokens),
  };
}

/** Coût estimé en dollars, ou `null` si le modèle n'est pas dans la table de prix. */
export function estimateCostUsd(modelId: string, usage: TokenUsage): number | null {
  const pricing = PRICING[modelId];
  if (!pricing) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const cost =
    uncached * pricing.input +
    usage.cacheReadTokens * pricing.cacheRead +
    usage.cacheWriteTokens * pricing.cacheWrite +
    usage.outputTokens * pricing.output;
  return cost / 1_000_000;
}

export interface CostSummary {
  calls: number;
  cachedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Compteur de tokens et de coût pour un run, avec garde-fou. */
export class CostTracker {
  private calls = 0;
  private cachedCalls = 0;
  private usage: TokenUsage = { ...ZERO_USAGE };
  private costUsd = 0;
  private unknownPricing = false;

  add(usage: TokenUsage, costUsd: number | null, cached: boolean): void {
    this.calls += 1;
    if (cached) this.cachedCalls += 1;
    this.usage = addUsage(this.usage, usage);
    if (cached) return;
    if (costUsd === null) this.unknownPricing = true;
    else this.costUsd += costUsd;
  }

  get spentUsd(): number {
    return this.costUsd;
  }

  /** Lève `BudgetExceededError` si le coût cumulé dépasse le plafond. */
  assertBudget(maxUsd: number): void {
    if (maxUsd > 0 && this.costUsd > maxUsd) throw new BudgetExceededError(this.costUsd, maxUsd);
  }

  summary(): CostSummary {
    return {
      calls: this.calls,
      cachedCalls: this.cachedCalls,
      inputTokens: this.usage.inputTokens,
      outputTokens: this.usage.outputTokens,
      costUsd: this.unknownPricing && this.costUsd === 0 ? null : this.costUsd,
    };
  }
}
