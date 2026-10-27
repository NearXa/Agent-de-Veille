import { loadOrganisation } from '../config/schemas.js';
import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { buildImpactBatchSchema } from '../schemas/analyse.js';
import { store } from '../store/repository.js';
import {
  addCount,
  addWarning,
  createRun,
  finishRun,
  writeRunArtifact,
  type RunContext,
} from '../store/run.js';
import type { ExigenceRecord } from '../store/types.js';
import type { StructuredCaller } from './extract.js';
import {
  chunkArray,
  exigenceLine,
  exigencesOfTexte,
  organisationShort,
  requireTexte,
} from './shared.js';

export interface ImpactOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
  batchSize?: number;
}

export interface ImpactSummary {
  texte_id: string;
  run_id: string;
  exigences: number;
  appels: number;
  efforts: Record<string, number>;
}

/** Étape impact : processus, systèmes, données, contrats et départements (listes fermées de l'organisation). */
export async function analyseImpact(options: ImpactOptions): Promise<ImpactSummary> {
  const run = options.run ?? createRun('impact');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const exigences = exigencesOfTexte(texte.id);
    const org = loadOrganisation();
    const schema = buildImpactBatchSchema(org);
    const prompt = loadPrompt('impact');
    const byId = new Map(exigences.map((e) => [e.id, e] as const));
    const summary: ImpactSummary = {
      texte_id: texte.id,
      run_id: run.id,
      exigences: exigences.length,
      appels: 0,
      efforts: {},
    };
    const updated: ExigenceRecord[] = [];
    for (const batch of chunkArray(exigences, options.batchSize ?? 15)) {
      const label = `impact ${batch[0]!.id}-${batch[batch.length - 1]!.id}`;
      const rendered = renderPrompt(prompt.template, {
        organisation: organisationShort(org),
        processus: org.processus.join(' | '),
        systemes: org.systemes.join(' | '),
        donnees: org.donnees.join(' | '),
        contrats: org.contrats.join(' | '),
        departements: org.departements.join(' | '),
        exigences: batch.map((e) => exigenceLine(e, { description: true })).join('\n'),
      });
      const result = await llm({
        schema,
        schemaName: 'ImpactBatch',
        instructions: prompt.instructions,
        prompt: rendered,
        promptVersion: prompt.version,
        run,
        label,
        useCache: options.useCache,
      });
      summary.appels += 1;
      writeRunArtifact(run, `${label.replace(/\s+/g, '-')}.json`, {
        prompt: rendered,
        output: result.output,
        usage: result.usage,
        cached: result.cached,
      });
      for (const item of result.output.exigences) {
        const e = byId.get(item.exigence_id);
        if (!e) {
          addWarning(
            run,
            `impact : identifiant inconnu renvoyé par le modèle : ${item.exigence_id}`,
          );
          continue;
        }
        summary.efforts[item.effort_estime] = (summary.efforts[item.effort_estime] ?? 0) + 1;
        updated.push({
          ...e,
          processus_impactes: item.processus,
          systemes_impactes: item.systemes,
          donnees_concernees: item.donnees,
          contrats_concernes: item.contrats,
          departements_impactes: item.departements,
          effort_estime: item.effort_estime,
          impact_justification: item.justification,
          run_id: run.id,
        });
      }
    }
    const missing = exigences.filter((e) => !updated.some((u) => u.id === e.id));
    for (const e of missing) addWarning(run, `impact : ${e.id} absente de la réponse du modèle`);
    store.exigences.upsertMany(updated);
    addCount(run, 'exigences_impact', updated.length);
    run.log.info(summary, 'Analyse d’impact terminée');
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
