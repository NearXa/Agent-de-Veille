import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRepoRoot } from '../../src/utils/paths.js';

/** Crée une racine de dépôt temporaire pour isoler le store et le cache pendant un test. */
export function useTmpRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'veille-grc-'));
  setRepoRoot(root);
  return {
    root,
    cleanup: () => {
      setRepoRoot(undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
