import cron from 'node-cron';
import { extractExigences } from '../analysis/extract.js';
import { loadEnv } from '../config/env.js';
import { loadSources, type SourceConfig } from '../config/schemas.js';
import { ingestNormalized } from '../ingest/pipeline.js';
import { createConnector, type ConnectorDeps } from '../sources/registry.js';
import { createRun, finishRun, addCount, addWarning, type RunContext } from '../store/run.js';
import { readJson, writeJsonAtomic } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';

export interface WatchCommandOptions {
  once?: boolean;
  source?: string;
}

export interface WatchSourceSummary {
  source: string;
  statut: 'ok' | 'ignoree' | 'erreur';
  references: number;
  nouveaux: number;
  modifies: number;
  inchanges: number;
  extraits: number;
  message?: string;
}

export interface WatchSummary {
  run_id: string;
  sources: WatchSourceSummary[];
}

type WatchState = Record<string, { dernier_passage: string }>;

const stateFile = (): string => paths.runs('watch-state.json');

function readState(): WatchState {
  return readJson<WatchState>(stateFile(), {});
}

/** Un passage de veille sur une source : listRecent → fetch → parse → ingestion (→ extraction si activée). */
export async function watchSource(
  config: SourceConfig,
  run: RunContext,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<WatchSourceSummary> {
  const env = loadEnv();
  const sources = loadSources();
  const summary: WatchSourceSummary = {
    source: config.id,
    statut: 'ok',
    references: 0,
    nouveaux: 0,
    modifies: 0,
    inchanges: 0,
    extraits: 0,
  };
  const deps: ConnectorDeps = {
    env,
    config,
    defaults: sources.defaults,
    log: run.log,
    fetchImpl: options.fetchImpl,
  };
  const connector = createConnector(deps);
  if (!connector) {
    summary.statut = 'ignoree';
    summary.message = `connecteur ${config.id} non disponible (non implémenté ou identifiants manquants)`;
    addWarning(run, summary.message);
    return summary;
  }
  const state = readState();
  const since =
    state[config.id]?.dernier_passage ??
    new Date(Date.now() - sources.defaults.fenetre_initiale_jours * 86_400_000).toISOString();
  const analyse = config.analyse_automatique ?? sources.defaults.analyse_automatique;
  try {
    const allRefs = await connector.listRecent(since);
    const refs = allRefs.slice(0, sources.defaults.max_par_passage);
    summary.references = allRefs.length;
    if (allRefs.length > refs.length)
      addWarning(
        run,
        `${config.id} : ${allRefs.length} références, ${refs.length} traitées (max_par_passage)`,
      );
    for (const ref of refs) {
      try {
        const raw = await connector.fetchDocument({
          reference: ref.reference,
          url_officielle: ref.url_officielle,
          fichier: ref.fichier,
          source: ref.source,
          titre: ref.titre ?? undefined,
          type: ref.type,
        });
        const texte = await connector.parse(raw);
        const outcome = ingestNormalized(texte, raw, run);
        if (outcome.created) summary.nouveaux += 1;
        else if (outcome.changed) summary.modifies += 1;
        else summary.inchanges += 1;
        if (analyse && (outcome.created || outcome.changed)) {
          await extractExigences({ texteId: outcome.texte.id, run });
          summary.extraits += 1;
        }
      } catch (error) {
        addWarning(run, `${config.id} ${ref.reference} : ${(error as Error).message}`);
      }
    }
    state[config.id] = { dernier_passage: new Date().toISOString() };
    writeJsonAtomic(stateFile(), state);
  } catch (error) {
    summary.statut = 'erreur';
    summary.message = (error as Error).message;
    addWarning(run, `${config.id} : ${summary.message}`);
  }
  addCount(run, `veille_${config.id}_references`, summary.references);
  return summary;
}

/** Un passage sur toutes les sources activées (ou celles demandées). */
export async function watchOnce(
  options: { source?: string; fetchImpl?: typeof fetch; run?: RunContext } = {},
): Promise<WatchSummary> {
  const run = options.run ?? createRun('watch');
  const wanted = options.source ? new Set(options.source.split(',').map((s) => s.trim())) : null;
  try {
    const sources = loadSources().sources.filter((s) => s.enabled && (!wanted || wanted.has(s.id)));
    const results: WatchSourceSummary[] = [];
    for (const source of sources)
      results.push(await watchSource(source, run, { fetchImpl: options.fetchImpl }));
    if (!options.run) finishRun(run, 'ok');
    return { run_id: run.id, sources: results };
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}

function printSummary(summary: WatchSummary): void {
  console.log(`Veille · run ${summary.run_id}`);
  for (const s of summary.sources) {
    const detail =
      s.statut === 'ok'
        ? `${s.references} référence(s) : ${s.nouveaux} nouveau(x), ${s.modifies} modifié(s), ${s.inchanges} inchangé(s), ${s.extraits} extrait(s)`
        : `${s.statut} : ${s.message ?? ''}`;
    console.log(`  ${s.source.padEnd(20)} ${detail}`);
  }
}

/** `pnpm agent watch` : un passage immédiat (`--once`) ou planification cron par source. */
export default async function watchCommand(options: WatchCommandOptions): Promise<void> {
  if (options.once) {
    printSummary(await watchOnce({ source: options.source }));
    return;
  }
  const sources = loadSources();
  const enabled = sources.sources.filter(
    (s) => s.enabled && (!options.source || options.source.split(',').includes(s.id)),
  );
  if (enabled.length === 0) {
    console.log('Aucune source activée dans config/sources.yaml.');
    return;
  }
  for (const source of enabled) {
    const expression = source.cron ?? sources.defaults.cron;
    if (!cron.validate(expression))
      throw new Error(`Expression cron invalide pour ${source.id} : ${expression}`);
    cron.schedule(expression, () => {
      void watchOnce({ source: source.id })
        .then(printSummary)
        .catch((error: unknown) => logger.error({ err: error }, `Veille ${source.id} en erreur`));
    });
    console.log(`  ${source.id.padEnd(20)} planifié : ${expression}`);
  }
  console.log(
    'Planificateur démarré (Ctrl+C pour arrêter). Un passage immédiat : pnpm agent watch --once',
  );
  await new Promise(() => undefined);
}
