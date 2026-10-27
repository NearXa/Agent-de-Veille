import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { EnrichissementSchema } from '../schemas/analyse.js';
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
  formatArticles,
  requireTexte,
  transversalArticles,
} from './shared.js';

export interface EnrichOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
  batchSize?: number;
}

export interface EnrichSummary {
  texte_id: string;
  run_id: string;
  exigences: number;
  echeances_renseignees: number;
  sanctions_renseignees: number;
  appels: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Étape enrichissement : échéances, sanctions et destinataires complétés depuis les articles transversaux. */
export async function enrichExigences(options: EnrichOptions): Promise<EnrichSummary> {
  const run = options.run ?? createRun('enrich');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const exigences = exigencesOfTexte(texte.id);
    const { definitions, sanctions, entree } = transversalArticles(texte);
    const transversaux = Array.from(new Set([...entree, ...sanctions, ...definitions]));
    if (transversaux.length === 0)
      addWarning(
        run,
        `${texte.id} : aucun article transversal identifié (entrée en vigueur, sanctions, définitions)`,
      );
    const prompt = loadPrompt('enrichissement');
    const byId = new Map(exigences.map((e) => [e.id, e] as const));
    const summary: EnrichSummary = {
      texte_id: texte.id,
      run_id: run.id,
      exigences: exigences.length,
      echeances_renseignees: 0,
      sanctions_renseignees: 0,
      appels: 0,
    };
    const updated: ExigenceRecord[] = [];

    for (const batch of chunkArray(exigences, options.batchSize ?? 15)) {
      const rendered = renderPrompt(prompt.template, {
        titre_texte: texte.titre,
        reference: texte.reference,
        articles: formatArticles(transversaux),
        exigences: batch.map((e) => exigenceLine(e, { echeance: true })).join('\n'),
      });
      const result = await llm({
        schema: EnrichissementSchema,
        schemaName: 'Enrichissement',
        instructions: prompt.instructions,
        prompt: rendered,
        promptVersion: prompt.version,
        run,
        label: `enrich ${batch[0]!.id}-${batch[batch.length - 1]!.id}`,
        useCache: options.useCache,
      });
      summary.appels += 1;
      writeRunArtifact(run, `enrich-${batch[0]!.id}-${batch[batch.length - 1]!.id}.json`, {
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
            `enrich : identifiant inconnu renvoyé par le modèle : ${item.exigence_id}`,
          );
          continue;
        }
        let echeance = e.echeance;
        if (item.echeance && item.echeance.date && ISO_DATE.test(item.echeance.date)) {
          echeance = {
            date: item.echeance.date,
            type: item.echeance.type,
            texte_source: item.echeance.texte_source,
          };
        } else if (item.echeance && !item.echeance.date && !echeance) {
          echeance = {
            date: null,
            type: item.echeance.type,
            texte_source: item.echeance.texte_source,
          };
        }
        if (!echeance?.date && texte.date_entree_en_application) {
          echeance = {
            date: texte.date_entree_en_application,
            type: 'Entrée en application',
            texte_source: echeance?.texte_source ?? "date d'application du texte",
          };
        }
        const sanction = item.sanction
          ? {
              description: item.sanction.description,
              niveau: item.sanction.niveau,
              article: item.sanction.article,
            }
          : e.sanction;
        const destinataires = Array.from(
          new Set([
            ...e.destinataires,
            ...item.destinataires.map((d) => d.trim()).filter((d) => d.length > 0),
          ]),
        );
        updated.push({ ...e, echeance, sanction, destinataires, run_id: run.id });
      }
    }
    const touched = new Set(updated.map((u) => u.id));
    for (const e of exigences) {
      if (!touched.has(e.id)) {
        addWarning(
          run,
          `enrich : ${e.id} absente de la réponse du modèle, échéance par défaut appliquée`,
        );
        updated.push({
          ...e,
          echeance: e.echeance?.date
            ? e.echeance
            : texte.date_entree_en_application
              ? {
                  date: texte.date_entree_en_application,
                  type: 'Entrée en application',
                  texte_source: "date d'application du texte",
                }
              : e.echeance,
        });
      }
    }
    summary.echeances_renseignees = updated.filter((u) => u.echeance?.date).length;
    summary.sanctions_renseignees = updated.filter((u) => u.sanction).length;
    store.exigences.upsertMany(updated);
    addCount(run, 'exigences_enrichies', updated.length);
    run.log.info(summary, 'Enrichissement terminé');
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
