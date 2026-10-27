import { latestRun, listRuns } from '../store/run.js';

export interface StatusCommandOptions {
  json?: boolean;
  all?: boolean;
}

/** Résume le dernier run (ou les derniers avec --all). */
export default async function statusCommand(options: StatusCommandOptions): Promise<void> {
  const runs = options.all ? listRuns() : [latestRun()].filter((r) => r !== undefined);
  if (runs.length === 0) {
    console.log('Aucun run enregistré dans data/runs/.');
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(options.all ? runs : runs[0], null, 2));
    return;
  }
  for (const run of runs) {
    const cost = run.llm.cost_usd === null ? 'n/a' : `${run.llm.cost_usd.toFixed(4)} $`;
    const duration =
      run.duration_ms === null ? 'en cours' : `${(run.duration_ms / 1000).toFixed(1)} s`;
    console.log(
      `${run.run_id}  ${run.kind.padEnd(12)} ${run.status.padEnd(7)} ${duration.padStart(9)}  LLM ${run.llm.calls} appel(s) dont ${run.llm.cached_calls} en cache, ${run.llm.input_tokens}+${run.llm.output_tokens} tokens, ${cost}`,
    );
    const counts = Object.entries(run.counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (counts) console.log(`  compteurs : ${counts}`);
    if (run.warnings.length > 0) console.log(`  avertissements : ${run.warnings.length}`);
    if (run.error) console.log(`  erreur : ${run.error}`);
  }
}
