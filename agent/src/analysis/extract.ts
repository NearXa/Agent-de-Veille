import { loadOrganisation } from '../config/schemas.js';
import {
  generateStructured,
  type StructuredCallOptions,
  type StructuredCallResult,
} from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import { ExtractionResultSchema, type ExigenceExtraite } from '../schemas/exigence.js';
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
import type { Echeance, ExigenceRecord, TexteRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { normalizeForMatch } from '../utils/text.js';
import { buildChunks, selectArticles, type Chunk } from './chunking.js';
import { computeConfidence } from './confidence.js';
import {
  articleUrl,
  normalizeArticleRef,
  parseArticleNumber,
  verifyArticles,
  verifyVerbatim,
} from './verify.js';

export type StructuredCaller = <T>(
  options: StructuredCallOptions<T>,
) => Promise<StructuredCallResult<T>>;

export interface ExtractOptions {
  texteId: string;
  /** Plage d'articles, ex. « 5-16 » ; tout le texte sinon. */
  articles?: string;
  dryRun?: boolean;
  useCache?: boolean;
  maxTokens?: number;
  run?: RunContext;
  /** Injection pour les tests (record / replay) ; `generateStructured` par défaut. */
  llm?: StructuredCaller;
}

export interface ExtractSummary {
  texte_id: string;
  run_id: string;
  dry_run: boolean;
  chunks: { id: string; articles: string[]; tokens_estimes: number }[];
  exigences_total: number;
  exigences_nouvelles: number;
  exigences_mises_a_jour: number;
  exigences_fusionnees: number;
  verifiees: number;
  non_verifiees: number;
  tokens: { input: number; output: number };
  cost_usd: number | null;
  cached_calls: number;
  avertissements: string[];
}

interface Candidate {
  extraite: ExigenceExtraite;
  chunk_id: string;
  key: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function organisationSummary(): string {
  try {
    const org = loadOrganisation().organisation;
    const statuts = org.statuts_reglementaires.slice(0, 3).join(' ; ');
    return `${org.nom} (${org.secteur}, ${org.effectif} salariés, ${org.pays})${statuts ? ` : ${statuts}` : ''}`;
  } catch {
    return 'non renseignée';
  }
}

/** Clé métier d'une exigence : texte, articles normalisés triés, titre normalisé. */
export function exigenceKey(texteId: string, articles: string[], titre: string): string {
  const refs = Array.from(new Set(articles.map(normalizeArticleRef)))
    .sort()
    .join(';');
  return IdRegistry.makeKey('EX', [texteId, refs, titre]);
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .filter((t) => t.length > 2),
  );
}

/** Similarité de Dice entre deux titres (ensembles de mots normalisés). */
export function titleSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const t of sa) if (sb.has(t)) common += 1;
  return (2 * common) / (sa.size + sb.size);
}

function articleNumbers(refs: string[]): string[] {
  return Array.from(
    new Set(refs.map(parseArticleNumber).filter((n): n is string => n !== null)),
  ).sort();
}

/** Retrouve une exigence existante du même texte, mêmes articles et titre très proche. */
export function findSimilarExisting(
  existing: ExigenceRecord[],
  texteId: string,
  articles: string[],
  titre: string,
  threshold = 0.75,
): ExigenceRecord | undefined {
  const numbers = articleNumbers(articles).join(',');
  let best: { record: ExigenceRecord; score: number } | undefined;
  for (const record of existing) {
    if (record.texte_id !== texteId) continue;
    if (articleNumbers(record.articles).join(',') !== numbers) continue;
    const score = titleSimilarity(record.titre, titre);
    if (score >= threshold && (!best || score > best.score)) best = { record, score };
  }
  return best?.record;
}

/** Fusionne deux extractions de même clé : garde la plus confiante, complète les champs vides. */
function mergeCandidates(a: Candidate, b: Candidate): Candidate {
  const [keep, other] = a.extraite.confiance >= b.extraite.confiance ? [a, b] : [b, a];
  return {
    ...keep,
    extraite: {
      ...keep.extraite,
      destinataires: Array.from(
        new Set([...keep.extraite.destinataires, ...other.extraite.destinataires]),
      ),
      echeance: keep.extraite.echeance ?? other.extraite.echeance,
      sanction: keep.extraite.sanction ?? other.extraite.sanction,
    },
  };
}

