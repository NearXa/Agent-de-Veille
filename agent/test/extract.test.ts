import { mergeWithEnrichment } from '../src/analysis/extract.js';
import type { ExigenceRecord } from '../src/store/types.js';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChunks, selectArticles } from '../src/analysis/chunking.js';
import { computeConfidence, confidenceLevel } from '../src/analysis/confidence.js';
import {
  extractExigences,
  findSimilarExisting,
  titleSimilarity,
  type StructuredCaller,
} from '../src/analysis/extract.js';
import { parseArticleNumber, verifyArticles, verifyVerbatim } from '../src/analysis/verify.js';
import { ingestTexte } from '../src/commands/ingest.js';
import { ZERO_USAGE } from '../src/llm/cost.js';
import { loadPrompt, renderPrompt } from '../src/prompts/loader.js';
import { store } from '../src/store/repository.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');
const fixtureLlm = JSON.parse(
  readFileSync(path.join(here, 'fixtures', 'llm', 'extraction-dora-art5-7.json'), 'utf8'),
) as Record<string, unknown>;

/** Faux appel LLM : rejoue la fixture après l'avoir validée avec le schéma demandé. */
const calls: string[] = [];
const fakeLlm: StructuredCaller = async (options) => {
  calls.push(options.label ?? options.schemaName);
  const output = options.schema.parse({ ...fixtureLlm, chunk_id: options.label });
  return {
    output,
    usage: { ...ZERO_USAGE, inputTokens: 1200, outputTokens: 400 },
    costUsd: 0.0128,
    cached: false,
    attempts: 1,
    warnings: [],
  };
};

describe('vérification des articles et du verbatim', () => {
  const articles = [
    {
      numero: '5',
      titre: 'A',
      contenu: 'Les entités financières disposent d’un cadre de gouvernance.',
      ancre: '#art_5',
      type: 'article' as const,
      position: 0,
    },
    {
      numero: '6',
      titre: 'B',
      contenu: 'Le cadre est documenté et réexaminé au moins une fois par an.',
      ancre: '#art_6',
      type: 'article' as const,
      position: 1,
    },
  ];

  it('parse les références d’articles', () => {
    expect(parseArticleNumber('Art. 6 §1')).toBe('6');
    expect(parseArticleNumber('Article 9, paragraphe 4, point c)')).toBe('9');
    expect(parseArticleNumber('art 5bis')).toBe('5bis');
    expect(parseArticleNumber('considérant 12')).toBeNull();
  });

  it('vérifie l’existence des articles cités', () => {
    expect(verifyArticles(['Art. 5 §1', 'Art. 6'], articles)).toEqual({
      ok: true,
      numeros: ['5', '6'],
      manquants: [],
    });
    expect(verifyArticles(['Art. 42'], articles)).toEqual({
      ok: false,
      numeros: [],
      manquants: ['Art. 42'],
    });
  });

  it('retrouve le verbatim dans les articles cités ou ailleurs', () => {
    expect(verifyVerbatim("disposent d'un cadre de gouvernance", articles, ['5'])).toEqual({
      ok: true,
      dans_articles_cites: true,
    });
    expect(verifyVerbatim('réexaminé au moins une fois par an', articles, ['5'])).toEqual({
      ok: true,
      dans_articles_cites: false,
    });
    expect(verifyVerbatim('phrase absente du texte', articles, ['5'])).toEqual({
      ok: false,
      dans_articles_cites: false,
    });
  });

  it('calcule la confiance selon la formule documentée', () => {
    expect(computeConfidence({ llm: 0.9, verbatim_retrouve: 1, article_existe: 1 })).toBe(0.95);
    expect(computeConfidence({ llm: 0.6, verbatim_retrouve: 0, article_existe: 0 })).toBe(0.3);
    expect(confidenceLevel(0.95)).toBe('vert');
    expect(confidenceLevel(0.7)).toBe('orange');
    expect(confidenceLevel(0.3)).toBe('rouge');
  });
});

