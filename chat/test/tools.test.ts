import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Store de fixtures isolé : les tests ne dépendent pas de l'état du store réel. */
const root = mkdtempSync(path.join(tmpdir(), 'veille-chat-'));
const options = { toolCallId: 'test', messages: [] };

function write(rel: string, value: unknown): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), 'utf8');
}

function exigence(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    texte_id: 'TX-0001',
    titre: `Exigence ${id}`,
    description: 'Description',
    articles: ['Art. 6 §1'],
    extrait_verbatim:
      'Les entités financières disposent d’un cadre de gestion du risque lié aux TIC',
    url_article: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6',
    verifie_dans_source: true,
    type_obligation: 'Gouvernance',
    destinataires: ['Entités financières'],
    echeance: { date: '2025-01-17', type: 'Entrée en application', texte_source: 'Art. 64' },
    sanction: { description: 'Sanctions administratives', niveau: 'Élevé', article: 'Art. 50' },
    confiance: 0.95,
    statut_validation: 'À valider',
    validateur: null,
    date_validation: null,
    commentaire_validation: null,
    processus_impactes: ['Gestion des risques'],
    systemes_impactes: [],
    donnees_concernees: [],
    contrats_concernes: [],
    departements_impactes: [],
    effort_estime: 'Moyen',
    couverture: 'Partielle',
    couverture_detail: [
      { controle_id: 'CT-0001', couverture: 'partielle', ecart: 'PSSI incomplète' },
    ],
    controles_ids: ['CT-0001'],
    risques_ids: [],
    jurisprudence_ids: [],
    lots_ids: [],
    avertissements: [],
    ...extra,
  };
}

async function run<T>(name: string, input: unknown): Promise<T> {
  const { outils } = await import('../lib/tools');
  const tool = (
    outils as unknown as Record<string, { execute?: (i: unknown, o: unknown) => Promise<unknown> }>
  )[name];
  if (!tool?.execute) throw new Error(`outil ${name} sans execute`);
  return (await tool.execute(input, options)) as T;
}

let savedToken: string | undefined;