/** Cherche, parmi les candidates du run, une exigence de mêmes articles et de titre très proche. */
function findSimilarCandidateKey(
  candidates: Map<string, Candidate>,
  extraite: ExigenceExtraite,
): string | undefined {
  const numbers = articleNumbers(extraite.articles).join(',');
  let best: { key: string; score: number } | undefined;
  for (const [key, candidate] of candidates) {
    if (articleNumbers(candidate.extraite.articles).join(',') !== numbers) continue;
    const score = titleSimilarity(candidate.extraite.titre, extraite.titre);
    if (score >= 0.75 && (!best || score > best.score)) best = { key, score };
  }
  return best?.key;
}

function sanitizeEcheance(e: ExigenceExtraite['echeance'], warnings: string[]): Echeance | null {
  if (!e) return null;
  let date = e.date;
  if (date !== null && !ISO_DATE.test(date)) {
    warnings.push(
      `Échéance non ISO ignorée : « ${date} » (source ${e.texte_source ?? 'non précisée'})`,
    );
    date = null;
  }
  return { date, type: e.type, texte_source: e.texte_source };
}

/** Réapplique les corrections humaines (statut « Corrigée ») sur une extraction fraîche. */
export function applyCorrections(
  record: ExigenceRecord,
  corrections: Record<string, unknown> | null,
): ExigenceRecord {
  if (!corrections) return record;
  const out = { ...record };
  if (typeof corrections.titre === 'string') out.titre = corrections.titre;
  if (typeof corrections.description === 'string') out.description = corrections.description;
  if (Array.isArray(corrections.articles)) out.articles = corrections.articles.map(String);
  if (Array.isArray(corrections.destinataires))
    out.destinataires = corrections.destinataires.map(String);
  if (typeof corrections.type_obligation === 'string') {
    const parsed = ExtractionResultSchema.shape.exigences.element.shape.type_obligation.safeParse(
      corrections.type_obligation,
    );
    if (parsed.success) out.type_obligation = parsed.data;
  }
  if ('echeance' in corrections) {
    const value = corrections.echeance;
    if (value === null) out.echeance = null;
    else if (typeof value === 'string' && ISO_DATE.test(value)) {
      out.echeance = {
        date: value,
        type: out.echeance?.type ?? 'Non précisée',
        texte_source: out.echeance?.texte_source ?? null,
      };
    }
  }
  return out;
}

