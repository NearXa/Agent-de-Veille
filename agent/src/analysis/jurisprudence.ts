import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { loadSources } from '../config/schemas.js';
import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { JurisprudenceMatchBatchSchema, JurisprudenceRequetesSchema } from '../schemas/analyse.js';
import { HttpClient } from '../sources/http.js';
import { JURIDICTION_LABELS, JudilibreClient, judilibreDecisionUrl } from '../sources/judilibre.js';
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
import type { ExigenceRecord, JurisprudenceRecord } from '../store/types.js';
import { paths } from '../utils/paths.js';
import { normalizeForMatch, truncate } from '../utils/text.js';
import type { StructuredCaller } from './extract.js';
import { chunkArray, exigenceLine, exigencesOfTexte, requireTexte } from './shared.js';

export interface DecisionCandidate {
  id: string;
  juridiction: JurisprudenceRecord['juridiction'];
  numero: string;
  date: string | null;
  url: string;
  resume: string;
  extraits: string[];
  mots_cles: string[];
  source: JurisprudenceRecord['source'];
}

export interface JurisprudenceSource {
  readonly id: string;
  search(queries: string[], limit: number): Promise<DecisionCandidate[]>;
}

function juridictionLabel(code: string | undefined): JurisprudenceRecord['juridiction'] {
  const label = JURIDICTION_LABELS[code ?? ''];
  if (label === 'Cour de cassation' || label === "Cour d'appel") return label;
  return 'Autre';
}

/** Source Judilibre (PISTE) : une recherche par requête, candidats dédupliqués. */
export class JudilibreSource implements JurisprudenceSource {
  readonly id = 'judilibre';
  constructor(
    private readonly client: JudilibreClient,
    private readonly juridictions: string[] = ['cc'],
  ) {}

  async search(queries: string[], limit: number): Promise<DecisionCandidate[]> {
    const seen = new Map<string, DecisionCandidate>();
    for (const query of queries) {
      const res = await this.client.search({
        query,
        jurisdictions: this.juridictions,
        pageSize: 5,
        sort: 'scorepub',
      });
      for (const hit of res.results ?? []) {
        if (seen.has(hit.id)) continue;
        seen.set(hit.id, {
          id: hit.id,
          juridiction: juridictionLabel(hit.jurisdiction),
          numero: hit.number ?? hit.numbers?.[0] ?? hit.id,
          date: hit.decision_date ?? null,
          url: judilibreDecisionUrl(hit.id),
          resume: hit.summary ?? '',
          extraits: Object.values(hit.highlights ?? {})
            .flat()
            .map((h) => h.replace(/<\/?em>/g, '')),
          mots_cles: hit.themes ?? [],
          source: 'judilibre',
        });
        if (seen.size >= limit) return Array.from(seen.values());
      }
    }
    return Array.from(seen.values());
  }
}

interface LocalDecision {
  id: string;
  juridiction?: string;
  numero?: string;
  date?: string | null;
  url: string;
  resume?: string;
  texte?: string;
  mots_cles?: string[];
}

/**
 * Corpus local : fichiers JSON dans data/sources/jurisprudence/ (une décision par fichier ou un tableau),
 * champs id, juridiction, numero, date, url, resume, texte, mots_cles. Recherche par recouvrement de mots.
 */
export class LocalJurisprudenceSource implements JurisprudenceSource {
  readonly id = 'local-file';
  private readonly decisions: LocalDecision[];

  constructor(dir = paths.sources('jurisprudence')) {
    this.decisions = [];
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as
          LocalDecision | LocalDecision[];
        for (const d of Array.isArray(parsed) ? parsed : [parsed])
          if (d.id && d.url) this.decisions.push(d);
      } catch {
        // fichier illisible : ignoré, signalé par l'appelant via le nombre de décisions
      }
    }
  }

  get size(): number {
    return this.decisions.length;
  }

  async search(queries: string[], limit: number): Promise<DecisionCandidate[]> {
    const terms = new Set(
      queries.flatMap((q) => normalizeForMatch(q).split(' ')).filter((t) => t.length > 3),
    );
    const scored = this.decisions
      .map((d) => {
        const haystack = normalizeForMatch(
          `${d.resume ?? ''} ${d.texte ?? ''} ${(d.mots_cles ?? []).join(' ')}`,
        );
        let score = 0;
        for (const t of terms) if (haystack.includes(t)) score += 1;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map(({ d }) => ({
      id: d.id,
      juridiction:
        (
          ['Cour de cassation', "Conseil d'État", 'CJUE', "Cour d'appel", 'CNIL', 'Autre'] as const
        ).find((j) => j === d.juridiction) ?? 'Autre',
      numero: d.numero ?? d.id,
      date: d.date ?? null,
      url: d.url,
      resume: d.resume ?? truncate(d.texte ?? '', 600),
      extraits: [],
      mots_cles: d.mots_cles ?? [],
      source: 'local-file',
    }));
  }
}

/** Sources disponibles : Judilibre si PISTE_API_KEY, corpus local s'il contient des décisions. */
export function availableSources(log?: RunContext['log']): JurisprudenceSource[] {
  const env = loadEnv();
  const sources: JurisprudenceSource[] = [];
  if (env.PISTE_API_KEY) {
    const config = loadSources().sources.find((s) => s.id === 'judilibre');
    const client = new JudilibreClient(
      env.PISTE_API_KEY,
      new HttpClient({ minIntervalMs: 500, log }),
      config?.env ?? env.PISTE_ENV,
    );
    sources.push(new JudilibreSource(client, config?.juridictions ?? ['cc']));
  }
  const local = new LocalJurisprudenceSource();
  if (local.size > 0) sources.push(local);
  return sources;
}

export interface JurisprudenceOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
  sources?: JurisprudenceSource[];
  seuil?: number;
}