beforeAll(() => {
  savedToken = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;
  process.env.VEILLE_ROOT = root;
  write('data/store/textes.json', [
    {
      id: 'TX-0001',
      source: 'eurlex',
      reference: 'CELEX:32022R2554',
      titre: 'Règlement DORA',
      type: 'Règlement UE',
      url_officielle: 'https://eur-lex.europa.eu/x',
      collecte_le: '2026-10-27T16:01:00.000Z',
      applicable: 'Oui',
      resume: 'Résilience opérationnelle numérique du secteur financier.',
      nombre_articles: 64,
      derniere_modification_detectee: null,
      version: 1,
    },
    {
      id: 'TX-0002',
      source: 'cnil',
      reference: 'https://www.cnil.fr/a',
      titre: 'Délibération CNIL',
      type: 'Délibération',
      url_officielle: 'https://www.cnil.fr/a',
      collecte_le: '2026-10-28T09:00:00.000Z',
      applicable: 'À déterminer',
      resume: null,
      nombre_articles: 1,
      derniere_modification_detectee: null,
      version: 1,
    },
  ]);
  write('data/store/exigences.json', [
    exigence('EX-0001', {
      titre: 'Disposer d’un cadre de gestion du risque lié aux TIC',
      risques_ids: ['RK-0001'],
      lots_ids: ['LA-0001'],
    }),
    exigence('EX-0002', {
      titre: 'Notifier les incidents majeurs liés aux TIC',
      articles: ['Art. 11 §2'],
      echeance: { date: '2027-03-31', type: 'Périodique', texte_source: null },
      couverture: 'Non couverte',
      statut_validation: 'Validée',
    }),
    exigence('EX-0003', {
      titre: 'Tester le plan de continuité',
      articles: ['Art. 11 §6'],
      echeance: null,
      sanction: null,
    }),
  ]);
  write('data/store/controles.json', [
    {
      id: 'CT-0001',
      nom: 'Politiques de sécurité de l’information',
      referentiel: 'ISO 27001:2022',
      reference: 'A.5.1',
      statut: 'En place',
      efficacite: 'Satisfaisante',
      exigences_ids: ['EX-0001'],
      ecart_constate: null,
    },
    {
      id: 'CT-0035',
      nom: 'Registre des prestataires TIC',
      referentiel: 'Interne',
      reference: 'INT-02',
      statut: 'Absent',
      efficacite: 'Non évaluée',
      exigences_ids: [],
      ecart_constate: null,
    },
  ]);
  write('data/store/risques.json', [
    {
      id: 'RK-0001',
      exigence_id: 'EX-0001',
      intitule: 'Absence de cadre',
      scenario: 'Sanction AMF',
      categorie: 'Juridique',
      probabilite: 4,
      impact: 3,
      criticite_brute: 12,
      controles_attenuants: [],
      risque_residuel: 12,
      niveau_residuel: 'Critique',
      traitement: 'Réduire',
      proprietaire: 'Juridique',
      statut: 'Identifié',
      lots_ids: ['LA-0001'],
    },
    {
      id: 'RK-0002',
      exigence_id: 'EX-0002',
      intitule: 'Notification tardive',
      scenario: 'Retard',
      categorie: 'Cyber',
      probabilite: 2,
      impact: 2,
      criticite_brute: 4,
      controles_attenuants: ['CT-0001'],
      risque_residuel: 3,
      niveau_residuel: 'Faible',
      traitement: 'Réduire',
      proprietaire: 'RSSI',
      statut: 'Identifié',
      lots_ids: [],
    },
  ]);
  write('data/store/lots.json', [
    {
      id: 'LA-0001',
      titre: 'Vision',
      description: 'd',
      exigences_ids: ['EX-0001'],
      risques_ids: ['RK-0001'],
      priorite: 'P1',
      responsable: 'Direction',
      echeance_cible: '2025-01-17',
      statut: 'À planifier',
      cadre_gouvernance: 'TOGAF',
      phase_ou_pratique: 'TOGAF Phase A (Architecture Vision)',
      livrable_attendu: 'Vision',
      effort: 'Moyen',
    },
    {
      id: 'LA-0002',
      titre: 'Incidents',
      description: 'd',
      exigences_ids: ['EX-0002'],
      risques_ids: [],
      priorite: 'P3',
      responsable: 'RSSI',
      echeance_cible: null,
      statut: 'En cours',
      cadre_gouvernance: 'ITIL',
      phase_ou_pratique: 'ITIL Incident Management',
      livrable_attendu: 'Procédure',
      effort: 'Faible',
    },
  ]);
  write('output/gouvernance/recommandation.json', {
    cadre_recommande: 'Hybride',
    score_togaf: 55,
    score_itil: 65,
    justification: 'j',
    points_de_decision_humaine: ['Budget'],
    lots: ['LA-0001', 'LA-0002'],
  });
});

