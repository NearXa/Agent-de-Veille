import ExcelJS from 'exceljs';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeStatut } from '../src/analysis/coverage.js';
import type { StructuredCaller } from '../src/analysis/extract.js';
import {
  attenuationFactor,
  computeResidual,
  defaultOwner,
  levelFor,
} from '../src/analysis/residual.js';
import { runPipeline } from '../src/analysis/run.js';
import { ingestTexte } from '../src/commands/ingest.js';
import { loadRisques } from '../src/config/schemas.js';
import { ZERO_USAGE } from '../src/llm/cost.js';
import { WORKBOOK_FILE } from '../src/matrices/index.js';
import { store } from '../src/store/repository.js';
import type { ControleRecord } from '../src/store/types.js';
import { setRepoRoot } from '../src/utils/paths.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');
const extraction = JSON.parse(
  readFileSync(path.join(here, 'fixtures', 'llm', 'extraction-dora-art5-7.json'), 'utf8'),
) as Record<string, unknown>;

const idsIn = (prompt: string): string[] =>
  Array.from(new Set(prompt.match(/\bEX-\d{4}\b/g) ?? []));

/** Faux LLM couvrant toutes les étapes du pipeline, piloté par le nom du schéma demandé. */
function makeFakeLlm(overrides: { applicable?: 'oui' | 'non' | 'indetermine' } = {}): {
  llm: StructuredCaller;
  calls: string[];
} {
  const calls: string[] = [];
  const llm: StructuredCaller = async (options) => {
    calls.push(options.schemaName);
    const ids = idsIn(options.prompt);
    let output: unknown;
    switch (options.schemaName) {
      case 'ExtractionResult':
        output = { ...extraction, chunk_id: options.label };
        break;
      case 'Applicabilite':
        output = {
          applicable: overrides.applicable ?? 'oui',
          justification:
            'Société de gestion de portefeuille agréée AMF : entité financière visée par le champ d’application.',
          criteres: [
            {
              critere: 'Être une entité financière',
              satisfait: true,
              article_preuve: 'Art. 2 §1',
              extrait: null,
            },
          ],
          confiance: 0.9,
          resume:
            'Le règlement DORA impose aux entités financières un cadre de gestion du risque lié aux TIC, la gestion des incidents, des tests de résilience et la maîtrise des prestataires tiers.',
        };
        break;
      case 'Enrichissement':
        output = {
          exigences: ids.map((id) => ({
            exigence_id: id,
            echeance: {
              date: '2025-01-17',
              type: 'Entrée en application',
              texte_source: 'Art. 64',
            },
            sanction:
              id === ids[0]
                ? {
                    description: 'Sanctions administratives prévues par les États membres',
                    niveau: 'Élevé',
                    article: 'Art. 50',
                  }
                : null,
            destinataires: ['Entités financières'],
            justification: 'Date d’application du règlement.',
          })),
        };
        break;
      case 'ImpactBatch':
        output = {
          exigences: ids.map((id) => ({
            exigence_id: id,
            processus: ['Gestion des risques'],
            systemes: ['Outil ITSM'],
            donnees: [],
            contrats: ['Prestataire SOC externalisé'],
            departements: ["RSSI / Sécurité de l'information"],
            effort_estime: 'Moyen',
            justification: 'Cadre de gestion du risque TIC à formaliser.',
            confiance: 0.8,
          })),
        };
        break;
      case 'CouvertureBatch':
        output = {
          exigences: ids.map((id, i) =>
            i === ids.length - 1
              ? {
                  exigence_id: id,
                  controles: [],
                  statut_global: 'Non couverte',
                  justification: 'Aucun contrôle du catalogue ne traite ce point.',
                }
              : {
                  exigence_id: id,
                  controles: [
                    {
                      controle_id: 'CT-0001',
                      couverture: 'partielle',
                      ecart: 'La PSSI ne couvre pas le risque TIC au sens de DORA.',
                    },
                    { controle_id: 'CT-9999', couverture: 'totale', ecart: null },
                  ],
                  statut_global: 'Partielle',
                  justification: 'Politique en place mais incomplète.',
                },
          ),
        };
        break;
      case 'RisqueBatch':
        output = {
          risques: ids.map((id) => ({
            exigence_id: id,
            intitule: `Non-conformité ${id}`,
            scenario:
              'En cas de contrôle de l’AMF, l’absence de cadre documenté expose à une injonction et à une sanction.',
            categorie: 'Juridique',
            probabilite: 3,
            impact: 3,
            justification_scores: 'Contrôle probable, impact majeur.',
            traitement_propose: 'Réduire',
          })),
        };
        break;
      case 'JurisprudenceRequetes':
        output = {
          exigences: ids.map((id) => ({
            exigence_id: id,
            requetes: [
              'cadre gestion risque informatique',
              'obligation sécurité système information',
              'responsabilité prestataire informatique',
            ],
          })),
        };
        break;
      case 'JurisprudenceMatchBatch': {
        const exigenceId = idsIn(options.prompt)[0]!;
        const decisionIds = Array.from(new Set(options.prompt.match(/\bDEC-\d+\b/g) ?? []));
        output = {
          matches: decisionIds.map((d, i) => ({
            exigence_id: exigenceId,
            decision_id: d,
            pertinence: i === 0 ? 0.8 : 0.2,
            resume: 'Décision pertinente.',
            solution_retenue: 'Rejet du pourvoi.',
            portee: 'Confirme l’obligation de sécurité.',
            justification: 'Même notion.',
          })),
        };
        break;
      }
      default:
        throw new Error(`schéma inattendu : ${options.schemaName}`);
    }
    return {
      output: options.schema.parse(output),
      usage: { ...ZERO_USAGE, inputTokens: 500, outputTokens: 200 },
      costUsd: 0.006,
      cached: false,
      attempts: 1,
      warnings: [],
    };
  };
  return { llm, calls };
}

