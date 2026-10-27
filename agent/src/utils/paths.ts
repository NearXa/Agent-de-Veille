import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | undefined;

/**
 * Racine du dépôt : `VEILLE_ROOT` si défini, sinon le répertoire courant s'il contient
 * `package.json` et `agent/`, sinon le dossier parent de `agent/` déduit de ce fichier.
 */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  const fromEnv = process.env.VEILLE_ROOT;
  if (fromEnv && fromEnv.trim() !== '') {
    cachedRoot = path.resolve(fromEnv.trim());
    return cachedRoot;
  }
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'package.json')) && existsSync(path.join(cwd, 'agent'))) {
    cachedRoot = cwd;
    return cachedRoot;
  }
  const here = path.dirname(fileURLToPath(import.meta.url)); // agent/src/utils
  cachedRoot = path.resolve(here, '..', '..', '..');
  return cachedRoot;
}

/** Redirige la racine (utilisé par les tests pour travailler dans un dossier temporaire). */
export function setRepoRoot(root: string | undefined): void {
  cachedRoot = root ? path.resolve(root) : undefined;
}

export const paths = {
  root: (): string => repoRoot(),
  config: (file = ''): string => path.join(repoRoot(), 'config', file),
  data: (...segments: string[]): string => path.join(repoRoot(), 'data', ...segments),
  sources: (file = ''): string => path.join(repoRoot(), 'data', 'sources', file),
  store: (file = ''): string => path.join(repoRoot(), 'data', 'store', file),
  runs: (...segments: string[]): string => path.join(repoRoot(), 'data', 'runs', ...segments),
  raw: (...segments: string[]): string => path.join(repoRoot(), 'data', 'raw', ...segments),
  cacheLlm: (file = ''): string => path.join(repoRoot(), 'data', 'cache', 'llm', file),
  output: (...segments: string[]): string => path.join(repoRoot(), 'output', ...segments),
  notion: (file = ''): string => path.join(repoRoot(), 'notion', file),
  prompts: (file = ''): string => path.join(repoRoot(), 'agent', 'src', 'prompts', file),
  env: (): string => path.join(repoRoot(), '.env'),
  /** Résout un chemin donné par l'utilisateur : absolu tel quel, sinon relatif à la racine. */
  resolve: (p: string): string => (path.isAbsolute(p) ? p : path.join(repoRoot(), p)),
};
