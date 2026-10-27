import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionGateway } from '../src/notion/client.js';
import { readNotionIds, readPagesMap } from '../src/notion/ids.js';
import { initNotion } from '../src/notion/init.js';
import {
  exigenceToProperties,
  richText,
  selectName,
  texteToProperties,
} from '../src/notion/mapping.js';
import { pushToNotion } from '../src/notion/push.js';
import { BASES, BASE_KEYS, P, RELATIONS } from '../src/notion/schema.js';
import { store } from '../src/store/repository.js';
import type { ExigenceRecord, TexteRecord } from '../src/store/types.js';
import { loadEnv } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { FakeNotion } from './helpers/fake-notion.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const texte: TexteRecord = {
  id: 'TX-0001',
  source: 'eurlex',
  reference: 'CELEX:32022R2554',
  titre: 'Règlement DORA',
  type: 'Règlement UE',
  url_officielle: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
  urls_connues: [],
  date_publication: null,
  date_entree_en_vigueur: null,
  date_entree_en_application: '2025-01-17',
  statut_texte: 'En vigueur',
  hash_sha256: 'b'.repeat(64),
  collecte_le: '2026-10-27T16:01:00.000Z',
  derniere_modification_detectee: null,
  fichier_source: null,
  applicable: 'À déterminer',
  justification_applicabilite: null,
  confiance_applicabilite: null,
  resume: null,
  nombre_articles: 64,
  articles: [],
  run_id: 'RUN-20261027-1601',
  version: 1,
  historique: [],
};

const exigence: ExigenceRecord = {
  id: 'EX-0001',
  texte_id: 'TX-0001',
  titre: 'Mettre en place un cadre de gestion du risque lié aux TIC',
  description: 'x'.repeat(4100),
  articles: ['Art. 6 §1'],
  extrait_verbatim: 'Les entités financières disposent d’un cadre',
  url_article: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6',
  verifie_dans_source: true,
  type_obligation: 'Gouvernance',
  destinataires: ['Entités financières, y compris', 'Microentreprises'],
  echeance: { date: '2025-01-17', type: 'Entrée en application', texte_source: 'Art. 64' },
  sanction: null,
  confiance: 0.91,
  confiance_detail: { llm: 0.82, verbatim_retrouve: 1, article_existe: 1 },
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
  effort_estime: null,
  impact_justification: null,
  couverture: 'À évaluer',
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
};

describe('mapping Notion', () => {
  it('découpe les rich_text à 2 000 caractères et nettoie les options select', () => {
    expect(richText(null)).toEqual([]);
    const chunks = richText('a'.repeat(4100));
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.text.content).toHaveLength(2000);
    expect(chunks[2]!.text.content).toHaveLength(100);
    expect(richText('b'.repeat(60_000)).at(-1)?.text.content).toBe('… [tronqué]');
    expect(selectName('Entités financières, y compris')).toBe(
      'Entités financières  y compris'.replace(/\s+/g, ' '),
    );
  });

  it('mappe un texte et une exigence, sans champs de validation à la mise à jour', () => {
    const t = texteToProperties(texte) as Record<
      string,
      { select?: { name: string }; title?: unknown[] }
    >;
    expect(t[P.textes.source]!.select!.name).toBe('EUR-Lex');
    expect(t[P.textes.id]!.title).toHaveLength(1);

    const create = exigenceToProperties(exigence, {
      textePageId: 'page-7',
      includeValidation: true,
    }) as Record<string, unknown>;
    expect(create[P.exigences.statut_validation]).toEqual({ select: { name: 'À valider' } });
    expect(create[P.exigences.texte]).toEqual({ relation: [{ id: 'page-7' }] });
    expect((create[P.exigences.description] as { rich_text: unknown[] }).rich_text).toHaveLength(3);
    expect(
      (create[P.exigences.destinataires] as { multi_select: { name: string }[] }).multi_select.map(
        (o) => o.name,
      ),
    ).toEqual(['Entités financières y compris', 'Microentreprises']);
    const update = exigenceToProperties(exigence, { includeValidation: false });
    expect(update).not.toHaveProperty(P.exigences.statut_validation);
    expect(update).not.toHaveProperty(P.exigences.validateur);
    expect(update).not.toHaveProperty(P.exigences.texte);
  });
});

