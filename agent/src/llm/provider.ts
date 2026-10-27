import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import type { generateText } from 'ai';
import { requireLlmApiKey, type Env, type LlmProvider } from '../config/env.js';

type GenerateTextOptions = Parameters<typeof generateText>[0];
export type LanguageModel = GenerateTextOptions['model'];
export type ProviderOptions = NonNullable<GenerateTextOptions['providerOptions']>;

export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  model: LanguageModel;
  providerOptions: ProviderOptions;
}

/**
 * Factory de modèle (AI SDK) selon `LLM_PROVIDER` et `LLM_MODEL`.
 * Anthropic : structured outputs natifs (`structuredOutputMode: 'auto'`) et effort configurable.
 * Aucune `temperature` n'est envoyée : les modèles Claude 5.x ne l'acceptent plus.
 */
export function resolveModel(env: Env): ResolvedModel {
  const apiKey = requireLlmApiKey(env);
  switch (env.LLM_PROVIDER) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return {
        provider: 'anthropic',
        modelId: env.LLM_MODEL,
        model: anthropic(env.LLM_MODEL),
        providerOptions: {
          anthropic: { structuredOutputMode: 'auto', effort: env.LLM_EFFORT },
        },
      };
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return {
        provider: 'openai',
        modelId: env.LLM_MODEL,
        model: openai(env.LLM_MODEL),
        providerOptions: {},
      };
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey });
      return {
        provider: 'mistral',
        modelId: env.LLM_MODEL,
        model: mistral(env.LLM_MODEL),
        providerOptions: {},
      };
    }
  }
}
