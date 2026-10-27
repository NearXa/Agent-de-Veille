import path from 'node:path';
import { generateMatrices, parseFormats, parseMatrixIds } from '../matrices/index.js';
import { paths } from '../utils/paths.js';

export interface MatricesCommandOptions {
  texte?: string;
  all?: boolean;
  only?: string;
  format?: string;
  onlyValidated?: boolean;
  out?: string;
}

export default async function matricesCommand(options: MatricesCommandOptions): Promise<void> {
  const result = await generateMatrices({
    texteId: options.texte,
    all: options.all,
    only: parseMatrixIds(options.only),
    formats: parseFormats(options.format),
    onlyValidated: options.onlyValidated,
    outDir: options.out,
  });
  console.log(
    `${result.exigences} exigence(s) projetée(s)${options.onlyValidated ? ' (validées et corrigées)' : ''}`,
  );
  for (const f of result.files) {
    console.log(
      `  ${f.matrice} ${f.format.padEnd(4)} ${path.relative(paths.root(), f.file)} (${f.rows} ligne(s))`,
    );
  }
  const reasons = new Map<string, string[]>();
  for (const s of result.skipped)
    reasons.set(s.raison, [...(reasons.get(s.raison) ?? []), s.matrice]);
  for (const [raison, ids] of reasons)
    console.log(`  ignoré : ${Array.from(new Set(ids)).join(', ')} : ${raison}`);
}
