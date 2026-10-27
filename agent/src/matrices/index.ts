import path from 'node:path';
import { store } from '../store/repository.js';
import { latestRun } from '../store/run.js';
import type { ExigenceRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { writeTextAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import { toCsv } from './export/csv.js';
import { toMarkdown } from './export/md.js';
import { writeWorkbook } from './export/xlsx.js';
import { buildM1 } from './m1.js';
import { buildM2, buildM3, buildM4, buildM5 } from './m2-m5.js';
import { MATRIX_DEFINITIONS, type MatrixId, type MatrixTable } from './types.js';

export type MatrixFormat = 'csv' | 'xlsx' | 'md';
export const WORKBOOK_FILE = 'matrices-grc.xlsx';

export interface GenerateMatricesOptions {
  texteId?: string;
  all?: boolean;
  only?: MatrixId[];
  formats?: MatrixFormat[];
  onlyValidated?: boolean;
  outDir?: string;
  runId?: string | null;
}

export interface GeneratedFile {
  matrice: MatrixId;
  format: MatrixFormat;
  file: string;
  rows: number;
}

export interface GenerateMatricesResult {
  files: GeneratedFile[];
  skipped: { matrice: MatrixId; raison: string }[];
  exigences: number;
}

export function parseMatrixIds(value: string | undefined): MatrixId[] {
  if (!value) return ['M1', 'M2', 'M3', 'M4', 'M5'];
  const ids = value.split(',').map((v) => v.trim().toUpperCase());
  for (const id of ids) {
    if (!(id in MATRIX_DEFINITIONS))
      throw new AppError(`Matrice inconnue : ${id} (attendu M1 à M5)`);
  }
  return ids as MatrixId[];
}

export function parseFormats(value: string | undefined): MatrixFormat[] {
  if (!value) return ['csv', 'xlsx', 'md'];
  const formats = value.split(',').map((v) => v.trim().toLowerCase());
  for (const f of formats) {
    if (!['csv', 'xlsx', 'md'].includes(f))
      throw new AppError(`Format inconnu : ${f} (attendu csv, xlsx, md)`);
  }
  return formats as MatrixFormat[];
}

/** Exigences projetées : par texte ou toutes, validées et corrigées seulement si demandé. */
export function selectExigences(options: GenerateMatricesOptions): ExigenceRecord[] {
  if (!options.texteId && !options.all) throw new AppError('Préciser --texte <id> ou --all');
  let exigences = store.exigences.readAll();
  if (options.texteId) {
    if (!store.textes.findById(options.texteId))
      throw new AppError(`Texte ${options.texteId} introuvable dans le store`);
    exigences = exigences.filter((e) => e.texte_id === options.texteId);
  }
  if (options.onlyValidated) {
    exigences = exigences.filter(
      (e) => e.statut_validation === 'Validée' || e.statut_validation === 'Corrigée',
    );
  }
  return exigences;
}

/** Construit les tables demandées à partir du store (projections déterministes, jamais générées par le LLM). */
export function buildTables(options: GenerateMatricesOptions): {
  tables: MatrixTable[];
  exigences: ExigenceRecord[];
} {
  const only = options.only ?? ['M1', 'M2', 'M3', 'M4', 'M5'];
  const exigences = selectExigences(options);
  const textes = new Map(store.textes.readAll().map((t) => [t.id, t] as const));
  const controles = new Map(store.controles.readAll().map((c) => [c.id, c] as const));
  const scope = new Set(exigences.map((e) => e.id));
  const risques = store.risques.readAll().filter((r) => scope.has(r.exigence_id));
  const jurisprudence = store.jurisprudence
    .readAll()
    .filter((j) => j.exigences_ids.some((id) => scope.has(id)));
  const footer = {
    genere_le: new Date().toISOString(),
    run_id: options.runId === undefined ? (latestRun()?.run_id ?? null) : options.runId,
    texte_id: options.texteId ?? null,
    only_validated: Boolean(options.onlyValidated),
  };
  const tables = only.map((id): MatrixTable => {
    switch (id) {
      case 'M1':
        return buildM1(exigences, textes, footer);
      case 'M2':
        return buildM2(exigences, footer);
      case 'M3':
        return buildM3(exigences, controles, footer);
      case 'M4':
        return buildM4(risques, exigences, controles, footer);
      case 'M5':
        return buildM5(jurisprudence, exigences, footer);
    }
  });
  return { tables, exigences };
}

/** Génère les matrices demandées : CSV et MD par matrice, un classeur XLSX à un onglet par matrice. */
export async function generateMatrices(
  options: GenerateMatricesOptions,
): Promise<GenerateMatricesResult> {
  const formats = options.formats ?? ['csv', 'xlsx', 'md'];
  const outDir = options.outDir ? paths.resolve(options.outDir) : paths.output('matrices');
  const { tables, exigences } = buildTables(options);
  const files: GeneratedFile[] = [];
  for (const table of tables) {
    for (const format of formats) {
      if (format === 'xlsx') continue;
      const file = path.join(outDir, `${table.definition.slug}.${format}`);
      writeTextAtomic(file, format === 'csv' ? toCsv(table) : toMarkdown(table));
      files.push({ matrice: table.definition.id, format, file, rows: table.rows.length });
    }
  }
  if (formats.includes('xlsx') && tables.length > 0) {
    const file = path.join(outDir, WORKBOOK_FILE);
    await writeWorkbook(tables, file);
    for (const table of tables)
      files.push({ matrice: table.definition.id, format: 'xlsx', file, rows: table.rows.length });
  }
  return { files, skipped: [], exigences: exigences.length };
}
