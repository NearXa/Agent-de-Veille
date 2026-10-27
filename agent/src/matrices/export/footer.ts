import type { MatrixFooter } from '../types.js';

/** Lignes de pied de page communes à tous les formats (SPEC.md, section 11). */
export function footerLines(footer: MatrixFooter): string[] {
  return [
    `Généré le ${footer.genere_le}`,
    `Run : ${footer.run_id ?? 'n/a'}`,
    `Texte : ${footer.texte_id ?? 'tous'}`,
    `Nombre d'exigences : ${footer.nombre_exigences}${footer.only_validated ? ' (validées et corrigées uniquement)' : ''}`,
    `Exigences vérifiées dans la source : ${footer.pourcentage_verifiees} %`,
  ];
}
