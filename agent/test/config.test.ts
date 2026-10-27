import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAllConfig } from '../src/config/schemas.js';
import { setRepoRoot } from '../src/utils/paths.js';

const realRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('config/*.yaml', () => {
  beforeAll(() => setRepoRoot(realRoot));
  afterAll(() => setRepoRoot(undefined));

  it('charge et valide les quatre fichiers de configuration', () => {
    const cfg = loadAllConfig();
    expect(cfg.organisation.organisation.nom).toBe("Aurelia Gestion d'Actifs");
    expect(cfg.organisation.processus.length).toBeGreaterThan(5);
    expect(cfg.controles.controles.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cfg.controles.controles.map((c) => c.id)).size).toBe(
      cfg.controles.controles.length,
    );
    expect(cfg.risques.niveaux.map((n) => n.nom)).toEqual([
      'Faible',
      'Modéré',
      'Élevé',
      'Critique',
    ]);
    expect(cfg.sources.sources.find((s) => s.id === 'local-file')?.enabled).toBe(true);
    expect(cfg.sources.sources.filter((s) => s.enabled).map((s) => s.id)).toEqual([
      'local-file',
      'eurlex',
      'assemblee-nationale',
      'senat',
      'cnil',
      'anssi',
    ]);
    expect(cfg.sources.sources.filter((s) => !s.enabled).map((s) => s.id)).toEqual([
      'legifrance',
      'judilibre',
    ]);
    expect(cfg.sources.defaults.max_par_passage).toBe(20);
  });
});