describe('risque résiduel', () => {
  beforeEach(() => setRepoRoot(realRoot));
  afterEach(() => setRepoRoot(undefined));

  it('applique les facteurs d’atténuation et les niveaux de la grille', () => {
    const grille = loadRisques();
    const fort = { statut: 'En place', efficacite: 'Forte' } as ControleRecord;
    const partiel = { statut: 'Partiel', efficacite: 'Faible' } as ControleRecord;
    expect(attenuationFactor(fort, grille)).toBe(0.5);
    expect(
      attenuationFactor({ statut: 'Absent', efficacite: 'Non évaluée' } as ControleRecord, grille),
    ).toBe(1);
    expect(computeResidual(3, 4, [], grille)).toMatchObject({
      criticite_brute: 12,
      risque_residuel: 12,
      niveau_residuel: 'Critique',
    });
    expect(computeResidual(3, 4, [fort, partiel], grille)).toMatchObject({
      criticite_brute: 12,
      risque_residuel: 6,
      niveau_residuel: 'Modéré',
    });
    expect(computeResidual(1, 1, [fort], grille).risque_residuel).toBe(1);
    expect(levelFor(8, grille)).toBe('Élevé');
    expect(defaultOwner('Cyber')).toBe('RSSI');
  });

  it('normalise le statut de couverture selon l’état réel des contrôles', () => {
    const controles = new Map<string, ControleRecord>([
      ['CT-0001', { statut: 'En place', efficacite: 'Forte' } as ControleRecord],
      ['CT-0002', { statut: 'Planifié', efficacite: 'Non évaluée' } as ControleRecord],
    ]);
    expect(
      normalizeStatut('Couverte', [{ controle_id: 'CT-0001', couverture: 'totale' }], controles),
    ).toBe('Couverte');
    expect(
      normalizeStatut('Couverte', [{ controle_id: 'CT-0002', couverture: 'totale' }], controles),
    ).toBe('Partielle');
    expect(
      normalizeStatut('Couverte', [{ controle_id: 'CT-0001', couverture: 'nulle' }], controles),
    ).toBe('Non couverte');
    expect(normalizeStatut('Partielle', [], controles)).toBe('Non couverte');
  });
});