describe('chunking', () => {
  const articles = Array.from({ length: 6 }, (_, i) => ({
    numero: String(i + 1),
    titre: `Titre ${i + 1}`,
    contenu: 'mot '.repeat(700),
    ancre: `#art_${i + 1}`,
    type: 'article' as const,
    position: i,
  }));

  it('sélectionne une plage d’articles', () => {
    expect(selectArticles(articles, '2-4').map((a) => a.numero)).toEqual(['2', '3', '4']);
    expect(selectArticles(articles, '1,5-6').map((a) => a.numero)).toEqual(['1', '5', '6']);
    expect(selectArticles(articles).length).toBe(6);
    expect(() => selectArticles(articles, '40-50')).toThrow(/Aucun article/);
    expect(() => selectArticles(articles, 'abc')).toThrow(/invalide/);
  });

  it('découpe en chunks équilibrés sans couper un article', () => {
    const chunks = buildChunks(articles, { texteId: 'TX-0001', maxTokens: 2000 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.articles.map((a) => a.numero))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(chunks[0]?.id).toMatch(/^TX-0001-chunk-01-art1-\d$/);
    for (const chunk of chunks) expect(chunk.tokens_estimes).toBeLessThanOrEqual(2200);
    expect(buildChunks(articles, { texteId: 'TX-0001' })).toHaveLength(1);
  });
});

describe('prompt d’extraction', () => {
  it('se charge avec version et sections, et rend les variables', () => {
    const prompt = loadPrompt('extraction');
    expect(prompt.version).toBe('1.0.0');
    expect(prompt.instructions).toContain('DONNÉE');
    expect(renderPrompt('Texte {{a}} et {{ b }}', { a: '1', b: '2' })).toBe('Texte 1 et 2');
    expect(() => renderPrompt('{{manquante}}', {})).toThrow(/manquante/);
  });
});

describe('fusion par similarité', () => {
  it('mesure la similarité de titres et retrouve une exigence existante', () => {
    expect(
      titleSimilarity(
        'Mettre en place un cadre de gestion du risque',
        'Mettre en place un cadre de gestion des risques',
      ),
    ).toBeGreaterThan(0.7);
    expect(titleSimilarity('Notifier les incidents majeurs', 'Tester la continuité')).toBeLessThan(
      0.3,
    );
    const existing = [
      {
        id: 'EX-0003',
        texte_id: 'TX-0001',
        titre: 'Disposer d’un cadre de gestion du risque lié aux TIC',
        articles: ['Art. 6 §1'],
      },
    ] as unknown as Parameters<typeof findSimilarExisting>[0];
    expect(
      findSimilarExisting(
        existing,
        'TX-0001',
        ['Art. 6, §1'],
        'Disposer d’un cadre de gestion du risque TIC',
      )?.id,
    ).toBe('EX-0003');
    expect(
      findSimilarExisting(
        existing,
        'TX-0001',
        ['Art. 7'],
        'Disposer d’un cadre de gestion du risque TIC',
      ),
    ).toBeUndefined();
  });
});

describe('extractExigences (replay)', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(async () => {
    tmp = useTmpRoot();
    mkdirSync(path.join(tmp.root, 'data', 'sources'), { recursive: true });
    mkdirSync(path.join(tmp.root, 'agent', 'src'), { recursive: true });
    cpSync(path.join(realRoot, 'config'), path.join(tmp.root, 'config'), { recursive: true });
    cpSync(
      path.join(realRoot, 'agent', 'src', 'prompts'),
      path.join(tmp.root, 'agent', 'src', 'prompts'),
      { recursive: true },
    );
    cpSync(
      path.join(here, 'fixtures', 'dora-art5-7.html'),
      path.join(tmp.root, 'data', 'sources', 'dora.html'),
    );
    calls.length = 0;
    await ingestTexte({
      file: 'data/sources/dora.html',
      source: 'eurlex',
      ref: 'CELEX:32022R2554',
      url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
    });
  });
  afterEach(() => tmp.cleanup());

  it('dry-run : chunks sans appel au modèle', async () => {
    const summary = await extractExigences({
      texteId: 'TX-0001',
      articles: '5-6',
      dryRun: true,
      llm: fakeLlm,
    });
    expect(summary.dry_run).toBe(true);
    expect(summary.chunks).toHaveLength(1);
    expect(summary.chunks[0]?.articles).toEqual(['5', '6']);
    expect(calls).toHaveLength(0);
    expect(store.exigences.readAll()).toHaveLength(0);
  });

  it('extrait, vérifie, fusionne et attribue des IDs stables sur deux runs', async () => {
    const first = await extractExigences({ texteId: 'TX-0001', articles: '5-7', llm: fakeLlm });
    expect(calls).toEqual(['TX-0001-chunk-01-art5-7']);
    expect(first.exigences_total).toBe(4);
    expect(first.exigences_nouvelles).toBe(4);
    expect(first.exigences_fusionnees).toBe(1);
    expect(first.verifiees).toBe(3);
    expect(first.non_verifiees).toBe(1);
    expect(first.cost_usd).toBeCloseTo(0.0128, 6);

    const records = store.exigences.readAll();
    expect(records.map((r) => r.id)).toEqual(['EX-0001', 'EX-0002', 'EX-0003', 'EX-0004']);
    const cadre = records.find((r) => r.articles.includes('Art. 6 §1'))!;
    expect(cadre.verifie_dans_source).toBe(true);
    expect(cadre.confiance).toBe(0.98);
    expect(cadre.confiance_detail).toEqual({ llm: 0.95, verbatim_retrouve: 1, article_existe: 1 });
    expect(cadre.url_article).toBe(
      'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6',
    );
    expect(cadre.statut_validation).toBe('À valider');

    const faux = records.find((r) => r.articles.includes('Art. 42 §1'))!;
    expect(faux.verifie_dans_source).toBe(false);
    expect(faux.confiance).toBe(0.3);
    expect(faux.echeance?.date).toBeNull();
    expect(faux.avertissements.join(' ')).toMatch(/Art\. 42/);
    expect(faux.avertissements.join(' ')).toMatch(/verbatim non retrouvé/);
    expect(faux.avertissements.join(' ')).toMatch(/non ISO/);

    const second = await extractExigences({ texteId: 'TX-0001', articles: '5-7', llm: fakeLlm });
    expect(second.exigences_nouvelles).toBe(0);
    expect(second.exigences_mises_a_jour).toBe(4);
    expect(store.exigences.readAll().map((r) => r.id)).toEqual([
      'EX-0001',
      'EX-0002',
      'EX-0003',
      'EX-0004',
    ]);
  });

  it('préserve les décisions humaines existantes', async () => {
    await extractExigences({ texteId: 'TX-0001', articles: '5-7', llm: fakeLlm });
    const records = store.exigences.readAll();
    const cadre = records.find((r) => r.articles.includes('Art. 6 §1'))!;
    store.exigences.upsert({
      ...cadre,
      statut_validation: 'Corrigée',
      validateur: 'N. Kaci',
      date_validation: '2026-10-27T16:01:00.000Z',
      commentaire_validation: 'titre reformulé',
      version_corrigee: { titre: 'Cadre de gestion du risque TIC (corrigé)' },
    });
    await extractExigences({ texteId: 'TX-0001', articles: '5-7', llm: fakeLlm });
    const after = store.exigences.findById(cadre.id)!;
    expect(after.statut_validation).toBe('Corrigée');
    expect(after.validateur).toBe('N. Kaci');
    expect(after.titre).toBe('Cadre de gestion du risque TIC (corrigé)');
  });
});

