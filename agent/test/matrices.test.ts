import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateMatrices, parseFormats, parseMatrixIds } from '../src/matrices/index.js';
import { store } from '../src/store/repository.js';
import type { ExigenceRecord, TexteRecord } from '../src/store/types.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const texte: TexteRecord = {
  id: 'TX-0001',
  source: 'eurlex',
  reference: 'CELEX:32022R2554',
  titre: 'Règlement (UE) 2022/2554 (DORA)',
  type: 'Règlement UE',
  url_officielle: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
  urls_connues: [],
  date_publication: null,
  date_entree_en_vigueur: null,
  date_entree_en_application: '2025-01-17',
  statut_texte: 'En vigueur',
  hash_sha256: 'a'.repeat(64),
  collecte_le: '2026-10-27T16:01:00.000Z',
  derniere_modification_detectee: null,
  fichier_source: null,
  applicable: 'À déterminer',
  justification_applicabilite: null,
  confiance_applicabilite: null,
  resume: null,
  nombre_articles: 0,
  articles: [],
  run_id: 'RUN-20261027-1601',
  version: 1,
  historique: [],
};

function exigence(id: string, extra: Partial<ExigenceRecord> = {}): ExigenceRecord {
  return {
    id,
    texte_id: 'TX-0001',
    titre: `Titre ${id}`,
    description: 'Description',
    articles: ['Art. 6 §1'],
    extrait_verbatim: 'Extrait avec, virgule et "guillemets"\nsur deux lignes',
    url_article: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6',
    verifie_dans_source: true,
    type_obligation: 'Gouvernance',
    destinataires: ['Entités financières'],
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
    ...extra,
  };
}

describe('matrices M1', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
    store.textes.writeAll([texte]);
    store.exigences.writeAll([
      exigence('EX-0002', {
        statut_validation: 'Validée',
        verifie_dans_source: false,
        confiance: 0.41,
      }),
      exigence('EX-0001'),
    ]);
  });
  afterEach(() => tmp.cleanup());

  it('parse les options', () => {
    expect(parseMatrixIds('m1,M3')).toEqual(['M1', 'M3']);
    expect(parseMatrixIds(undefined)).toHaveLength(5);
    expect(() => parseMatrixIds('M9')).toThrow(/inconnue/);
    expect(parseFormats('csv,md')).toEqual(['csv', 'md']);
    expect(() => parseFormats('pdf')).toThrow(/inconnu/);
  });

  it('génère M1 en CSV et MD avec pied de page, triée par ID', async () => {
    const result = await generateMatrices({
      texteId: 'TX-0001',
      only: ['M1', 'M2'],
      formats: ['csv', 'md', 'xlsx'],
      runId: 'RUN-TEST',
    });
    expect(result.exigences).toBe(2);
    expect(result.files.map((f) => `${f.matrice}.${f.format}`)).toEqual([
      'M1.csv',
      'M1.md',
      'M2.csv',
      'M2.md',
      'M1.xlsx',
      'M2.xlsx',
    ]);
    expect(result.skipped).toEqual([]);

    const csv = readFileSync(
      path.join(tmp.root, 'output', 'matrices', 'M1-tracabilite.csv'),
      'utf8',
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      "ID exigence,Titre,Texte,Article(s),Extrait verbatim,URL officielle,Échéance,Type d'échéance,Destinataires,Confiance,Vérifié,Statut de validation",
    );
    expect(
      lines[1]!.startsWith(
        'EX-0001,Titre EX-0001,TX-0001 · Règlement (UE) 2022/2554 (DORA),Art. 6 §1,"Extrait avec, virgule et ""guillemets""\nsur deux lignes"',
      ),
    ).toBe(true);
    expect(lines[1]).toContain(
      ',2025-01-17,Entrée en application,Entités financières,0.91,oui,À valider',
    );
    expect(lines[2]!.startsWith('EX-0002,')).toBe(true);
    expect(csv).toContain('# Run : RUN-TEST');
    expect(csv).toContain("# Nombre d'exigences : 2");
    expect(csv).toContain('# Exigences vérifiées dans la source : 50 %');

    const md = readFileSync(path.join(tmp.root, 'output', 'matrices', 'M1-tracabilite.md'), 'utf8');
    expect(md).toContain('# M1 Traçabilité');
    expect(md).toContain('| EX-0001 | Titre EX-0001 |');
    expect(md).toContain('_Run : RUN-TEST_');
  });

  it('ne projette que les exigences validées ou corrigées avec --only-validated', async () => {
    const result = await generateMatrices({
      texteId: 'TX-0001',
      only: ['M1'],
      formats: ['csv'],
      onlyValidated: true,
      runId: null,
    });
    expect(result.exigences).toBe(1);
    const csv = readFileSync(
      path.join(tmp.root, 'output', 'matrices', 'M1-tracabilite.csv'),
      'utf8',
    );
    expect(csv).toContain('EX-0002');
    expect(csv).not.toContain('EX-0001');
    expect(csv).toContain('validées et corrigées uniquement');
  });

  it('refuse un texte inconnu ou l’absence de cible', async () => {
    await expect(generateMatrices({ texteId: 'TX-0099', only: ['M1'] })).rejects.toThrow(
      /introuvable/,
    );
    await expect(generateMatrices({ only: ['M1'] })).rejects.toThrow(/--texte/);
  });
});
