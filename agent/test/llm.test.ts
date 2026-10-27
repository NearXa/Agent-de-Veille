import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, readCache, writeCache } from '../src/llm/cache.js';
import { CostTracker, ZERO_USAGE, estimateCostUsd, toTokenUsage } from '../src/llm/cost.js';
import { BudgetExceededError } from '../src/utils/errors.js';
import { useTmpRoot } from './helpers/tmp-root.js';

describe('coût LLM', () => {
  it('estime le coût selon la table de prix et distingue les tokens en cache', () => {
    const usage = { ...ZERO_USAGE, inputTokens: 1_000_000, outputTokens: 100_000 };
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBeCloseTo(4 + 2, 6);
    const cached = { ...usage, cacheReadTokens: 500_000 };
    expect(estimateCostUsd('claude-opus-5-5', cached)).toBeCloseTo(2 + 0.1 + 2, 6);
    expect(estimateCostUsd('modele-inconnu', usage)).toBeNull();
  });

  it('convertit un usage AI SDK partiel en compteurs', () => {
    expect(
      toTokenUsage({
        inputTokens: 10,
        outputTokens: undefined,
        inputTokenDetails: { cacheReadTokens: 4 },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 4,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('déclenche le garde-fou de coût', () => {
    const tracker = new CostTracker();
    tracker.add({ ...ZERO_USAGE, inputTokens: 10 }, 1.5, false);
    expect(() => tracker.assertBudget(2)).not.toThrow();
    tracker.add({ ...ZERO_USAGE, inputTokens: 10 }, 1, false);
    expect(() => tracker.assertBudget(2)).toThrow(BudgetExceededError);
    expect(tracker.summary()).toMatchObject({
      calls: 2,
      cachedCalls: 0,
      inputTokens: 20,
      costUsd: 2.5,
    });
  });
});

describe('cache LLM', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
  });
  afterEach(() => tmp.cleanup());

  it('écrit et relit une entrée par clé déterministe', () => {
    const parts = {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      schemaName: 'ExtractionResult',
      promptVersion: '1.0',
      instructions: 'instr',
      prompt: 'chunk',
    };
    const key = cacheKey(parts);
    expect(key).toBe(cacheKey({ ...parts }));
    expect(key).not.toBe(cacheKey({ ...parts, promptVersion: '1.1' }));
    expect(readCache(key)).toBeUndefined();
    writeCache({
      key,
      provider: parts.provider,
      model: parts.model,
      schema_name: parts.schemaName,
      prompt_version: parts.promptVersion,
      created_at: '2026-10-27T16:01:00.000Z',
      usage: { ...ZERO_USAGE, inputTokens: 1 },
      output: { exigences: [] },
    });
    expect(readCache<{ exigences: unknown[] }>(key)?.output).toEqual({ exigences: [] });
  });
});
