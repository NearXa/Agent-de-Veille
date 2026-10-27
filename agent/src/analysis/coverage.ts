import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { CouvertureBatchSchema } from '../schemas/analyse.js';
import { store } from '../store/repository.js';
import {
  addCount,
  addWarning,
  createRun,
  finishRun,
  writeRunArtifact,
  type RunContext,
} from '../store/run.js';
import type { ControleRecord, ExigenceRecord } from '../store/types.js';
import type { StructuredCaller } from './extract.js';
import {
  chunkArray,
  exigenceLine,
  exigencesOfTexte,
  formatControles,
  organisationShort,
  requireTexte,
  seedControles,
} from './shared.js';

export interface CoverageOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
  batchSize?: number;
}

export interface CoverageSummary {
  texte_id: string;
  run_id: string;
  exigences: number;
  appels: number;
  statuts: Record<string, number>;
}

/** Statut global cohérent avec les contrôles cités et leur état réel dans le catalogue. */
export function normalizeStatut(
  statut: 'Couverte' | 'Partielle' | 'Non couverte',
  detail: { controle_id: string; couverture: 'totale' | 'partielle' | 'nulle' }[],
  controles: Map<string, ControleRecord>,
): ExigenceRecord['couverture'] {
  const effective = detail.filter((d) => d.couverture !== 'nulle' && controles.has(d.controle_id));
  if (effective.length === 0) return 'Non couverte';
  const totalEnPlace = effective.some(
    (d) => d.couverture === 'totale' && controles.get(d.controle_id)!.statut === 'En place',
  );
  if (statut === 'Couverte' && totalEnPlace) return 'Couverte';
  return 'Partielle';
}

/** Étape couverture : confrontation aux contrôles de config/controles.yaml, liens posés dans les deux sens. */
export async function analyseCoverage(options: CoverageOptions): Promise<CoverageSummary> {
  const run = options.run ?? createRun('coverage');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const exigences = exigencesOfTexte(texte.id);
    const controles = seedControles(run.id);
    const byControle = new Map(controles.map((c) => [c.id, c] as const));
    const prompt = loadPrompt('couverture');
    const byId = new Map(exigences.map((e) => [e.id, e] as const));
    const summary: CoverageSummary = {
      texte_id: texte.id,
      run_id: run.id,
      exigences: exigences.length,
      appels: 0,
      statuts: {},
    };
    const updated: ExigenceRecord[] = [];
    for (const batch of chunkArray(exigences, options.batchSize ?? 15)) {
      const label = `coverage ${batch[0]!.id}-${batch[batch.length - 1]!.id}`;
      const rendered = renderPrompt(prompt.template, {
        organisation: organisationShort(),
        controles: formatControles(controles),
        exigences: batch.map((e) => exigenceLine(e, { description: true })).join('\n'),
      });
      const result = await llm({
        schema: CouvertureBatchSchema,
        schemaName: 'CouvertureBatch',
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
            `coverage : identifiant inconnu renvoyé par le modèle : ${item.exigence_id}`,
          );
          continue;
        }
        const detail = item.controles
          .filter((c) => c.couverture !== 'nulle')
          .filter((c) => {
            if (byControle.has(c.controle_id)) return true;
            addWarning(
              run,
              `coverage : ${e.id} cite un contrôle inconnu ${c.controle_id} (ignoré)`,
            );
            return false;
          })
          .map((c) => ({ controle_id: c.controle_id, couverture: c.couverture, ecart: c.ecart }));
        const couverture = normalizeStatut(item.statut_global, detail, byControle);
        summary.statuts[couverture] = (summary.statuts[couverture] ?? 0) + 1;
        updated.push({
          ...e,
          couverture,
          couverture_detail: detail,
          couverture_justification: item.justification,
          controles_ids: detail.map((d) => d.controle_id),
          run_id: run.id,
        });
      }
    }
    for (const e of exigences)
      if (!updated.some((u) => u.id === e.id))
        addWarning(run, `coverage : ${e.id} absente de la réponse du modèle`);
    store.exigences.upsertMany(updated);

    // Liens inverses et écarts agrégés côté contrôles.
    const allExigences = store.exigences.readAll();
    const refreshed = controles.map((c) => {
      const linked = allExigences.filter((e) => e.controles_ids.includes(c.id));
      const ecarts = linked.flatMap((e) =>
        e.couverture_detail
          .filter((d) => d.controle_id === c.id && d.ecart)
          .map((d) => `${e.id} : ${d.ecart}`),
      );
      return {
        ...c,
        exigences_ids: linked.map((e) => e.id),
        ecart_constate: ecarts.length > 0 ? ecarts.join(' | ') : null,
        run_id: run.id,
      };
    });
    store.controles.writeAll(refreshed);
    addCount(run, 'exigences_couverture', updated.length);
    run.log.info(summary, 'Analyse de couverture terminée');
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
