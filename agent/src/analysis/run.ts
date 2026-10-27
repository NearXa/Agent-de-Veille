import { generateMatrices } from '../matrices/index.js';
import { createRun, finishRun, type RunContext } from '../store/run.js';
import { AppError } from '../utils/errors.js';
import { assessApplicability } from './applicability.js';
import { analyseCoverage } from './coverage.js';
import { enrichExigences } from './enrich.js';
import { extractExigences, type StructuredCaller } from './extract.js';
import { analyseImpact } from './impact.js';
import { analyseJurisprudence } from './jurisprudence.js';
import { analyseRisks } from './risks.js';

export const PIPELINE_STEPS = [
  'applicability',
  'extract',
  'enrich',
  'jurisprudence',
  'impact',
  'coverage',
  'risks',
  'matrices',
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface RunPipelineOptions {
  texteId: string;
  articles?: string;
  force?: boolean;
  steps?: PipelineStep[];
  useCache?: boolean;
  llm?: StructuredCaller;
  run?: RunContext;
}

export interface StepResult {
  step: PipelineStep;
  statut: 'ok' | 'arret' | 'ignoree';
  detail: string;
  duree_ms: number;
}

export interface RunPipelineSummary {
  texte_id: string;
  run_id: string;
  steps: StepResult[];
  arret: string | null;
}

export function parseSteps(value: string | undefined): PipelineStep[] {
  if (!value) return [...PIPELINE_STEPS];
  const steps = value.split(',').map((s) => s.trim().toLowerCase());
  for (const s of steps) {
    if (!PIPELINE_STEPS.includes(s as PipelineStep))
      throw new AppError(`Étape inconnue : ${s} (attendu : ${PIPELINE_STEPS.join(', ')})`);
  }
  return PIPELINE_STEPS.filter((s) => steps.includes(s));
}

/** `pnpm agent run` : enchaîne les étapes d'analyse ; s'arrête si le texte n'est pas applicable (sauf --force). */
export async function runPipeline(options: RunPipelineOptions): Promise<RunPipelineSummary> {
  const run = options.run ?? createRun('run');
  const steps = options.steps ?? [...PIPELINE_STEPS];
  const summary: RunPipelineSummary = {
    texte_id: options.texteId,
    run_id: run.id,
    steps: [],
    arret: null,
  };
  const common = { texteId: options.texteId, run, llm: options.llm, useCache: options.useCache };
  const record = (
    step: PipelineStep,
    started: number,
    statut: StepResult['statut'],
    detail: string,
  ): void => {
    summary.steps.push({ step, statut, detail, duree_ms: Date.now() - started });
  };
  try {
    for (const step of steps) {
      const started = Date.now();
      switch (step) {
        case 'applicability': {
          const r = await assessApplicability(common);
          const stop = r.applicable !== 'Oui' && !options.force;
          record(
            step,
            started,
            stop ? 'arret' : 'ok',
            `${r.applicable} (confiance ${r.applicabilite.confiance})`,
          );
          if (stop) {
            summary.arret = `Texte ${r.applicable.toLowerCase()} applicable : pipeline arrêté (utiliser --force pour poursuivre)`;
            run.log.warn(summary.arret);
          }
          break;
        }
        case 'extract': {
          const r = await extractExigences({ ...common, articles: options.articles });
          record(
            step,
            started,
            'ok',
            `${r.exigences_total} exigence(s), ${r.verifiees} vérifiée(s), ${r.chunks.length} chunk(s)`,
          );
          break;
        }
        case 'enrich': {
          const r = await enrichExigences(common);
          record(
            step,
            started,
            'ok',
            `${r.echeances_renseignees} échéance(s), ${r.sanctions_renseignees} sanction(s) sur ${r.exigences}`,
          );
          break;
        }
        case 'jurisprudence': {
          const r = await analyseJurisprudence(common);
          record(
            step,
            started,
            r.ignoree ? 'ignoree' : 'ok',
            r.ignoree
              ? 'aucune source de jurisprudence disponible'
              : `${r.decisions_retenues} décision(s) retenue(s) sur ${r.candidates} candidate(s)`,
          );
          break;
        }
        case 'impact': {
          const r = await analyseImpact(common);
          record(
            step,
            started,
            'ok',
            `${r.exigences} exigence(s), efforts ${JSON.stringify(r.efforts)}`,
          );
          break;
        }
        case 'coverage': {
          const r = await analyseCoverage(common);
          record(step, started, 'ok', `statuts ${JSON.stringify(r.statuts)}`);
          break;
        }
        case 'risks': {
          const r = await analyseRisks(common);
          record(
            step,
            started,
            'ok',
            `${r.risques} risque(s), niveaux ${JSON.stringify(r.niveaux)}`,
          );
          break;
        }
        case 'matrices': {
          const r = await generateMatrices({ texteId: options.texteId, runId: run.id });
          record(
            step,
            started,
            'ok',
            `${r.files.length} fichier(s) : ${r.files.map((f) => `${f.matrice}.${f.format}`).join(', ')}`,
          );
          break;
        }
      }
      if (summary.arret) break;
    }
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