function buildRecord(
  candidate: Candidate,
  id: string,
  texte: TexteRecord,
  existing: ExigenceRecord | undefined,
  runId: string,
): ExigenceRecord {
  const e = candidate.extraite;
  const warnings: string[] = [];
  const refs = e.articles.map((a) => a.trim()).filter((a) => a.length > 0);
  const articleCheck = verifyArticles(refs, texte.articles);
  const verbatimCheck = verifyVerbatim(e.extrait_verbatim, texte.articles, articleCheck.numeros);
  if (!articleCheck.ok) {
    warnings.push(
      articleCheck.manquants.length > 0
        ? `Article(s) non retrouvé(s) dans le texte : ${articleCheck.manquants.join(', ')}`
        : 'Aucun article valide cité',
    );
  }
  if (!verbatimCheck.ok) warnings.push('Extrait verbatim non retrouvé dans le texte source');
  else if (!verbatimCheck.dans_articles_cites)
    warnings.push('Extrait verbatim retrouvé hors des articles cités');

  const detail = {
    llm: e.confiance,
    verbatim_retrouve: verbatimCheck.ok ? 1 : 0,
    article_existe: articleCheck.ok ? 1 : 0,
  } as const;
  const confiance = computeConfidence(detail);
  const firstArticle = articleCheck.numeros[0];
  const record: ExigenceRecord = {
    id,
    texte_id: texte.id,
    titre: e.titre.trim(),
    description: e.description.trim(),
    articles: refs,
    extrait_verbatim: e.extrait_verbatim.trim(),
    url_article: firstArticle ? articleUrl(texte, firstArticle) : texte.url_officielle,
    verifie_dans_source: articleCheck.ok && verbatimCheck.ok,
    type_obligation: e.type_obligation,
    destinataires: e.destinataires.map((d) => d.trim()).filter((d) => d.length > 0),
    echeance: sanitizeEcheance(e.echeance, warnings),
    sanction: e.sanction
      ? {
          description: e.sanction.description,
          niveau: e.sanction.niveau,
          article: e.sanction.article,
        }
      : null,
    confiance,
    confiance_detail: detail,
    justification_confiance: e.justification_confiance || null,
    statut_validation: existing?.statut_validation ?? 'À valider',
    validateur: existing?.validateur ?? null,
    date_validation: existing?.date_validation ?? null,
    commentaire_validation: existing?.commentaire_validation ?? null,
    version_corrigee: existing?.version_corrigee ?? null,
    processus_impactes: existing?.processus_impactes ?? [],
    systemes_impactes: existing?.systemes_impactes ?? [],
    donnees_concernees: existing?.donnees_concernees ?? [],
    contrats_concernes: existing?.contrats_concernes ?? [],
    departements_impactes: existing?.departements_impactes ?? [],
    effort_estime: existing?.effort_estime ?? null,
    impact_justification: existing?.impact_justification ?? null,
    couverture: existing?.couverture ?? 'À évaluer',
    couverture_detail: existing?.couverture_detail ?? [],
    couverture_justification: existing?.couverture_justification ?? null,
    lot_propose: existing?.lot_propose ?? null,
    controles_ids: existing?.controles_ids ?? [],
    risques_ids: existing?.risques_ids ?? [],
    jurisprudence_ids: existing?.jurisprudence_ids ?? [],
    lots_ids: existing?.lots_ids ?? [],
    run_id: runId,
    chunk_id: candidate.chunk_id,
    avertissements: warnings,
    revalidation_motif:
      existing?.statut_validation === 'À revalider' ? (existing.revalidation_motif ?? null) : null,
  };
  return existing?.statut_validation === 'Corrigée'
    ? applyCorrections(record, existing.version_corrigee)
    : record;
}

