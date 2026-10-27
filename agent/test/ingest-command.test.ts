import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestTexte } from '../src/commands/ingest.js';
import { store } from '../src/store/repository.js';
import { fileExists } from '../src/utils/fs.js';
import { paths } from '../src/utils/paths.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('commande ingest', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
    mkdirSync(path.join(tmp.root, 'data', 'sources'), { recursive: true });
    cpSync(
      path.join(here, 'fixtures', 'dora-art5-7.html'),
      path.join(tmp.root, 'data', 'sources', 'dora.html'),
    );
  });
  afterEach(() => tmp.cleanup());

  it('enregistre TX-0001, archive le brut, puis reconnaît un texte inchangé', async () => {
    const options = {
      file: 'data/sources/dora.html',
      source: 'eurlex',
      ref: 'CELEX:32022R2554',
      url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
    };
    const first = await ingestTexte(options);
    expect(first.created).toBe(true);
    expect(first.texte.id).toBe('TX-0001');
    expect(first.texte.nombre_articles).toBe(3);
    expect(first.texte.hash_sha256).toHaveLength(64);
    expect(first.texte.run_id).toMatch(/^RUN-\d{8}-\d{4}/);
    expect(fileExists(paths.raw('eurlex', 'CELEX_32022R2554'))).toBe(true);
    expect(fileExists(path.join(paths.runs(first.run_id), 'metrics.json'))).toBe(true);

    const second = await ingestTexte(options);
    expect(second.created).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.texte.id).toBe('TX-0001');
    expect(second.texte.version).toBe(1);
    expect(store.textes.readAll()).toHaveLength(1);
  });

  it('détecte une modification : version 2, diff par article, exigences validées à revalider', async () => {
    const options = {
      file: 'data/sources/dora.html',
      source: 'eurlex',
      ref: 'CELEX:32022R2554',
      url: 'https://eur-lex.europa.eu/x',
    };
    const first = await ingestTexte(options);
    const base = {
      texte_id: 'TX-0001',
      description: 'Description',
      extrait_verbatim: 'extrait',
      url_article: null,
      verifie_dans_source: true,
      type_obligation: 'Gouvernance' as const,
      destinataires: [],
      echeance: null,
      sanction: null,
      confiance: 0.9,
      confiance_detail: { llm: 0.8, verbatim_retrouve: 1 as const, article_existe: 1 as const },
      justification_confiance: null,
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
      couverture: 'À évaluer' as const,
      couverture_detail: [],
      couverture_justification: null,
      lot_propose: null,
      controles_ids: [],
      risques_ids: [],
      jurisprudence_ids: [],
      lots_ids: [],
      run_id: first.run_id,
      chunk_id: null,
      avertissements: [],
      revalidation_motif: null,
    };
    store.exigences.writeAll([
      {
        ...base,
        id: 'EX-0001',
        titre: 'Validée sur art 6',
        articles: ['Art. 6 §1'],
        statut_validation: 'Validée',
        validateur: 'N. Kaci',
      },
      {
        ...base,
        id: 'EX-0002',
        titre: 'À valider sur art 6',
        articles: ['Art. 6 §5'],
        statut_validation: 'À valider',
      },
      {
        ...base,
        id: 'EX-0003',
        titre: 'Validée sur art 5',
        articles: ['Art. 5 §1'],
        statut_validation: 'Validée',
      },
    ]);
    const file = path.join(tmp.root, 'data', 'sources', 'dora.html');
    const modified = readFileSync(file, 'utf8').replace(
      'solide, complet et bien documenté',
      'solide, complet, documenté et testé chaque année',
    );
    expect(modified).not.toBe(readFileSync(file, 'utf8'));
    writeFileSync(file, modified, 'utf8');

    const second = await ingestTexte(options);
    expect(second.changed).toBe(true);
    expect(second.texte.version).toBe(2);
    expect(second.texte.statut_texte).toBe('Modifié');
    expect(second.texte.derniere_modification_detectee).not.toBeNull();
    expect(second.texte.historique).toHaveLength(1);
    expect(second.texte.historique[0]).toMatchObject({
      version: 2,
      articles_modifies: ['6'],
      articles_ajoutes: [],
      articles_supprimes: [],
    });
    expect(second.diff?.details[0]?.extrait).toContain('testé chaque année');
    expect(second.exigences_a_revalider).toEqual(['EX-0001']);
    const after = store.exigences.readAll();
    expect(after.find((e) => e.id === 'EX-0001')).toMatchObject({
      statut_validation: 'À revalider',
      validateur: 'N. Kaci',
    });
    expect(after.find((e) => e.id === 'EX-0001')?.revalidation_motif).toMatch(/modifié/);
    expect(after.find((e) => e.id === 'EX-0002')).toMatchObject({ statut_validation: 'À valider' });
    expect(after.find((e) => e.id === 'EX-0002')?.avertissements[0]).toMatch(/modifié/);
    expect(after.find((e) => e.id === 'EX-0003')).toMatchObject({
      statut_validation: 'Validée',
      revalidation_motif: null,
    });
  });

  it('refuse une source inconnue', async () => {
    await expect(
      ingestTexte({
        file: 'data/sources/dora.html',
        source: 'inconnue',
        ref: 'X',
        url: 'https://example.org',
      }),
    ).rejects.toThrow(/Source inconnue/);
  });
});
