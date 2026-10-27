import { extractExigences } from '../analysis/extract.js';
import { store } from '../store/repository.js';

export interface ExtractCommandOptions {
  texte: string;
  articles?: string;
  dryRun?: boolean;
  cache?: boolean;
}

export default async function extractCommand(options: ExtractCommandOptions): Promise<void> {
  const summary = await extractExigences({
    texteId: options.texte,
    articles: options.articles,
    dryRun: options.dryRun,
    useCache: options.cache,
  });
  console.log(
    `Texte ${summary.texte_id} · run ${summary.run_id} · ${summary.chunks.length} chunk(s)`,
  );
  for (const chunk of summary.chunks) {
    console.log(
      `  ${chunk.id} : articles ${chunk.articles.join(', ')} · ≈ ${chunk.tokens_estimes} tokens`,
    );
  }
  if (summary.dry_run) {
    console.log('Dry-run : aucun appel au modèle.');
    return;
  }
  const cost = summary.cost_usd === null ? 'prix inconnu' : `${summary.cost_usd.toFixed(4)} $`;
  console.log(
    `  tokens : ${summary.tokens.input} en entrée, ${summary.tokens.output} en sortie · coût estimé ${cost} · ${summary.cached_calls} réponse(s) relue(s) du cache`,
  );
  console.log(
    `  exigences : ${summary.exigences_total} (${summary.exigences_nouvelles} nouvelles, ${summary.exigences_mises_a_jour} mises à jour, ${summary.exigences_fusionnees} fusionnées) · ${summary.verifiees} vérifiées dans la source, ${summary.non_verifiees} à relire`,
  );
  if (summary.avertissements.length > 0) {
    console.log(`  avertissements (${summary.avertissements.length}) :`);
    for (const w of summary.avertissements.slice(0, 10)) console.log(`    - ${w}`);
  }
  console.log(`  store : ${store.exigences.file}`);
}
