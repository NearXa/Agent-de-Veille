import { parseSteps, runPipeline } from '../analysis/run.js';
import { loadEnv } from '../config/env.js';

export interface RunCommandOptions {
  texte: string;
  articles?: string;
  force?: boolean;
  steps?: string;
  cache?: boolean;
  maxCost?: string;
}

export default async function runCommand(options: RunCommandOptions): Promise<void> {
  if (options.maxCost) {
    // Plafond de coût pour ce run uniquement (le pipeline complet enchaîne plusieurs dizaines d'appels).
    process.env.LLM_MAX_COST_PER_RUN = options.maxCost;
    loadEnv({ reload: true });
  }
  const summary = await runPipeline({
    texteId: options.texte,
    articles: options.articles,
    force: options.force,
    steps: parseSteps(options.steps),
    useCache: options.cache,
  });
  console.log(`Pipeline ${summary.texte_id} · run ${summary.run_id}`);
  for (const s of summary.steps)
    console.log(
      `  ${s.step.padEnd(14)} ${s.statut.padEnd(8)} ${(s.duree_ms / 1000).toFixed(1).padStart(7)} s  ${s.detail}`,
    );
  if (summary.arret) console.log(`  ${summary.arret}`);
}
