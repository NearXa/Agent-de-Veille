import type { CellValue, MatrixTable } from '../types.js';
import { footerLines } from './footer.js';

function escapeCell(value: CellValue): string {
  if (value === null) return '';
  const text = typeof value === 'boolean' ? (value ? 'oui' : 'non') : String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Tableau Markdown avec titre, objectif et pied de page. */
export function toMarkdown(table: MatrixTable): string {
  const cols = table.definition.colonnes;
  const lines = [
    `# ${table.definition.titre}`,
    '',
    table.definition.objectif,
    '',
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${cols.map((c) => escapeCell(row[c] ?? null)).join(' | ')} |`),
    '',
    ...footerLines(table.footer).map((l) => `_${l}_  `),
    '',
  ];
  return lines.join('\n');
}
