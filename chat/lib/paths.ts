import { existsSync } from 'node:fs';
import path from 'node:path';

/** Racine du dépôt veille-grc : VEILLE_ROOT, sinon le dossier courant s'il contient data/store, sinon son parent. */
export function repoRoot(): string {
  const fromEnv = process.env.VEILLE_ROOT;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'data', 'store'))) return cwd;
  return path.resolve(cwd, '..');
}

export const storeFile = (name: string): string =>
  path.join(repoRoot(), 'data', 'store', `${name}.json`);
export const outputFile = (...segments: string[]): string =>
  path.join(repoRoot(), 'output', ...segments);
export const envFile = (): string => path.join(repoRoot(), '.env');
