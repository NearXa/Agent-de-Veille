import { config as loadDotenv } from 'dotenv';
import { envFile } from './paths';

let loaded = false;

/** Charge le .env de la racine du dépôt (clé Anthropic, token Notion) sans écraser l'environnement. */
export function loadEnv(): NodeJS.ProcessEnv {
  if (!loaded) {
    loadDotenv({ path: envFile(), override: false, quiet: true });
    loaded = true;
  }
  return process.env;
}

export function requireAnthropicKey(): string {
  const key = loadEnv().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY manquante dans le .env de la racine du dépôt.');
  return key;
}