describe('notion init et push (faux client)', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  let fake: FakeNotion;
  let gateway: NotionGateway;
  beforeEach(() => {
    tmp = useTmpRoot();
    process.env.NOTION_TOKEN = 'secret_test';
    process.env.NOTION_PARENT_PAGE_ID = 'page-parent';
    loadEnv({ reload: true });
    fake = new FakeNotion('page-parent');
    gateway = new NotionGateway(
      { token: 'x', parentPageId: 'page-parent', apiVersion: '2025-09-03' },
      { client: fake.client, minIntervalMs: 0, log: logger },
    );
    store.textes.writeAll([texte]);
    store.exigences.writeAll([exigence]);
  });
  afterEach(() => {
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_PARENT_PAGE_ID;
    loadEnv({ reload: true });
    tmp.cleanup();
  });

  it('crée les six bases, pose les relations et la formule, puis est idempotent', async () => {
    const first = await initNotion({ gateway, log: logger });
    expect(first.created).toEqual(BASE_KEYS);
    expect(first.reused).toEqual([]);
    expect(first.relations_added).toBe(RELATIONS.length);
    expect(first.formulas_added).toBe(1);
    expect(fake.databases.size).toBe(6);
    const ids = readNotionIds()!;
    expect(Object.keys(ids.bases)).toEqual(BASE_KEYS);
    expect(ids.bases.exigences.proprietes.statut_validation).toBe('Statut de validation');

    const exigencesDs = fake.dataSources.get(ids.bases.exigences.data_source_id)!;
    expect(exigencesDs.properties[P.exigences.texte]?.type).toBe('relation');
    const textesDs = fake.dataSources.get(ids.bases.textes.data_source_id)!;
    expect(textesDs.properties[P.textes.exigences]?.type).toBe('relation');
    const risquesDs = fake.dataSources.get(ids.bases.risques.data_source_id)!;
    expect(risquesDs.properties[P.risques.criticite]?.type).toBe('formula');
    expect(Object.keys(textesDs.properties)).toEqual(
      expect.arrayContaining(Object.keys(BASES.textes.properties)),
    );

    const second = await initNotion({ gateway, log: logger });
    expect(second.created).toEqual([]);
    expect(second.reused).toEqual(BASE_KEYS);
    expect(second.relations_added).toBe(0);
    expect(second.formulas_added).toBe(0);
    expect(second.properties_added).toBe(0);
    expect(fake.databases.size).toBe(6);
  });

  it('pousse textes et exigences par upsert sans écraser les champs de validation', async () => {
    await initNotion({ gateway, log: logger });
    const first = await pushToNotion({ gateway, log: logger });
    expect(first.textes).toEqual({ created: 1, updated: 0 });
    expect(first.exigences).toEqual({ created: 1, updated: 0, revalidees: 0 });
    const map = readPagesMap();
    expect(Object.keys(map).sort()).toEqual(['EX-0001', 'TX-0001']);

    const page = fake.pages.get(map['EX-0001']!)!;
    expect(page.properties[P.exigences.statut_validation]).toEqual({
      select: { name: 'À valider' },
    });
    expect(page.properties[P.exigences.texte]).toEqual({ relation: [{ id: map['TX-0001'] }] });

    // Décision humaine simulée dans Notion, puis nouveau push : le statut est conservé.
    page.properties[P.exigences.statut_validation] = { select: { name: 'Validée' } };
    page.properties[P.exigences.validateur] = {
      rich_text: [{ type: 'text', text: { content: 'N. Kaci' } }],
    };
    store.exigences.upsert({ ...exigence, titre: 'Titre révisé par le pipeline' });
    const second = await pushToNotion({ gateway, log: logger });
    expect(second.exigences).toEqual({ created: 0, updated: 1, revalidees: 0 });
    expect(page.properties[P.exigences.statut_validation]).toEqual({ select: { name: 'Validée' } });
    expect(
      (page.properties[P.exigences.titre] as { rich_text: { text: { content: string } }[] })
        .rich_text[0]!.text.content,
    ).toBe('Titre révisé par le pipeline');
    expect(fake.calls.filter((c) => c === 'pages.create')).toHaveLength(2);
  });

  it('propage « À revalider » avec un commentaire d’audit, une seule fois', async () => {
    await initNotion({ gateway, log: logger });
    await pushToNotion({ gateway, log: logger });
    store.exigences.upsert({
      ...exigence,
      statut_validation: 'À revalider',
      revalidation_motif: 'Article(s) modifié(s) : 6',
    });
    const first = await pushToNotion({ gateway, log: logger });
    expect(first.exigences.revalidees).toBe(1);
    const page = fake.pages.get(readPagesMap()['EX-0001']!)!;
    expect(page.properties[P.exigences.statut_validation]).toEqual({
      select: { name: 'À revalider' },
    });
    expect(fake.comments.map((c) => c.text)).toEqual([
      expect.stringContaining("À revalider par l'agent · Article(s) modifié(s) : 6"),
    ]);
    const second = await pushToNotion({ gateway, log: logger });
    expect(second.exigences.revalidees).toBe(0);
    expect(fake.comments).toHaveLength(1);
  });

  it('filtre par run et refuse un push sans init', async () => {
    await expect(pushToNotion({ gateway, log: logger })).rejects.toThrow(/notion init/);
    await initNotion({ gateway, log: logger });
    const summary = await pushToNotion({ gateway, log: logger, runId: 'RUN-AUTRE' });
    expect(summary.textes).toEqual({ created: 0, updated: 0 });
  });
});

