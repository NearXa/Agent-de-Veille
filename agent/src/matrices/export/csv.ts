import type { CellValue, MatrixTable } from '../types.js';
import { footerLines } from './footer.js';

const BOM = String.fromCharCode(0xfeff);

function escapeCell(value: CellValue): string {
  if (value === null) return '';
  const text = typeof value === 'boolean' ? (value ? 'oui' : 'non') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV RFC 4180 (séparateur virgule, UTF-8 avec BOM pour Excel), pied de page en commentaires `#`. */
export function toCsv(table: MatrixTable): string {
  const header = table.definition.colonnes.map(escapeCell).join(',');
  const lines = table.rows.map((row) =>
    table.definition.colonnes.map((c) => escapeCell(row[c] ?? null)).join(','),
  );
  const footer = footerLines(table.footer).map((l) => `# ${l}`);
  return `${BOM}${[header, ...lines, '', ...footer].join('\r\n')}\r\n`;
}
