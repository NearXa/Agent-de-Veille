import { existsSync, readFileSync, statSync } from 'node:fs';
import { outputFile, storeFile } from './paths';

/** Sous-ensemble des enregistrements du store (voir agent/src/store/types.ts) utilisé par l'assistant. */
export interface Texte {
  id: string;
  source: string;
  reference: string;
  titre: string;
  type: string;
  url_officielle: string;
  collecte_le: string;
  applicable: string;
  resume: string | null;
  nombre_articles: number;
  derniere_modification_detectee: string | null;
  version: number;
}

export interface Exigence {
  id: string;
  texte_id: string;
  titre: string;
  description: string;
  articles: string[];
  extrait_verbatim: string;
  url_article: string | null;
  verifie_dans_source: boolean;
  type_obligation: string;
  destinataires: string[];
  echeance: { date: string | null; type: string; texte_source: string | null } | null;
  sanction: { description: string; niveau: string; article: string | null } | null;
  confiance: number;
  statut_validation: string;
  validateur: string | null;
  date_validation: string | null;
  commentaire_validation: string | null;
  processus_impactes: string[];
  systemes_impactes: string[];
  donnees_concernees: string[];
  contrats_concernes: string[];
  departements_impactes: string[];
  effort_estime: string | null;
  couverture: string;
  couverture_detail: { controle_id: string; couverture: string; ecart: string | null }[];
  controles_ids: string[];
  risques_ids: string[];
  jurisprudence_ids: string[];
  lots_ids: string[];
  avertissements: string[];
}

export interface Controle {
  id: string;
  nom: string;
  referentiel: string;
  reference: string;
  statut: string;
  efficacite: string;
  exigences_ids: string[];
  ecart_constate: string | null;
}

export interface Risque {
  id: string;
  exigence_id: string;
  intitule: string;
  scenario: string;
  categorie: string;
  probabilite: number;
  impact: number;
  criticite_brute: number;
  controles_attenuants: string[];
  risque_residuel: number;
  niveau_residuel: string;
  traitement: string;
  proprietaire: string;
  statut: string;
  lots_ids: string[];
}

export interface Lot {
  id: string;
  titre: string;
  description: string;
  exigences_ids: string[];
  risques_ids: string[];
  priorite: string;
  responsable: string;
  echeance_cible: string | null;
  statut: string;
  cadre_gouvernance: string;
  phase_ou_pratique: string;
  livrable_attendu: string;
  effort: string;
}

export interface Jurisprudence {
  id: string;
  juridiction: string;
  numero: string;
  date_decision: string | null;
  url_officielle: string;
  resume: string;
  pertinence: number;
  exigences_ids: string[];
}

export interface Recommandation {
  cadre_recommande: string;
  score_togaf: number;
  score_itil: number;
  justification: string;
  points_de_decision_humaine: string[];
  lots: string[];
}

export interface Decision {
  cadre: string;
  auteur: string;
  date: string;
  commentaire: string | null;
}

const cache = new Map<string, { mtime: number; value: unknown }>();

function readJsonCached<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.value as T;
  const raw = readFileSync(file, 'utf8').trim();
  const value = raw ? (JSON.parse(raw) as T) : fallback;
  cache.set(file, { mtime, value });
  return value;
}

/** Lecture du store local (data/store/*.json), relue quand les fichiers changent. */
export const store = {
  textes: (): Texte[] => readJsonCached<Texte[]>(storeFile('textes'), []),
  exigences: (): Exigence[] => readJsonCached<Exigence[]>(storeFile('exigences'), []),
  controles: (): Controle[] => readJsonCached<Controle[]>(storeFile('controles'), []),
  risques: (): Risque[] => readJsonCached<Risque[]>(storeFile('risques'), []),
  lots: (): Lot[] => readJsonCached<Lot[]>(storeFile('lots'), []),
  jurisprudence: (): Jurisprudence[] =>
    readJsonCached<Jurisprudence[]>(storeFile('jurisprudence'), []),
  recommandation: (): Recommandation | null =>
    readJsonCached<Recommandation | null>(outputFile('gouvernance', 'recommandation.json'), null),
  decision: (): Decision | null =>
    readJsonCached<Decision | null>(outputFile('gouvernance', 'decision.json'), null),
};

/** Normalisation sans accents ni casse pour les recherches plein texte. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matches(haystack: string, query: string): boolean {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return true;
  const h = normalize(haystack);
  return terms.every((t) => h.includes(t));
}
