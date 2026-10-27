import type { ExigenceRecord, TexteRecord } from '../store/types.js';
import {
  MATRIX_DEFINITIONS,
  type MatrixFooter,
  type MatrixRow,
  type MatrixTable,
} from './types.js';

/** M1 Traçabilité : projection déterministe des exigences (jamais générée par le LLM). */
export function buildM1(
  exigences: ExigenceRecord[],
  textes: Map<string, TexteRecord>,
  footer: Omit<MatrixFooter, 'nombre_exigences' | 'pourcentage_verifiees'>,
): MatrixTable {
  const rows: MatrixRow[] = [...exigences]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const texte = textes.get(e.texte_id);
      return {
        'ID exigence': e.id,
        Titre: e.titre,
        Texte: texte ? `${texte.id} · ${texte.titre}` : e.texte_id,
        'Article(s)': e.articles.join(' ; '),
        'Extrait verbatim': e.extrait_verbatim,
        'URL officielle': e.url_article ?? texte?.url_officielle ?? '',
        Échéance: e.echeance?.date ?? '',
        "Type d'échéance": e.echeance?.type ?? 'Non précisée',
        Destinataires: e.destinataires.join(' ; '),
        Confiance: e.confiance,
        Vérifié: e.verifie_dans_source ? 'oui' : 'non',
        'Statut de validation': e.statut_validation,
      };
    });
  const verifiees = exigences.filter((e) => e.verifie_dans_source).length;
  return {
    definition: MATRIX_DEFINITIONS.M1,
    rows,
    footer: {
      ...footer,
      nombre_exigences: exigences.length,
      pourcentage_verifiees:
        exigences.length === 0 ? 0 : Math.round((verifiees / exigences.length) * 1000) / 10,
    },
  };
}