afterAll(() => {
  if (savedToken !== undefined) process.env.NOTION_TOKEN = savedToken;
  delete process.env.VEILLE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe('outils de l’assistant de chat', () => {
  it('recherche des exigences par mots-clés (sans accents ni casse), article, statut et couverture', async () => {
    type R = { total: number; exigences: { id: string }[] };
    expect(
      (
        await run<R>('rechercher_exigences', { requete: 'INCIDENTS majeurs', limite: 10 })
      ).exigences.map((e) => e.id),
    ).toEqual(['EX-0002']);
    expect(
      (await run<R>('rechercher_exigences', { article: '11', limite: 10 })).exigences.map(
        (e) => e.id,
      ),
    ).toEqual(['EX-0002', 'EX-0003']);
    expect(
      (await run<R>('rechercher_exigences', { statut_validation: 'Validée', limite: 10 })).total,
    ).toBe(1);
    expect(
      (
        await run<R>('rechercher_exigences', { couverture: 'Non couverte', limite: 10 })
      ).exigences.map((e) => e.id),
    ).toEqual(['EX-0002']);
  });

  it('détaille une exigence avec texte, contrôles, risques et lots', async () => {
    const d = await run<{
      id: string;
      texte: { id: string } | null;
      controles: { id: string }[];
      risques: { id: string; niveau_residuel: string }[];
      lots: { id: string }[];
    }>('detail_exigence', { id: 'ex-0001' });
    expect(d).toMatchObject({ id: 'EX-0001', texte: { id: 'TX-0001' } });
    expect(d.controles.map((c) => c.id)).toEqual(['CT-0001']);
    expect(d.risques).toEqual([
      expect.objectContaining({ id: 'RK-0001', niveau_residuel: 'Critique' }),
    ]);
    expect(d.lots.map((l) => l.id)).toEqual(['LA-0001']);
    expect(await run<{ erreur?: string }>('detail_exigence', { id: 'EX-9999' })).toMatchObject({
      erreur: expect.stringContaining('introuvable'),
    });
  });

  it('filtre et trie les échéances', async () => {
    type R = { total: number; exigences: { id: string; echeance: string | null }[] };
    const toutes = await run<R>('echeances', { limite: 10 });
    expect(toutes.exigences.map((e) => e.id)).toEqual(['EX-0001', 'EX-0002']);
    expect(
      (await run<R>('echeances', { avant: '2026-12-31', limite: 10 })).exigences.map((e) => e.id),
    ).toEqual(['EX-0001']);
    expect(
      (await run<R>('echeances', { apres: '2026-01-01', limite: 10 })).exigences.map((e) => e.id),
    ).toEqual(['EX-0002']);
  });

  it('liste risques, lots, contrôles, fil de veille et indicateurs', async () => {
    const r = await run<{
      total: number;
      risques: { id: string }[];
      repartition_globale: Record<string, number>;
    }>('lister_risques', { niveau_residuel: 'Critique', limite: 10 });
    expect(r.risques.map((x) => x.id)).toEqual(['RK-0001']);
    expect(r.repartition_globale).toEqual({ Critique: 1, Faible: 1 });
    expect(
      (await run<{ lots: { id: string }[] }>('lister_lots', { priorite: 'P1' })).lots.map(
        (l) => l.id,
      ),
    ).toEqual(['LA-0001']);
    expect(
      (await run<{ lots: { id: string }[] }>('lister_lots', { cadre: 'ITIL' })).lots.map(
        (l) => l.id,
      ),
    ).toEqual(['LA-0002']);
    expect(
      (
        await run<{ controles: { id: string }[] }>('lister_controles', {
          statut: 'Absent',
          limite: 10,
        })
      ).controles.map((c) => c.id),
    ).toEqual(['CT-0035']);
    expect(
      (await run<{ textes: { id: string }[] }>('fil_de_veille', { limite: 10 })).textes.map(
        (t) => t.id,
      ),
    ).toEqual(['TX-0002', 'TX-0001']);
    expect(
      (
        await run<{ textes: { id: string }[] }>('fil_de_veille', { source: 'eurlex', limite: 10 })
      ).textes.map((t) => t.id),
    ).toEqual(['TX-0001']);
    const k = await run<{
      exigences: number;
      par_statut: Record<string, number>;
      pct_verifiees: number;
      lots_par_statut: Record<string, number>;
      recommandation: { cadre_recommande: string } | null;
      decision: unknown;
    }>('indicateurs', {});
    expect(k).toMatchObject({
      exigences: 3,
      par_statut: { 'À valider': 2, Validée: 1 },
      pct_verifiees: 100,
      lots_par_statut: { 'À planifier': 1, 'En cours': 1 },
      recommandation: { cadre_recommande: 'Hybride' },
      decision: null,
    });
  });

  it('signale clairement l’absence de token Notion', async () => {
    expect(
      await run<{ erreur?: string }>('rechercher_notion', { requete: 'DORA', limite: 5 }),
    ).toMatchObject({ erreur: expect.stringContaining('NOTION_TOKEN') });
  });
});
