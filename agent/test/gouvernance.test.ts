import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLots, recommendGovernance, responsableFor } from '../src/analysis/governance.js';
import type { StructuredCaller } from '../src/analysis/extract.js';
import { loadEnv } from '../src/config/env.js';
import {
  buildPlanMarkdown,
  computeKpis,
  dependenciesFor,
  raciFor,
  readRecommandation,
  writeGovernancePlan,
} from '../src/governance/plan.js';
import { ZERO_USAGE } from '../src/llm/cost.js';
import { NotionGateway } from '../src/notion/client.js';
import { readPagesMap } from '../src/notion/ids.js';
import { initNotion } from '../src/notion/init.js';
import { pullFromNotion } from '../src/notion/pull.js';
import { pushToNotion } from '../src/notion/push.js';
import { P } from '../src/notion/schema.js';
import { IdRegistry } from '../src/store/ids.js';
import { store } from '../src/store/repository.js';
import type { ExigenceRecord, LotRecord, RisqueRecord, TexteRecord } from '../src/store/types.js';
import { readText } from '../src/utils/fs.js';
import { logger } from '../src/utils/logger.js';
import { FakeNotion } from './helpers/fake-notion.js';
import { useTmpRoot } from './helpers/tmp-root.js';
import { cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');

const texte: TexteRecord = {
  id: 'TX-0001',
  source: 'eurlex',
  reference: 'CELEX:32022R2554',
  titre: 'Règlement DORA',
  type: 'Règlement UE',
  url_officielle: 'https://eur-lex.europa.eu/x',
  urls_connues: [],
  date_publication: null,
  date_entree_en_vigueur: null,
  date_entree_en_application: '2025-01-17',
  statut_texte: 'En vigueur',
  hash_sha256: 'e'.repeat(64),
  collecte_le: '2026-10-01T10:00:00.000Z',
  derniere_modification_detectee: null,
  fichier_source: null,
  applicable: 'Oui',
  justification_applicabilite: null,
  confiance_applicabilite: 0.9,
  resume: null,
  nombre_articles: 0,
  articles: [],
  run_id: 'RUN-20261027-1601',
  version: 1,
  historique: [],
};

function exigence(id: string, extra: Partial<ExigenceRecord>): ExigenceRecord {
  return {
    id,
    texte_id: 'TX-0001',
    titre: `Exigence ${id}`,
    description: 'Description',
    articles: ['Art. 6 §1'],
    extrait_verbatim: 'x',
    url_article: null,
    verifie_dans_source: true,
    type_obligation: 'Gouvernance',
    destinataires: [],
    echeance: { date: '2026-12-31', type: 'Entrée en application', texte_source: null },
    sanction: null,
    confiance: 0.9,
    confiance_detail: { llm: 0.8, verbatim_retrouve: 1, article_existe: 1 },
    justification_confiance: null,
    statut_validation: 'À valider',
    validateur: null,
    date_validation: null,
    commentaire_validation: null,
    version_corrigee: null,
    processus_impactes: [],
    systemes_impactes: [],
    donnees_concernees: [],
    contrats_concernes: [],
    departements_impactes: [],
    effort_estime: 'Moyen',
    impact_justification: null,
    couverture: 'Partielle',
    couverture_detail: [],
    couverture_justification: null,
    lot_propose: null,
    controles_ids: [],
    risques_ids: [],
    jurisprudence_ids: [],
    lots_ids: [],
    run_id: 'RUN-20261027-1601',
    chunk_id: null,
    avertissements: [],
    revalidation_motif: null,
    ...extra,
  };
}

const risque = (
  id: string,
  exigenceId: string,
  niveau: RisqueRecord['niveau_residuel'],
): RisqueRecord => ({
  id,
  exigence_id: exigenceId,
  intitule: 'Risque',
  scenario: 'Scénario',
  categorie: 'Cyber',
  probabilite: 3,
  impact: 3,
  criticite_brute: 9,
  justification_scores: null,
  controles_attenuants: [],
  risque_residuel: niveau === 'Critique' ? 12 : 5,
  niveau_residuel: niveau,
  traitement: 'Réduire',
  proprietaire: 'RSSI',
  statut: 'Identifié',
  lots_ids: [],
  run_id: 'RUN-20261027-1601',
});

describe('lots d’action et plan', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
    cpSync(path.join(realRoot, 'config'), path.join(tmp.root, 'config'), { recursive: true });
    cpSync(
      path.join(realRoot, 'agent', 'src', 'prompts'),
      path.join(tmp.root, 'agent', 'src', 'prompts'),
      { recursive: true },
    );
  });
  afterEach(() => tmp.cleanup());

  it('regroupe les exigences non couvertes par cadre et phase, priorise selon le risque, choisit le responsable', () => {
    const exigences = [
      exigence('EX-0001', { couverture: 'Non couverte', effort_estime: 'Élevé' }),
      exigence('EX-0002', {
        couverture: 'Partielle',
        echeance: { date: '2026-06-30', type: 'Périodique', texte_source: null },
      }),
      exigence('EX-0003', { couverture: 'Couverte' }),
      exigence('EX-0004', { couverture: 'Partielle' }),
    ];
    const risques = [
      risque('RK-0001', 'EX-0001', 'Critique'),
      risque('RK-0002', 'EX-0004', 'Modéré'),
    ];
    const mapping = [
      {
        exigence_id: 'EX-0001',
        cadre: 'TOGAF' as const,
        phase_ou_pratique: 'TOGAF Phase B (Business Architecture)',
        livrable: 'Architecture Definition Document',
      },
      {
        exigence_id: 'EX-0002',
        cadre: 'TOGAF' as const,
        phase_ou_pratique: 'TOGAF Phase B (Business Architecture)',
        livrable: 'Architecture Requirements Specification',
      },
      {
        exigence_id: 'EX-0003',
        cadre: 'ITIL' as const,
        phase_ou_pratique: 'ITIL Incident Management',
        livrable: 'Procédure',
      },
      {
        exigence_id: 'EX-0004',
        cadre: 'ITIL' as const,
        phase_ou_pratique: 'ITIL Incident Management',
        livrable: 'Procédure de notification',
      },
    ];
    const lots = buildLots(mapping, exigences, risques, 'RUN-TEST', IdRegistry.load(), new Map());
    expect(lots.map((l) => `${l.id} ${l.priorite} ${l.cadre_gouvernance}`)).toEqual([
      'LA-0001 P1 TOGAF',
      'LA-0002 P3 ITIL',
    ]);
    expect(lots[0]).toMatchObject({
      exigences_ids: ['EX-0001', 'EX-0002'],
      risques_ids: ['RK-0001'],
      responsable: 'Direction',
      echeance_cible: '2026-06-30',
      effort: 'Élevé',
    });
    expect(lots[0]?.livrable_attendu).toContain('Architecture Definition Document');
    expect(lots[1]).toMatchObject({
      exigences_ids: ['EX-0004'],
      responsable: 'RSSI',
      effort: 'Moyen',
    });
    expect(responsableFor('ITIL', 'ITIL Supplier Management')).toBe('Conformité');
    expect(responsableFor('TOGAF', 'TOGAF Phase D (Technology Architecture)')).toBe('DSI');
  });

  it('calcule RACI, dépendances et indicateurs, et rend le plan Markdown', () => {
    const lotA: LotRecord = {
      id: 'LA-0001',
      titre: 'A',
      description: '',
      exigences_ids: ['EX-0001'],
      risques_ids: [],
      priorite: 'P1',
      responsable: 'Direction',
      echeance_cible: '2026-12-31',
      statut: 'À planifier',
      cadre_gouvernance: 'TOGAF',
      phase_ou_pratique: 'TOGAF Phase A (Architecture Vision)',
      livrable_attendu: 'Vision',
      effort: 'Moyen',
      run_id: 'RUN-TEST',
    };
    const lotC: LotRecord = {
      ...lotA,
      id: 'LA-0002',
      priorite: 'P2',
      responsable: 'DSI',
      phase_ou_pratique: 'TOGAF Phase C (Information Systems Architectures)',
    };
    const lotI: LotRecord = {
      ...lotA,
      id: 'LA-0003',
      priorite: 'P3',
      responsable: 'RSSI',
      cadre_gouvernance: 'ITIL',
      phase_ou_pratique: 'ITIL Incident Management',
    };
    expect(raciFor(lotA)).toMatchObject({
      Direction: 'R',
      DSI: 'A',
      Conformité: 'C',
      Juridique: 'C',
    });
    expect(raciFor(lotI)).toMatchObject({ RSSI: 'R', DSI: 'A' });
    expect(dependenciesFor(lotC, [lotA, lotC, lotI])).toEqual(['LA-0001']);
    expect(dependenciesFor(lotI, [lotA, lotC, lotI])).toEqual(['LA-0001']);
    const now = new Date('2026-10-27T12:00:00.000Z');
    const exigences = [
      exigence('EX-0001', {
        statut_validation: 'Validée',
        echeance: { date: '2026-11-30', type: 'Périodique', texte_source: null },
      }),
      exigence('EX-0002', {
        couverture: 'Couverte',
        echeance: { date: '2025-01-17', type: 'Entrée en application', texte_source: null },
      }),
    ];
    const kpis = computeKpis(
      exigences,
      [risque('RK-0001', 'EX-0001', 'Élevé')],
      [lotA],
      [
        {
          id: 'VAL-1',
          exigence_id: 'EX-0001',
          action: 'Validée',
          validateur: 'N',
          date: '2026-10-11T10:00:00.000Z',
          commentaire: null,
          champs_modifies: null,
          source: 'notion',
        },
      ],
      [texte],
      now,
    );
    expect(kpis).toMatchObject({
      exigences: 2,
      validees: 1,
      pct_validees: 50,
      pct_couverture: 75,
      echeances_90j: 1,
      echeances_depassees: 1,
      delai_moyen_validation_jours: 10,
      risques_par_niveau: { Élevé: 1 },
      lots_par_statut: { 'À planifier': 1 },
    });
    const plan = buildPlanMarkdown({
      texte,
      exigences,
      lots: [lotA, lotC, lotI],
      risques: [],
      controles: [],
      validations: [],
      decision: {
        cadre: 'Hybride',
        auteur: 'N. Kaci',
        date: '2026-10-27T18:00:00.000Z',
        commentaire: 'ok',
        texte_id: 'TX-0001',
        recommandation_run_id: 'RUN-TEST',
      },
      recommandation: {
        texte_id: 'TX-0001',
        run_id: 'RUN-TEST',
        genere_le: now.toISOString(),
        repartition: { TOGAF: 2, ITIL: 1 },
        lots: ['LA-0001'],
        cadre_recommande: 'Hybride',
        score_togaf: 60,
        score_itil: 55,
        criteres: [{ critere: 'Nature des obligations', poids: 8, evaluation: 'Mixte' }],
        justification: 'Justification suffisamment longue pour le schéma de la recommandation.',
        mapping: [
          {
            exigence_id: 'EX-0001',
            cadre: 'TOGAF',
            phase_ou_pratique: 'TOGAF Phase A (Architecture Vision)',
            livrable: 'Vision',
          },
        ],
        alternatives: 'TOGAF seul',
        points_de_decision_humaine: ['Budget'],
      },
      now,
    });
    expect(plan).toContain('# Plan de gouvernance : Règlement DORA');
    expect(plan).toContain('**Cadre recommandé : Hybride**');
    expect(plan).toContain('**Cadre retenu : Hybride** par N. Kaci');
    expect(plan).toContain('| LA-0001 | P1 | TOGAF |');
    expect(plan).toContain('| LA-0002 | I | R | C | C | I | A |');
    expect(plan).toContain('- Budget');
  });

  it('recommande un cadre via le faux LLM, crée les lots, écrit recommandation.json et le plan', async () => {
    store.textes.writeAll([texte]);
    store.exigences.writeAll([
      exigence('EX-0001', { couverture: 'Non couverte' }),
      exigence('EX-0002', { couverture: 'Partielle' }),
    ]);
    store.risques.writeAll([risque('RK-0001', 'EX-0001', 'Élevé')]);
    const llm: StructuredCaller = async (options) => {
      const ids = Array.from(new Set(options.prompt.match(/\bEX-\d{4}\b/g) ?? []));
      const output = options.schema.parse({
        cadre_recommande: 'Hybride',
        score_togaf: 55,
        score_itil: 60,
        criteres: [
          { critere: 'Nature', poids: 8, evaluation: 'a' },
          { critere: 'Maturité', poids: 6, evaluation: 'b' },
          { critere: 'Risques', poids: 7, evaluation: 'c' },
        ],
        justification:
          'Les obligations se répartissent entre transformation et exploitation, d’où une approche hybride.',
        mapping: ids.map((id, i) => ({
          exigence_id: id,
          cadre: i === 0 ? 'TOGAF' : 'ITIL',
          phase_ou_pratique:
            i === 0
              ? 'TOGAF Phase B (Business Architecture)'
              : 'ITIL Information Security Management',
          livrable: 'Livrable',
        })),
        alternatives: 'TOGAF seul ou ITIL seul.',
        points_de_decision_humaine: ['Arbitrage budgétaire'],
      });
      return {
        output,
        usage: { ...ZERO_USAGE, inputTokens: 100, outputTokens: 50 },
        costUsd: 0.001,
        cached: false,
        attempts: 1,
        warnings: [],
      };
    };
    const result = await recommendGovernance({ texteId: 'TX-0001', llm });
    expect(result.recommandation.cadre_recommande).toBe('Hybride');
    expect(result.lots.map((l) => `${l.id}:${l.cadre_gouvernance}`)).toEqual([
      'LA-0001:TOGAF',
      'LA-0002:ITIL',
    ]);
    expect(store.exigences.findById('EX-0001')?.lots_ids).toEqual(['LA-0001']);
    expect(store.exigences.findById('EX-0001')?.lot_propose).toBe('LA-0001');
    expect(store.risques.readAll()[0]?.lots_ids).toEqual(['LA-0001']);
    expect(readRecommandation()?.repartition).toEqual({ TOGAF: 1, ITIL: 1 });
    const plan = writeGovernancePlan('TX-0001');
    expect(readText(plan.output)).toContain('| LA-0001 | P2 | TOGAF |');
    expect(readText(plan.docs)).toContain('_En attente de décision');
  });

  it('pousse les lots dans Notion sans écraser statut, cadre et responsable, et les rapatrie', async () => {
    process.env.NOTION_TOKEN = 'secret_test';
    process.env.NOTION_PARENT_PAGE_ID = 'page-parent';
    loadEnv({ reload: true });
    try {
      const fake = new FakeNotion('page-parent');
      const gateway = new NotionGateway(
        { token: 'x', parentPageId: 'page-parent', apiVersion: '2025-09-03' },
        { client: fake.client, minIntervalMs: 0, log: logger },
      );
      store.textes.writeAll([texte]);
      store.exigences.writeAll([
        exigence('EX-0001', { couverture: 'Non couverte', lots_ids: ['LA-0001'] }),
      ]);
      store.risques.writeAll([risque('RK-0001', 'EX-0001', 'Élevé')]);
      const lot: LotRecord = {
        id: 'LA-0001',
        titre: 'Lot',
        description: 'd',
        exigences_ids: ['EX-0001'],
        risques_ids: ['RK-0001'],
        priorite: 'P2',
        responsable: 'DSI',
        echeance_cible: '2026-12-31',
        statut: 'À planifier',
        cadre_gouvernance: 'TOGAF',
        phase_ou_pratique: 'TOGAF Phase B (Business Architecture)',
        livrable_attendu: 'ADD',
        effort: 'Moyen',
        run_id: 'RUN-TEST',
      };
      store.lots.writeAll([lot]);
      await initNotion({ gateway, log: logger });
      const first = await pushToNotion({ gateway, log: logger });
      expect(first.lots).toEqual({ created: 1, updated: 0 });
      expect(first.risques).toEqual({ created: 1, updated: 0 });
      expect(first.relations).toBeGreaterThanOrEqual(2);
      const map = readPagesMap();
      const page = fake.pages.get(map['LA-0001']!)!;
      expect(page.properties[P.lots.cadre]).toEqual({ select: { name: 'TOGAF' } });
      const exigencePage = fake.pages.get(map['EX-0001']!)!;
      expect(exigencePage.properties[P.exigences.lots]).toEqual({
        relation: [{ id: map['LA-0001'] }],
      });

      page.properties[P.lots.statut] = { select: { name: 'En cours' } };
      page.properties[P.lots.cadre] = { select: { name: 'Hybride' } };
      page.properties[P.lots.id] = { title: [{ plain_text: 'LA-0001' }] };
      exigencePage.properties[P.exigences.id] = { title: [{ plain_text: 'EX-0001' }] };
      const second = await pushToNotion({ gateway, log: logger, only: ['lots'] });
      expect(second.lots).toEqual({ created: 0, updated: 1 });
      expect(page.properties[P.lots.statut]).toEqual({ select: { name: 'En cours' } });
      expect(page.properties[P.lots.cadre]).toEqual({ select: { name: 'Hybride' } });
      const pull = await pullFromNotion({ gateway, log: logger });
      expect(pull.lots_mis_a_jour).toBe(1);
      expect(store.lots.findById('LA-0001')).toMatchObject({
        statut: 'En cours',
        cadre_gouvernance: 'Hybride',
      });
    } finally {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_PARENT_PAGE_ID;
      loadEnv({ reload: true });
    }
  });
});
