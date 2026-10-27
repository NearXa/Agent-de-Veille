import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { ApplicabiliteSchema, type Applicabilite } from '../schemas/analyse.js';
import { store } from '../store/repository.js';
import { addCount, createRun, finishRun, writeRunArtifact, type RunContext } from '../store/run.js';
import type { StructuredCaller } from './extract.js';
import {
  formatArticles,
  organisationProfile,
  requireTexte,
  transversalArticles,
} from './shared.js';

export interface ApplicabilityOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
}

export interface ApplicabilityResult {
  texte_id: string;
  run_id: string;
  applicabilite: Applicabilite;
  applicable: 'Oui' | 'Non' | 'À déterminer';
}

const LABELS: Record<Applicabilite['applicable'], ApplicabilityResult['applicable']> = {
  oui: 'Oui',
  non: 'Non',
  indetermine: 'À déterminer',
};

/** Étape applicabilité : article de champ d'application + définitions confrontés au profil de l'organisation. */
export async function assessApplicability(
  options: ApplicabilityOptions,
): Promise<ApplicabilityResult> {
  const run = options.run ?? createRun('applicability');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const { champ, definitions, entree } = transversalArticles(texte);
    const articles = Array.from(new Set([...champ, ...definitions, ...entree]));
    const prompt = loadPrompt('applicabilite');
    const rendered = renderPrompt(prompt.template, {
      titre_texte: texte.titre,
      reference: texte.reference,
      url: texte.url_officielle,
      organisation: organisationProfile(),
      articles: formatArticles(articles),
    });
    const result = await llm({
      schema: ApplicabiliteSchema,
      schemaName: 'Applicabilite',
      instructions: prompt.instructions,
      prompt: rendered,
      promptVersion: prompt.version,
      run,
      label: `applicabilite ${texte.id}`,
      useCache: options.useCache,
    });
    const applicable = LABELS[result.output.applicable];
    store.textes.upsert({
      ...texte,
      applicable,
      justification_applicabilite: result.output.justification,
      confiance_applicabilite: result.output.confiance,
      resume: result.output.resume,
    });
    writeRunArtifact(run, `applicabilite-${texte.id}.json`, {
      articles: articles.map((a) => a.numero),
      prompt: rendered,
      output: result.output,
      usage: result.usage,
      cached: result.cached,
    });
    addCount(run, 'applicabilite_evaluee', 1);
    run.log.info(
      { texte_id: texte.id, applicable, confiance: result.output.confiance },
      'Applicabilité évaluée',
    );
    if (!options.run) finishRun(run, 'ok');
    return { texte_id: texte.id, run_id: run.id, applicabilite: result.output, applicable };
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