describe('mergeWithEnrichment', () => {
  it('garde l’enrichissement quand l’extraction ne renseigne rien, et laisse primer une valeur extraite', () => {
    const existing = {
      echeance: { date: '2025-01-17', type: 'Entrée en application', texte_source: 'Art. 64' },
      sanction: { description: 'Amende administrative', niveau: 'Élevé', article: 'Art. 50' },
      destinataires: ['Entités financières', 'Microentreprises'],
    } as unknown as ExigenceRecord;
    expect(
      mergeWithEnrichment(
        { echeance: null, sanction: null, destinataires: ['Entités financières'] },
        existing,
      ),
    ).toEqual({
      echeance: existing.echeance,
      sanction: existing.sanction,
      destinataires: ['Entités financières', 'Microentreprises'],
    });
    const datee = { date: '2026-06-30', type: 'Périodique', texte_source: 'Art. 6 §5' } as const;
    expect(
      mergeWithEnrichment({ echeance: datee, sanction: null, destinataires: [] }, existing)
        .echeance,
    ).toEqual(datee);
    const nonDatee = { date: null, type: 'Périodique', texte_source: null } as const;
    expect(
      mergeWithEnrichment({ echeance: nonDatee, sanction: null, destinataires: [] }, undefined)
        .echeance,
    ).toEqual(nonDatee);
  });
});
