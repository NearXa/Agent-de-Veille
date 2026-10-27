import { loadRisques } from '../config/schemas.js';
import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { buildRisqueBatchSchema } from '../schemas/analyse.js';
import { IdRegistry } from '../store/ids.js';
import { store } from '../store/repository.js';
import {
  addCount,
  addWarning,
  createRun,
  finishRun,
  writeRunArtifact,
  type RunContext,
} from '../store/run.js';
import type { RisqueRecord } from '../store/types.js';
import type { StructuredCaller } from './extract.js';
import { computeResidual, defaultOwner } from './residual.js';
import {
  chunkArray,
  exigenceLine,
  exigencesOfTexte,
  organisationShort,
  registryKeyForRisque,
  requireTexte,
} from './shared.js';

export interface RisksOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
  batchSize?: number;
}

export interface RisksSummary {
  texte_id: string;
  run_id: string;
  exigences_a_risque: number;
  risques: number;
  appels: number;
  niveaux: Record<string, number>;
}

/** Étape risques : un scénario par exigence non couverte ou partielle, résiduel calculé par code. */
export async function analyseRisks(options: RisksOptions): Promise<RisksSummary> {
  const run = options.run ?? createRun('risks');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const grille = loadRisques();
    const exigences = exigencesOfTexte(texte.id).filter(
      (e) => e.couverture === 'Non couverte' || e.couverture === 'Partielle',
    );
    const controles = new Map(store.controles.readAll().map((c) => [c.id, c] as const));
    const schema = buildRisqueBatchSchema(grille);
    const prompt = loadPrompt('risques');
    const registry = IdRegistry.load();
    const existing = new Map(store.risques.readAll().map((r) => [r.id, r] as const));
    const byId = new Map(exigences.map((e) => [e.id, e] as const));
    const summary: RisksSummary = {
      texte_id: texte.id,
      run_id: run.id,
      exigences_a_risque: exigences.length,
      risques: 0,
      appels: 0,
      niveaux: {},
    };
    if (exigences.length === 0) {
      addWarning(
        run,
        `${texte.id} : aucune exigence non couverte ou partielle (lancer coverage d'abord ?)`,
      );
      if (!options.run) finishRun(run, 'ok');
      return summary;
    }
    const records: RisqueRecord[] = [];
    for (const batch of chunkArray(exigences, options.batchSize ?? 15)) {
      const label = `risks ${batch[0]!.id}-${batch[batch.length - 1]!.id}`;
      const rendered = renderPrompt(prompt.template, {
        organisation: organisationShort(),
        grille_probabilite: Object.entries(grille.probabilite)
          .map(([k, v]) => `${k} = ${v.libelle}${v.description ? ` (${v.description})` : ''}`)
          .join(' ; '),
        grille_impact: Object.entries(grille.impact)
          .map(([k, v]) => `${k} = ${v.libelle}${v.description ? ` (${v.description})` : ''}`)
          .join(' ; '),
        categories: grille.categories.join(' | '),
        traitements: grille.traitements.join(' | '),
        exigences: batch
          .map((e) => exigenceLine(e, { description: true, couverture: true }))
          .join('\n'),
      });
      const result = await llm({
        schema,
        schemaName: 'RisqueBatch',
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
      for (const item of result.output.risques) {
        const e = byId.get(item.exigence_id);
        if (!e) {
          addWarning(
            run,
            `risks : identifiant inconnu renvoyé par le modèle : ${item.exigence_id}`,
          );
          continue;
        }
        const attenuants = e.couverture_detail
          .map((d) => d.controle_id)
          .filter((id) => controles.has(id));
        const residual = computeResidual(
          item.probabilite,
          item.impact,
          attenuants.map((id) => controles.get(id)!),
          grille,
        );
        const { id } = registry.resolve('RK', registryKeyForRisque(e.id));
        const previous = existing.get(id);
        records.push({
          id,
          exigence_id: e.id,
          intitule: item.intitule,
          scenario: item.scenario,
          categorie: item.categorie as RisqueRecord['categorie'],
          probabilite: item.probabilite,
          impact: item.impact,
          criticite_brute: residual.criticite_brute,
          justification_scores: item.justification_scores,
          controles_attenuants: attenuants,
          risque_residuel: residual.risque_residuel,
          niveau_residuel: residual.niveau_residuel,
          traitement: item.traitement_propose as RisqueRecord['traitement'],
          proprietaire: previous?.proprietaire ?? defaultOwner(item.categorie),
          statut: previous?.statut ?? 'Identifié',
          lots_ids: previous?.lots_ids ?? [],
          run_id: run.id,
        });
        summary.niveaux[residual.niveau_residuel] =
          (summary.niveaux[residual.niveau_residuel] ?? 0) + 1;
      }
    }
    store.risques.upsertMany(records);
    registry.save();
    // Liens exigences → risques et contrôles → risques.
    const byExigence = new Map<string, string[]>();
    for (const r of records)
      byExigence.set(r.exigence_id, [...(byExigence.get(r.exigence_id) ?? []), r.id]);
    store.exigences.upsertMany(
      exigences
        .filter((e) => byExigence.has(e.id))
        .map((e) => ({ ...e, risques_ids: byExigence.get(e.id)! })),
    );
    const allRisques = store.risques.readAll();
    store.controles.writeAll(
      store.controles.readAll().map((c) => ({
        ...c,
        risques_ids: allRisques
          .filter((r) => r.controles_attenuants.includes(c.id))
          .map((r) => r.id),
      })),
    );
    summary.risques = records.length;
    addCount(run, 'risques', records.length);
    run.log.info(summary, 'Analyse des risques terminée');
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
