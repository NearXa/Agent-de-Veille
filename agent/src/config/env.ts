import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { AppError, formatZodIssues } from '../utils/errors.js';
import { paths } from '../utils/paths.js';

const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'mistral']).default('anthropic'),
  LLM_MODEL: z.string().min(1).default('claude-opus-5-5'),
  LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_KEY: z.string().min(1).optional(),
  LLM_CACHE: z
    .enum(['0', '1', 'true', 'false'])
    .default('1')
    .transform((v) => v === '1' || v === 'true'),
  LLM_MAX_COST_PER_RUN: z.coerce.number().nonnegative().default(2),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  NOTION_TOKEN: z.string().min(1).optional(),
  NOTION_PARENT_PAGE_ID: z.string().min(1).optional(),
  NOTION_API_VERSION: z.string().default('2025-09-03'),
  PISTE_CLIENT_ID: z.string().min(1).optional(),
  PISTE_CLIENT_SECRET: z.string().min(1).optional(),
  PISTE_API_KEY: z.string().min(1).optional(),
  PISTE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  LOG_LEVEL: z.string().default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});

export type Env = z.infer<typeof EnvSchema>;
export type LlmProvider = Env['LLM_PROVIDER'];

let cached: Env | undefined;

/** Charge `.env` (sans écraser les variables déjà présentes) et valide la configuration. */
export function loadEnv(options: { reload?: boolean } = {}): Env {
  if (cached && !options.reload) return cached;
  loadDotenv({ path: paths.env(), override: false, quiet: true });
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value.trim() !== '') raw[key] = value.trim();
  }
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(`Configuration .env invalide : ${formatZodIssues(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}

/** Clé API du provider LLM configuré, ou erreur explicite. */
export function requireLlmApiKey(env: Env): string {
  const byProvider: Record<LlmProvider, { key: string | undefined; name: string }> = {
    anthropic: { key: env.ANTHROPIC_API_KEY, name: 'ANTHROPIC_API_KEY' },
    openai: { key: env.OPENAI_API_KEY, name: 'OPENAI_API_KEY' },
    mistral: { key: env.MISTRAL_API_KEY, name: 'MISTRAL_API_KEY' },
  };
  const entry = byProvider[env.LLM_PROVIDER];
  if (!entry.key) {
    throw new AppError(
      `Clé API manquante : renseigner ${entry.name} dans .env (provider ${env.LLM_PROVIDER}).`,
    );
  }
  return entry.key;
}

export function hasLlmApiKey(env: Env): boolean {
  try {
    requireLlmApiKey(env);
    return true;
  } catch {
    return false;
  }
}

export function isNotionConfigured(env: Env): boolean {
  return Boolean(env.NOTION_TOKEN && env.NOTION_PARENT_PAGE_ID);
}