describe('notion pull (faux client)', () => {
  it('rapatrie les décisions humaines dans le store et le journal, sans doublon', async () => {
    const { pullFromNotion } = await import('../src/notion/pull.js');
    const tmp = useTmpRoot();
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
        exigence,
        { ...exigence, id: 'EX-0002', titre: 'Deuxième exigence' },
      ]);
      await initNotion({ gateway, log: logger });
      await pushToNotion({ gateway, log: logger, only: ['textes', 'exigences'] });
      const map = readPagesMap();
      const page = fake.pages.get(map['EX-0002']!)!;
      page.properties[P.exigences.statut_validation] = { select: { name: 'Corrigée' } };
      page.properties[P.exigences.validateur] = { rich_text: [{ plain_text: 'N. Kaci' }] };
      page.properties[P.exigences.date_validation] = {
        date: { start: '2026-10-27T18:30:00.000+00:00' },
      };
      page.properties[P.exigences.commentaire_validation] = {
        rich_text: [{ plain_text: 'titre reformulé' }],
      };
      page.properties[P.exigences.version_corrigee] = {
        rich_text: [{ plain_text: JSON.stringify({ titre: 'Titre corrigé par l’humain' }) }],
      };
      page.properties[P.exigences.id] = { title: [{ plain_text: 'EX-0002' }] };
      fake.pages.get(map['EX-0001']!)!.properties[P.exigences.id] = {
        title: [{ plain_text: 'EX-0001' }],
      };

      const first = await pullFromNotion({ gateway, log: logger });
      expect(first).toMatchObject({
        pages_lues: 2,
        exigences_mises_a_jour: 1,
        decisions_journalisees: 1,
      });
      const updated = store.exigences.findById('EX-0002')!;
      expect(updated).toMatchObject({
        statut_validation: 'Corrigée',
        validateur: 'N. Kaci',
        titre: 'Titre corrigé par l’humain',
        commentaire_validation: 'titre reformulé',
      });
      expect(store.exigences.findById('EX-0001')?.statut_validation).toBe('À valider');
      const journal = store.validations.readAll();
      expect(journal).toHaveLength(1);
      expect(journal[0]).toMatchObject({
        exigence_id: 'EX-0002',
        action: 'Corrigée',
        validateur: 'N. Kaci',
        source: 'notion',
        champs_modifies: { titre: 'Titre corrigé par l’humain' },
      });

      const second = await pullFromNotion({ gateway, log: logger });
      expect(second).toMatchObject({ exigences_mises_a_jour: 0, decisions_journalisees: 0 });
      expect(store.validations.readAll()).toHaveLength(1);
    } finally {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_PARENT_PAGE_ID;
      loadEnv({ reload: true });
      tmp.cleanup();
    }
  });
});
