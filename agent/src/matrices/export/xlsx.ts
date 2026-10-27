import ExcelJS from 'exceljs';
import { ensureDir } from '../../utils/fs.js';
import path from 'node:path';
import type { MatrixTable } from '../types.js';
import { footerLines } from './footer.js';

/** Nom d'onglet Excel : 31 caractères max, sans [ ] : * ? / \ . */
export function sheetName(table: MatrixTable): string {
  return table.definition.titre.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
}

/**
 * Un classeur, un onglet par matrice : en-tête figé et en gras, filtres automatiques, largeurs de colonnes
 * adaptées, retour à la ligne, pied de page (date, run, nombre d'exigences, % vérifiées).
 */
export async function writeWorkbook(tables: MatrixTable[], file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'veille-grc';
  workbook.created = new Date();
  for (const table of tables) {
    const cols = [...table.definition.colonnes];
    const sheet = workbook.addWorksheet(sheetName(table));
    sheet.columns = cols.map((c) => {
      const longest = Math.max(c.length, ...table.rows.map((r) => String(r[c] ?? '').length));
      return { header: c, key: c, width: Math.min(60, Math.max(10, Math.ceil(longest * 0.9))) };
    });
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    for (const row of table.rows) {
      const added = sheet.addRow(
        cols.map((c) => (row[c] === null || row[c] === undefined ? '' : row[c])),
      );
      added.alignment = { vertical: 'top', wrapText: true };
    }
    sheet.addRow([]);
    for (const line of footerLines(table.footer)) {
      const added = sheet.addRow([line]);
      added.font = { italic: true, color: { argb: 'FF666666' } };
    }
  }
  ensureDir(path.dirname(file));
  await workbook.xlsx.writeFile(file);
}
