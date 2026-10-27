import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CostTracker } from '../llm/cost.js';
import { ensureDir, readJson, writeJsonAtomic } from '../utils/fs.js';
import { childLogger, type Logger } from '../utils/logger.js';
import { paths } from '../utils/paths.js';

export interface RunMetrics {
  run_id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'ok' | 'error';
  llm: {
    calls: number;
    cached_calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number | null;
    model: string | null;
  };
  counts: Record<string, number>;
  warnings: string[];
  error: string | null;
}

export interface RunContext {
  id: string;
  kind: string;
  dir: string;
  startedAt: Date;
  log: Logger;
  costTracker: CostTracker;
  counts: Record<string, number>;
  warnings: string[];
  model: string | null;
}

function pad(n: number, length = 2): string {
  return String(n).padStart(length, '0');
}

export function formatRunId(date: Date): string {
  return `RUN-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Crée un run (`RUN-AAAAMMJJ-HHMM`, suffixe numérique si collision) et son dossier d'artefacts. */
export function createRun(kind: string): RunContext {
  const startedAt = new Date();
  const base = formatRunId(startedAt);
  let id = base;
  let suffix = 2;
  while (existsSync(paths.runs(id))) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  const dir = paths.runs(id);
  ensureDir(dir);
  const run: RunContext = {
    id,
    kind,
    dir,
    startedAt,
    log: childLogger({ run_id: id }),
    costTracker: new CostTracker(),
    counts: {},
    warnings: [],
    model: null,
  };
  writeJsonAtomic(path.join(dir, 'metrics.json'), buildMetrics(run, 'running', null));
  return run;
}

export function addCount(run: RunContext, key: string, delta = 1): void {
  run.counts[key] = (run.counts[key] ?? 0) + delta;
}

export function addWarning(run: RunContext, message: string): void {
  run.warnings.push(message);
  run.log.warn(message);
}

function buildMetrics(
  run: RunContext,
  status: RunMetrics['status'],
  error: string | null,
): RunMetrics {
  const finished = status === 'running' ? null : new Date();
  const summary = run.costTracker.summary();
  return {
    run_id: run.id,
    kind: run.kind,
    started_at: run.startedAt.toISOString(),
    finished_at: finished ? finished.toISOString() : null,
    duration_ms: finished ? finished.getTime() - run.startedAt.getTime() : null,
    status,
    llm: {
      calls: summary.calls,
      cached_calls: summary.cachedCalls,
      input_tokens: summary.inputTokens,
      output_tokens: summary.outputTokens,
      cost_usd: summary.costUsd,
      model: run.model,
    },
    counts: { ...run.counts },
    warnings: [...run.warnings],
    error,
  };
}

/** Clôture le run et écrit `metrics.json`. */
export function finishRun(run: RunContext, status: 'ok' | 'error', error?: unknown): RunMetrics {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  const metrics = buildMetrics(run, status, message);
  writeJsonAtomic(path.join(run.dir, 'metrics.json'), metrics);
  run.log.info(
    {
      status,
      duration_ms: metrics.duration_ms,
      llm_calls: metrics.llm.calls,
      cost_usd: metrics.llm.cost_usd,
      counts: metrics.counts,
    },
    `Run ${run.id} terminé`,
  );
  return metrics;
}

/** Écrit un artefact JSON dans le dossier du run. */
export function writeRunArtifact(run: RunContext, name: string, value: unknown): string {
  const file = path.join(run.dir, name);
  writeJsonAtomic(file, value);
  return file;
}

/** Métriques du dernier run (par date de début), ou `undefined` s'il n'y en a aucun. */
export function latestRun(): RunMetrics | undefined {
  const root = paths.runs();
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('RUN-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of dirs) {
    const file = path.join(root, name, 'metrics.json');
    if (existsSync(file)) return readJson<RunMetrics>(file);
  }
  return undefined;
}

export function listRuns(limit = 20): RunMetrics[] {
  const root = paths.runs();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('RUN-'))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit)
    .flatMap((name) => {
      const file = path.join(root, name, 'metrics.json');
      return existsSync(file) ? [readJson<RunMetrics>(file)] : [];
    });
}
