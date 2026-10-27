import { NoObjectGeneratedError, Output, TypeValidationError, generateText } from 'ai';
import type { z } from 'zod';
import { loadEnv } from '../config/env.js';
import type { RunContext } from '../store/run.js';
import { StructuredOutputError, formatZodIssues } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import { truncate } from '../utils/text.js';
import { cacheKey, readCache, writeCache } from './cache.js';
import {
  CostTracker,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  toTokenUsage,
  type TokenUsage,
} from './cost.js';
import { resolveModel, type ResolvedModel } from './provider.js';

export interface StructuredCallOptions<T> {
  /** Schéma Zod de la sortie attendue (contrat du prompt). */
  schema: z.ZodType<T>;
  schemaName: string;
  /** Consignes système (rôle, règles) : le texte juridique reste une donnée, jamais une consigne. */
  instructions: string;
  prompt: string;
  /** Version du prompt (en-tête du fichier .md) : change la clé de cache. */
  promptVersion: string;
  run?: RunContext;
  log?: Logger;
  label?: string;
  maxAttempts?: number;
  useCache?: boolean;
}

export interface StructuredCallResult<T> {
  output: T;
  usage: TokenUsage;
  costUsd: number | null;
  cached: boolean;
  attempts: number;
  warnings: string[];
}

let resolvedModelCache: ResolvedModel | undefined;

function getResolvedModel(): ResolvedModel {
  if (!resolvedModelCache) resolvedModelCache = resolveModel(loadEnv());
  return resolvedModelCache;
}

/** Pour les tests : oublie le modèle résolu (changement de .env). */
export function resetResolvedModel(): void {
  resolvedModelCache = undefined;
}

function describeFailure(error: NoObjectGeneratedError): string {
  if (TypeValidationError.isInstance(error.cause)) {
    const zodError = error.cause.cause as { issues?: unknown } | undefined;
    if (zodError && Array.isArray(zodError.issues)) {
      return formatZodIssues(zodError as { issues: { path: PropertyKey[]; message: string }[] });
    }
    return String(error.cause.message);
  }
  if (error.cause instanceof Error) return error.cause.message;
  return error.message;
}

function formatWarnings(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w)));
}

/**
 * Appel LLM structuré : `generateText` + `Output.object` (schéma Zod), cache par hash, compteur de
 * coût avec garde-fou, et jusqu'à `maxAttempts` tentatives en renvoyant au modèle les erreurs de
 * validation. `temperature` n'est jamais envoyée (non supportée par les modèles Claude 5.x).
 */
export async function generateStructured<T>(
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  const env = loadEnv();
  const log = options.log ?? options.run?.log ?? logger;
  const label = options.label ?? options.schemaName;
  const maxAttempts = options.maxAttempts ?? 3;
  const useCache = options.useCache ?? env.LLM_CACHE;
  const tracker = options.run?.costTracker ?? new CostTracker();

  const key = cacheKey({
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    schemaName: options.schemaName,
    promptVersion: options.promptVersion,
    instructions: options.instructions,
    prompt: options.prompt,
  });

  if (useCache) {
    const hit = readCache<T>(key);
    if (hit) {
      const parsed = options.schema.safeParse(hit.output);
      if (parsed.success) {
        tracker.add(hit.usage, null, true);
        log.info({ label, cache_key: key.slice(0, 12) }, 'Réponse LLM relue depuis le cache');
        return {
          output: parsed.data,
          usage: hit.usage,
          costUsd: 0,
          cached: true,
          attempts: 0,
          warnings: [],
        };
      }
      log.warn({ label }, 'Entrée de cache invalide pour le schéma courant, appel du modèle');
    }
  }

  tracker.assertBudget(env.LLM_MAX_COST_PER_RUN);
  const resolved = getResolvedModel();
  if (options.run) options.run.model = resolved.modelId;

  let prompt = options.prompt;
  let totalUsage: TokenUsage = { ...ZERO_USAGE };
  const warnings: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log.info({ label, attempt, model: resolved.modelId }, 'Appel LLM structuré');
    try {
      const result = await generateText({
        model: resolved.model,
        output: Output.object({ schema: options.schema, name: options.schemaName }),
        instructions: options.instructions,
        prompt,
        maxRetries: 2,
        maxOutputTokens: 16_000,
        abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
        providerOptions: resolved.providerOptions,
      });
      totalUsage = addUsage(totalUsage, toTokenUsage(result.usage));
      warnings.push(...formatWarnings(result.warnings));
      const output = result.output;
      const costUsd = estimateCostUsd(resolved.modelId, totalUsage);
      tracker.add(totalUsage, costUsd, false);
      if (useCache) {
        writeCache<T>({
          key,
          provider: env.LLM_PROVIDER,
          model: resolved.modelId,
          schema_name: options.schemaName,
          prompt_version: options.promptVersion,
          created_at: new Date().toISOString(),
          usage: totalUsage,
          output,
        });
      }
      log.info(
        {
          label,
          attempt,
          input_tokens: totalUsage.inputTokens,
          output_tokens: totalUsage.outputTokens,
          cost_usd: costUsd,
        },
        'Réponse LLM validée',
      );
      tracker.assertBudget(env.LLM_MAX_COST_PER_RUN);
      return { output, usage: totalUsage, costUsd, cached: false, attempts: attempt, warnings };
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      totalUsage = addUsage(totalUsage, toTokenUsage(error.usage));
      const issues = describeFailure(error);
      log.warn({ label, attempt, issues: truncate(issues, 500) }, 'Sortie non conforme au schéma');
      if (attempt >= maxAttempts) {
        tracker.add(totalUsage, estimateCostUsd(resolved.modelId, totalUsage), false);
        throw new StructuredOutputError(
          `Sortie LLM non conforme au schéma ${options.schemaName} après ${attempt} tentative(s) : ${truncate(issues, 800)}`,
          { cause: error },
        );
      }
      prompt =
        `${options.prompt}\n\n---\n` +
        `Ta réponse précédente n'était pas conforme au schéma attendu.\n` +
        `Erreurs de validation : ${truncate(issues, 1500)}\n` +
        `Début de la réponse précédente : ${truncate(error.text ?? '', 1500)}\n` +
        `Réponds à nouveau en respectant strictement le schéma.`;
    }
  }
  throw new StructuredOutputError(`Aucune tentative exécutée pour ${options.schemaName}`);
}
