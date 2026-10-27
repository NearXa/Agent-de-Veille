import type {
  ControleRecord,
  ExigenceRecord,
  JurisprudenceRecord,
  RisqueRecord,
  TexteRecord,
} from '../store/types.js';
import {
  MATRIX_DEFINITIONS,
  type MatrixFooter,
  type MatrixRow,
  type MatrixTable,
} from './types.js';

type FooterInput = Omit<MatrixFooter, 'nombre_exigences' | 'pourcentage_verifiees'>;

function finish(
  definition: MatrixTable['definition'],
  rows: MatrixRow[],
  exigences: ExigenceRecord[],
  footer: FooterInput,
): MatrixTable {
  const verifiees = exigences.filter((e) => e.verifie_dans_source).length;
  return {
    definition,
    rows,
    footer: {
      ...footer,
      nombre_exigences: exigences.length,
      pourcentage_verifiees:
        exigences.length === 0 ? 0 : Math.round((verifiees / exigences.length) * 1000) / 10,
    },
  };
}

const sorted = (exigences: ExigenceRecord[]): ExigenceRecord[] =>
  [...exigences].sort((a, b) => a.id.localeCompare(b.id));

/** M2 Impact : processus, systèmes, données, contrats et départements concernés. */
export function buildM2(exigences: ExigenceRecord[], footer: FooterInput): MatrixTable {
  const rows = sorted(exigences).map((e) => ({
    'ID exigence': e.id,
    Titre: e.titre,
    Processus: e.processus_impactes.join(' ; '),
    Systèmes: e.systemes_impactes.join(' ; '),
    Données: e.donnees_concernees.join(' ; '),
    'Contrats et tiers': e.contrats_concernes.join(' ; '),
    Départements: e.departements_impactes.join(' ; '),
    'Effort estimé': e.effort_estime ?? '',
    Justification: e.impact_justification ?? '',
  }));
  return finish(MATRIX_DEFINITIONS.M2, rows, exigences, footer);
}

/** M3 Couverture : contrôles existants, niveau de couverture, écart, lot proposé. */
export function buildM3(
  exigences: ExigenceRecord[],
  controles: Map<string, ControleRecord>,
  footer: FooterInput,
): MatrixTable {
  const rows = sorted(exigences).map((e) => {
    const detail = e.couverture_detail.map((d) => {
      const c = controles.get(d.controle_id);
      return `${d.controle_id} ${c ? `${c.reference} (${c.statut})` : ''} : ${d.couverture}`
        .replace(/\s+/g, ' ')
        .trim();
    });
    const ecarts = e.couverture_detail
      .filter((d) => d.ecart)
      .map((d) => `${d.controle_id} : ${d.ecart}`);
    return {
      'ID exigence': e.id,
      Titre: e.titre,
      'Contrôles existants': detail.join(' ; '),
      Couverture: e.couverture,
      Écart:
        ecarts.join(' ; ') ||
        (e.couverture === 'Non couverte' ? (e.couverture_justification ?? '') : ''),
      "Lot d'action proposé":
        e.lot_propose ?? (e.lots_ids.length > 0 ? e.lots_ids.join(' ; ') : ''),
    };
  });
  return finish(MATRIX_DEFINITIONS.M3, rows, exigences, footer);
}

/** M4 Risque : scénarios, cotation, contrôles atténuants, résiduel. */
export function buildM4(
  risques: RisqueRecord[],
  exigences: ExigenceRecord[],
  controles: Map<string, ControleRecord>,
  footer: FooterInput,
): MatrixTable {
  const rows = [...risques]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({
      'ID risque': r.id,
      'ID exigence': r.exigence_id,
      Scénario: r.scenario,
      Catégorie: r.categorie,
      Probabilité: r.probabilite,
      Impact: r.impact,
      'Criticité brute': r.criticite_brute,
      'Contrôles atténuants': r.controles_attenuants
        .map((id) => `${id}${controles.get(id) ? ` (${controles.get(id)!.statut})` : ''}`)
        .join(' ; '),
      'Risque résiduel': r.risque_residuel,
      'Niveau résiduel': r.niveau_residuel,
      Traitement: r.traitement,
      Propriétaire: r.proprietaire,
    }));
  return finish(MATRIX_DEFINITIONS.M4, rows, exigences, footer);
}

/** M5 Jurisprudence : décisions pertinentes par exigence (une ligne par couple). */
export function buildM5(
  jurisprudence: JurisprudenceRecord[],
  exigences: ExigenceRecord[],
  footer: FooterInput,
): MatrixTable {
  const scope = new Set(exigences.map((e) => e.id));
  const rows: MatrixRow[] = [];
  for (const j of [...jurisprudence].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const exigenceId of j.exigences_ids.filter((id) => scope.has(id)).sort()) {
      rows.push({
        'ID exigence': exigenceId,
        'ID décision': j.id,
        Juridiction: j.juridiction,
        Date: j.date_decision ?? '',
        Numéro: j.numero,
        Résumé: j.resume,
        'Solution retenue': j.solution_retenue ?? '',
        Portée: j.portee ?? '',
        Pertinence: j.pertinence,
        'URL officielle': j.url_officielle,
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(a['ID exigence']).localeCompare(String(b['ID exigence'])) ||
      String(a['ID décision']).localeCompare(String(b['ID décision'])),
  );
  return finish(MATRIX_DEFINITIONS.M5, rows, exigences, footer);
}

export type { TexteRecord };