/** Étapes 2 et 3 du parcours : extraction par chunks, fusion, vérification, confiance, IDs stables. */
export async function extractExigences(options: ExtractOptions): Promise<ExtractSummary> {
  const run = options.run ?? createRun('extract');
  const log = run.log;
  const llm = options.llm ?? generateStructured;
  try {
    const texte = store.textes.findById(options.texteId);
    if (!texte)
      throw new AppError(
        `Texte ${options.texteId} introuvable dans ${store.textes.file} : lancer ingest d'abord.`,
      );

    const selected = selectArticles(texte.articles, options.articles);
    const chunks: Chunk[] = buildChunks(selected, {
      texteId: texte.id,
      maxTokens: options.maxTokens,
    });
    const chunkSummary = chunks.map((c) => ({
      id: c.id,
      articles: c.articles.map((a) => a.numero),
      tokens_estimes: c.tokens_estimes,
    }));
    log.info(
      {
        texte_id: texte.id,
        articles: selected.length,
        chunks: chunks.length,
        tokens_estimes: chunks.reduce((s, c) => s + c.tokens_estimes, 0),
      },
      'Articles sélectionnés et découpés en chunks',
    );
    writeRunArtifact(run, 'chunks.json', chunkSummary);
    addCount(run, 'chunks', chunks.length);

    const summary: ExtractSummary = {
      texte_id: texte.id,
      run_id: run.id,
      dry_run: Boolean(options.dryRun),
      chunks: chunkSummary,
      exigences_total: 0,
      exigences_nouvelles: 0,
      exigences_mises_a_jour: 0,
      exigences_fusionnees: 0,
      verifiees: 0,
      non_verifiees: 0,
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      cached_calls: 0,
      avertissements: [],
    };
    if (options.dryRun) {
      log.info('Mode dry-run : aucun appel au modèle');
      if (!options.run) finishRun(run, 'ok');
      return summary;
    }

    const prompt = loadPrompt('extraction');
    const organisation = organisationSummary();
    const candidates = new Map<string, Candidate>();
    let unknownPricing = false;

    for (const chunk of chunks) {
      const rendered = renderPrompt(prompt.template, {
        titre_texte: texte.titre,
        reference: texte.reference,
        url: texte.url_officielle,
        texte_id: texte.id,
        chunk_id: chunk.id,
        liste_articles: chunk.articles.map((a) => a.numero).join(', '),
        organisation,
        chunk: chunk.texte,
      });
      const result = await llm({
        schema: ExtractionResultSchema,
        schemaName: 'ExtractionResult',
        instructions: prompt.instructions,
        prompt: rendered,
        promptVersion: prompt.version,
        run,
        label: chunk.id,
        useCache: options.useCache,
      });
      summary.tokens.input += result.usage.inputTokens;
      summary.tokens.output += result.usage.outputTokens;
      if (result.cached) summary.cached_calls += 1;
      if (result.costUsd === null) unknownPricing = true;
      else summary.cost_usd = (summary.cost_usd ?? 0) + result.costUsd;
      writeRunArtifact(run, `extract-${chunk.id}.json`, {
        prompt_version: prompt.version,
        cached: result.cached,
        attempts: result.attempts,
        usage: result.usage,
        warnings: result.warnings,
        prompt: rendered,
        output: result.output,
      });
      for (const warning of result.output.avertissements)
        addWarning(run, `[${chunk.id}] ${warning}`);
      for (const extraite of result.output.exigences) {
        const key = exigenceKey(texte.id, extraite.articles, extraite.titre);
        const candidate: Candidate = { extraite, chunk_id: chunk.id, key };
        const previousKey = candidates.has(key)
          ? key
          : findSimilarCandidateKey(candidates, extraite);
        if (previousKey) {
          candidates.set(previousKey, {
            ...mergeCandidates(candidates.get(previousKey)!, candidate),
            key: previousKey,
          });
          summary.exigences_fusionnees += 1;
        } else {
          candidates.set(key, candidate);
        }
      }
      log.info(
        { chunk: chunk.id, exigences: result.output.exigences.length, cached: result.cached },
        'Chunk extrait',
      );
    }
    if (unknownPricing) summary.cost_usd = null;

    const registry = IdRegistry.load();
    const existingAll = store.exigences.readAll();
    const records: ExigenceRecord[] = [];
    for (const candidate of candidates.values()) {
      let id = registry.lookup(candidate.key);
      if (!id) {
        const similar = findSimilarExisting(
          existingAll,
          texte.id,
          candidate.extraite.articles,
          candidate.extraite.titre,
        );
        if (similar) {
          registry.alias(candidate.key, similar.id);
          id = similar.id;
        }
      }
      const resolved = id ? { id, created: false } : registry.resolve('EX', candidate.key);
      const existing = existingAll.find((r) => r.id === resolved.id);
      const record = buildRecord(candidate, resolved.id, texte, existing, run.id);
      records.push(record);
      if (existing) summary.exigences_mises_a_jour += 1;
      else summary.exigences_nouvelles += 1;
      if (record.verifie_dans_source) summary.verifiees += 1;
      else {
        summary.non_verifiees += 1;
        addWarning(
          run,
          `${record.id} non vérifiée dans la source : ${record.avertissements.join(' ; ')}`,
        );
      }
    }
    records.sort((a, b) => a.id.localeCompare(b.id));
    store.exigences.upsertMany(records);
    registry.save();

    summary.exigences_total = records.length;
    summary.avertissements = [...run.warnings];
    addCount(run, 'exigences', records.length);
    addCount(run, 'exigences_nouvelles', summary.exigences_nouvelles);
    addCount(run, 'exigences_verifiees', summary.verifiees);
    writeRunArtifact(run, 'extract-summary.json', summary);
    log.info(
      {
        exigences: records.length,
        nouvelles: summary.exigences_nouvelles,
        verifiees: summary.verifiees,
        cost_usd: summary.cost_usd,
      },
      'Extraction terminée',
    );
    if (!options.run) finishRun(run, 'ok');
    return summary;
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
