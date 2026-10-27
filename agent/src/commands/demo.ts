import path from 'node:path';
import { extractExigences } from '../analysis/extract.js';
import { isNotionConfigured, loadEnv } from '../config/env.js';
import { loadSources } from '../config/schemas.js';
import { generateMatrices } from '../matrices/index.js';
import { initNotion } from '../notion/init.js';
import { pushToNotion } from '../notion/push.js';
import { createRun, finishRun } from '../store/run.js';
import { AppError } from '../utils/errors.js';
import { paths } from '../utils/paths.js';
import { ingestTexte } from './ingest.js';

export interface DemoCommandOptions {
  articles?: string;
  skipNotion?: boolean;
}

/**
 * Parcours de démonstration (SPEC.md, section 3), étapes 1 à 5, cache LLM forcé pour une
 * démonstration sans aléa. Un seul run regroupe les métriques.
 */
export default async function demoCommand(options: DemoCommandOptions): Promise<void> {
  process.env.LLM_CACHE = '1';
  const env = loadEnv({ reload: true });
  const sources = loadSources();
  const doc = sources.sources.find((s) => s.id === 'local-file')?.documents?.[0];
  if (!doc)
    throw new AppError(
      'Aucun document local déclaré dans config/sources.yaml (sources.local-file.documents).',
    );

  const run = createRun('demo');
  const started = Date.now();
  const step = (n: number, label: string): void => console.log(`\n[${n}/5] ${label}`);
  try {
    step(1, `Charger le texte officiel ${doc.reference}`);
    const ingested = await ingestTexte(
      {
        file: doc.fichier,
        source: doc.source_origine,
        ref: doc.reference,
        url: doc.url_officielle,
        title: doc.titre,
      },
      run,
    );
    const texte = ingested.texte;
    console.log(
      `  ${texte.id} · ${texte.nombre_articles} articles · hash ${texte.hash_sha256.slice(0, 12)}… · ${ingested.created ? 'créé' : 'déjà connu'}`,
    );

    step(2, `Extraire les exigences des articles ${options.articles ?? '5-16'} (cache LLM activé)`);
    const extraction = await extractExigences({
      texteId: texte.id,
      articles: options.articles ?? '5-16',
      run,
    });
    const cost =
      extraction.cost_usd === null ? 'prix inconnu' : `${extraction.cost_usd.toFixed(4)} $`;
    console.log(
      `  ${extraction.chunks.length} chunk(s) · ${extraction.tokens.input + extraction.tokens.output} tokens · ${cost} · ${extraction.cached_calls} réponse(s) en cache`,
    );
    step(3, 'Exigences structurées et vérifiées');
    console.log(
      `  ${extraction.exigences_total} exigences (${extraction.exigences_nouvelles} nouvelles) · ${extraction.verifiees} vérifiées dans la source · ${extraction.non_verifiees} à relire en priorité`,
    );

    step(4, 'Générer la matrice M1 (CSV et Markdown)');
    const matrices = await generateMatrices({
      texteId: texte.id,
      only: ['M1'],
      formats: ['csv', 'md'],
      runId: run.id,
    });
    for (const f of matrices.files)
      console.log(`  ${path.relative(paths.root(), f.file)} (${f.rows} lignes)`);

    step(5, 'Enregistrer dans Notion');
    if (options.skipNotion) {
      console.log('  ignoré (--skip-notion)');
    } else if (!isNotionConfigured(env)) {
      console.log(
        '  ignoré : NOTION_TOKEN ou NOTION_PARENT_PAGE_ID absent de .env (le cockpit lira data/store/ en repli)',
      );
    } else {
      const init = await initNotion({ log: run.log });
      console.log(
        `  ${init.created.length} base(s) créée(s), ${init.reused.length} réutilisée(s), ${init.relations_added} relation(s) posée(s)`,
      );
      const push = await pushToNotion({ log: run.log });
      console.log(
        `  textes : ${push.textes.created} créé(s) / ${push.textes.updated} mis à jour · exigences : ${push.exigences.created} créée(s) / ${push.exigences.updated} mise(s) à jour`,
      );
    }
    finishRun(run, 'ok');
    console.log(
      `\nDémo terminée en ${((Date.now() - started) / 1000).toFixed(1)} s · run ${run.id}`,
    );
    console.log(
      'Étape 6 : lancer le cockpit avec « pnpm cockpit » puis ouvrir la vue « Validation humaine ».',
    );
  } catch (error) {
    finishRun(run, 'error', error);
    throw error;
  }
}