describe('pipeline complet avec faux LLM', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(async () => {
    tmp = useTmpRoot();
    cpSync(path.join(realRoot, 'config'), path.join(tmp.root, 'config'), { recursive: true });
    cpSync(
      path.join(realRoot, 'agent', 'src', 'prompts'),
      path.join(tmp.root, 'agent', 'src', 'prompts'),
      { recursive: true },
    );
    mkdirSync(path.join(tmp.root, 'data', 'sources', 'jurisprudence'), { recursive: true });
    cpSync(
      path.join(here, 'fixtures', 'dora-art5-7.html'),
      path.join(tmp.root, 'data', 'sources', 'dora.html'),
    );
    writeFileSync(
      path.join(tmp.root, 'data', 'sources', 'jurisprudence', 'corpus-test.json'),
      JSON.stringify([
        {
          id: 'DEC-1',
          juridiction: 'Cour de cassation',
          numero: '21-10.001',
          date: '2023-05-04',
          url: 'https://www.courdecassation.fr/decision/DEC-1',
          resume:
            'Obligation de sécurité du système d’information et cadre de gestion du risque informatique.',
          mots_cles: ['sécurité'],
        },
        {
          id: 'DEC-2',
          juridiction: 'Cour d’appel',
          numero: '22-00.002',
          date: '2024-01-10',
          url: 'https://www.courdecassation.fr/decision/DEC-2',
          resume: 'Responsabilité du prestataire informatique en cas de défaillance.',
        },
      ]),
      'utf8',
    );
    await ingestTexte({
      file: 'data/sources/dora.html',
      source: 'eurlex',
      ref: 'CELEX:32022R2554',
      url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
    });
  });
  afterEach(() => tmp.cleanup());

  it('enchaîne les huit étapes, alimente le store et produit M1 à M5 en CSV, MD et XLSX', async () => {
    const { llm, calls } = makeFakeLlm();
    const summary = await runPipeline({ texteId: 'TX-0001', articles: '5-7', llm });
    expect(summary.arret).toBeNull();
    expect(summary.steps.map((s) => `${s.step}:${s.statut}`)).toEqual([
      'applicability:ok',
      'extract:ok',
      'enrich:ok',
      'jurisprudence:ok',
      'impact:ok',
      'coverage:ok',
      'risks:ok',
      'matrices:ok',
    ]);
    expect(calls.filter((c) => c === 'ExtractionResult')).toHaveLength(1);

    const texte = store.textes.findById('TX-0001')!;
    expect(texte.applicable).toBe('Oui');
    expect(texte.resume).toMatch(/DORA/);
    expect(texte.confiance_applicabilite).toBe(0.9);

    const exigences = store.exigences.readAll();
    expect(exigences).toHaveLength(4);
    expect(exigences.every((e) => e.echeance?.date === '2025-01-17')).toBe(true);
    expect(exigences.filter((e) => e.sanction).length).toBeGreaterThanOrEqual(1);
    expect(
      exigences.every(
        (e) => e.processus_impactes.includes('Gestion des risques') && e.effort_estime === 'Moyen',
      ),
    ).toBe(true);
    expect(exigences.filter((e) => e.couverture === 'Partielle')).toHaveLength(3);
    expect(exigences.filter((e) => e.couverture === 'Non couverte')).toHaveLength(1);
    const partielle = exigences.find((e) => e.couverture === 'Partielle')!;
    expect(partielle.controles_ids).toEqual(['CT-0001']);
    expect(partielle.couverture_detail[0]?.ecart).toMatch(/PSSI/);

    const controles = store.controles.readAll();
    expect(controles).toHaveLength(38);
    expect(controles.find((c) => c.id === 'CT-0001')?.exigences_ids).toHaveLength(3);
    expect(controles.find((c) => c.id === 'CT-0001')?.ecart_constate).toMatch(/PSSI/);

    const risques = store.risques.readAll();
    expect(risques).toHaveLength(4);
    expect(risques.map((r) => r.id)).toEqual(['RK-0001', 'RK-0002', 'RK-0003', 'RK-0004']);
    const avecControle = risques.find((r) => r.controles_attenuants.includes('CT-0001'))!;
    expect(avecControle).toMatchObject({
      criticite_brute: 9,
      risque_residuel: 7,
      niveau_residuel: 'Élevé',
      proprietaire: 'Juridique',
      traitement: 'Réduire',
    });
    const sansControle = risques.find((r) => r.controles_attenuants.length === 0)!;
    expect(sansControle).toMatchObject({ risque_residuel: 9, niveau_residuel: 'Élevé' });
    expect(store.exigences.findById(avecControle.exigence_id)?.risques_ids).toEqual([
      avecControle.id,
    ]);

    const jurisprudence = store.jurisprudence.readAll();
    expect(jurisprudence).toHaveLength(1);
    expect(jurisprudence[0]).toMatchObject({
      id: 'JP-0001',
      source_id: 'DEC-1',
      pertinence: 0.8,
      source: 'local-file',
      juridiction: 'Cour de cassation',
    });
    expect(jurisprudence[0]?.exigences_ids.length).toBeGreaterThanOrEqual(1);

    const matricesDir = path.join(tmp.root, 'output', 'matrices');
    for (const slug of [
      'M1-tracabilite',
      'M2-impact',
      'M3-couverture',
      'M4-risque',
      'M5-jurisprudence',
    ]) {
      expect(readFileSync(path.join(matricesDir, `${slug}.csv`), 'utf8')).toContain('# Run :');
      expect(readFileSync(path.join(matricesDir, `${slug}.md`), 'utf8')).toContain('| ---');
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(matricesDir, WORKBOOK_FILE));
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'M1 Traçabilité',
      'M2 Impact',
      'M3 Couverture',
      'M4 Risque',
      'M5 Jurisprudence',
    ]);
    const m4 = workbook.getWorksheet('M4 Risque')!;
    expect(m4.getRow(1).getCell(1).value).toBe('ID risque');
    expect(m4.getRow(2).getCell(1).value).toBe('RK-0001');
    expect(m4.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    const m3 = readFileSync(path.join(matricesDir, 'M3-couverture.csv'), 'utf8');
    expect(m3).toContain('CT-0001 A.5.1 (En place) : partielle');
    const m5 = readFileSync(path.join(matricesDir, 'M5-jurisprudence.csv'), 'utf8');
    expect(m5).toContain('JP-0001');
    expect(m5).toContain('https://www.courdecassation.fr/decision/DEC-1');
  });

  it('s’arrête après l’applicabilité quand le texte n’est pas applicable, sauf --force', async () => {
    const { llm, calls } = makeFakeLlm({ applicable: 'non' });
    const stopped = await runPipeline({
      texteId: 'TX-0001',
      articles: '5-7',
      llm,
      steps: ['applicability', 'extract'],
    });
    expect(stopped.arret).toMatch(/pipeline arrêté/);
    expect(stopped.steps).toHaveLength(1);
    expect(calls).toEqual(['Applicabilite']);
    expect(store.textes.findById('TX-0001')?.applicable).toBe('Non');
    const forced = await runPipeline({
      texteId: 'TX-0001',
      articles: '5-7',
      llm,
      force: true,
      steps: ['applicability', 'extract'],
    });
    expect(forced.arret).toBeNull();
    expect(forced.steps).toHaveLength(2);
  });
});