export interface JurisprudenceSummary {
  texte_id: string;
  run_id: string;
  sources: string[];
  exigences: number;
  requetes: number;
  candidates: number;
  decisions_retenues: number;
  appels: number;
  ignoree: boolean;
}

/** Étape jurisprudence : requêtes générées, recherche, notation de pertinence, décisions ≥ seuil conservées. */
export async function analyseJurisprudence(
  options: JurisprudenceOptions,
): Promise<JurisprudenceSummary> {
  const run = options.run ?? createRun('jurisprudence');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const exigences = exigencesOfTexte(texte.id);
    const sources = options.sources ?? availableSources(run.log);
    const summary: JurisprudenceSummary = {
      texte_id: texte.id,
      run_id: run.id,
      sources: sources.map((s) => s.id),
      exigences: exigences.length,
      requetes: 0,
      candidates: 0,
      decisions_retenues: 0,
      appels: 0,
      ignoree: false,
    };
    if (sources.length === 0) {
      summary.ignoree = true;
      addWarning(
        run,
        'jurisprudence : aucune source disponible (PISTE_API_KEY absente et corpus data/sources/jurisprudence/ vide), étape ignorée',
      );
      if (!options.run) finishRun(run, 'ok');
      return summary;
    }
    const seuil = options.seuil ?? 0.5;
    const promptRequetes = loadPrompt('jurisprudence-requetes');
    const promptPertinence = loadPrompt('jurisprudence-pertinence');
    const registry = IdRegistry.load();
    const records = new Map(store.jurisprudence.readAll().map((r) => [r.id, r] as const));
    const byId = new Map(exigences.map((e) => [e.id, e] as const));
    const queries = new Map<string, string[]>();

    for (const batch of chunkArray(exigences, 15)) {
      const rendered = renderPrompt(promptRequetes.template, {
        titre_texte: texte.titre,
        reference: texte.reference,
        exigences: batch.map((e) => exigenceLine(e, { description: true })).join('\n'),
      });
      const result = await llm({
        schema: JurisprudenceRequetesSchema,
        schemaName: 'JurisprudenceRequetes',
        instructions: promptRequetes.instructions,
        prompt: rendered,
        promptVersion: promptRequetes.version,
        run,
        label: `jurisprudence requêtes ${batch[0]!.id}`,
        useCache: options.useCache,
      });
      summary.appels += 1;
      for (const item of result.output.exigences)
        if (byId.has(item.exigence_id)) queries.set(item.exigence_id, item.requetes);
    }
    summary.requetes = Array.from(queries.values()).reduce((n, q) => n + q.length, 0);
    writeRunArtifact(run, `jurisprudence-requetes-${texte.id}.json`, Object.fromEntries(queries));

    const linked: ExigenceRecord[] = [];
    for (const e of exigences) {
      const q = queries.get(e.id);
      if (!q) continue;
      const candidates: DecisionCandidate[] = [];
      for (const source of sources) {
        try {
          candidates.push(...(await source.search(q, 8)));
        } catch (error) {
          addWarning(run, `jurisprudence ${source.id} ${e.id} : ${(error as Error).message}`);
        }
      }
      if (candidates.length === 0) continue;
      summary.candidates += candidates.length;
      const rendered = renderPrompt(promptPertinence.template, {
        exigence_id: e.id,
        titre: e.titre,
        description: e.description,
        articles: e.articles.join(' ; '),
        decisions: candidates
          .map(
            (c) =>
              `- ${c.id} · ${c.juridiction} · ${c.date ?? 'date n/p'} · ${c.numero} · ${truncate(c.resume, 700)}${c.extraits.length ? ` · extraits : ${truncate(c.extraits.join(' / '), 500)}` : ''}`,
          )
          .join('\n'),
      });
      const result = await llm({
        schema: JurisprudenceMatchBatchSchema,
        schemaName: 'JurisprudenceMatchBatch',
        instructions: promptPertinence.instructions,
        prompt: rendered,
        promptVersion: promptPertinence.version,
        run,
        label: `jurisprudence pertinence ${e.id}`,
        useCache: options.useCache,
      });
      summary.appels += 1;
      const retained: string[] = [];
      for (const match of result.output.matches) {
        const candidate = candidates.find((c) => c.id === match.decision_id);
        if (!candidate || match.pertinence < seuil) continue;
        const { id } = registry.resolve(
          'JP',
          IdRegistry.makeKey('JP', [candidate.source, candidate.id]),
        );
        const previous = records.get(id);
        records.set(id, {
          id,
          juridiction: candidate.juridiction,
          numero: candidate.numero,
          date_decision: candidate.date,
          url_officielle: candidate.url,
          resume: match.resume,
          solution_retenue: match.solution_retenue,
          portee: match.portee,
          pertinence: Math.max(match.pertinence, previous?.pertinence ?? 0),
          exigences_ids: Array.from(new Set([...(previous?.exigences_ids ?? []), e.id])),
          mots_cles: candidate.mots_cles,
          source: candidate.source,
          source_id: candidate.id,
          run_id: run.id,
        });
        retained.push(id);
      }
      if (retained.length > 0)
        linked.push({
          ...e,
          jurisprudence_ids: Array.from(new Set([...e.jurisprudence_ids, ...retained])),
        });
    }
    store.jurisprudence.writeAll(Array.from(records.values()));
    if (linked.length > 0) store.exigences.upsertMany(linked);
    registry.save();
    summary.decisions_retenues = records.size;
    addCount(run, 'jurisprudence_decisions', records.size);
    run.log.info(summary, 'Analyse de jurisprudence terminée');
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
