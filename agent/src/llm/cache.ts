import { readJson, writeJsonAtomic, fileExists } from '../utils/fs.js';
import { sha256 } from '../utils/hash.js';
import { paths } from '../utils/paths.js';
import type { TokenUsage } from './cost.js';

export interface CacheKeyParts {
  provider: string;
  model: string;
  schemaName: string;
  promptVersion: string;
  instructions: string;
  prompt: string;
}

export interface LlmCacheEntry<T = unknown> {
  key: string;
  provider: string;
  model: string;
  schema_name: string;
  prompt_version: string;
  created_at: string;
  usage: TokenUsage;
  output: T;
}

/** Clé de cache : hash du provider, du modèle, du schéma, de la version du prompt et du contenu. */
export function cacheKey(parts: CacheKeyParts): string {
  return sha256(JSON.stringify(parts));
}

export function cacheFile(key: string): string {
  return paths.cacheLlm(`${key}.json`);
}

export function readCache<T>(key: string): LlmCacheEntry<T> | undefined {
  const file = cacheFile(key);
  if (!fileExists(file)) return undefined;
  try {
    return readJson<LlmCacheEntry<T>>(file);
  } catch {
    return undefined;
  }
}

export function writeCache<T>(entry: LlmCacheEntry<T>): void {
  writeJsonAtomic(cacheFile(entry.key), entry);
}
