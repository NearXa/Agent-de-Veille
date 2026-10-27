import type { ControleRecord, ExigenceRecord, JurisprudenceRecord, LotRecord, RisqueRecord, TexteRecord } from '../store/types.js';
import { P, SOURCE_SELECT } from './schema.js';

export const RICH_TEXT_LIMIT = 2000;
export const RICH_TEXT_MAX_CHUNKS = 25;

type RichTextItem = { type: 'text'; text: { content: string; link?: { url: string } } };

/** Découpe un texte en objets rich_text de 2 000 caractères max (contrainte Notion). */
export function richText(text: string | null | undefined): RichTextItem[] {
  if (!text) return [];
  const chunks: RichTextItem[] = [];
  let rest = text;
  while (rest.length > 0 && chunks.length < RICH_TEXT_MAX_CHUNKS) {
    chunks.push({ type: 'text', text: { content: rest.slice(0, RICH_TEXT_LIMIT) } });
    rest = rest.slice(RICH_TEXT_LIMIT);
  }
  if (rest.length > 0) chunks.push({ type: 'text', text: { content: '… [tronqué]' } });
  return chunks;
}

/** Les noms d'options select ne peuvent pas contenir de virgule et sont limités à 100 caractères. */
export function selectName(value: string): string {
  return value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const select = (value: string | null | undefined) => (value ? { select: { name: selectName(value) } } : { select: null });
const multiSelect = (values: string[]) => ({
  multi_select: Array.from(new Set(values.map(selectName).filter((v) => v.length > 0))).map((name) => ({ name })),
});
const dateProp = (value: string | null | undefined) => (value ? { date: { start: value } } : { date: null });
const numberProp = (value: number | null | undefined) => ({ number: value ?? null });
const urlProp = (value: string | null | undefined) => ({ url: value || null });
const text = (value: string | null | undefined) => ({ rich_text: richText(value) });
const titleProp = (value: string) => ({ title: [{ type: 'text' as const, text: { content: value } }] });
const relation = (pageIds: string[]) => ({ relation: pageIds.map((id) => ({ id })) });

export type NotionProperties = Record<string, unknown>;

export function texteToProperties(t: TexteRecord): NotionProperties {
  return {
    [P.textes.id]: titleProp(t.id),
    [P.textes.titre]: text(t.titre),
    [P.textes.source]: select(SOURCE_SELECT[t.source] ?? t.source),
    [P.textes.type]: select(t.type),
    [P.textes.reference]: text(t.reference),
    [P.textes.url]: urlProp(t.url_officielle),
    [P.textes.date_publication]: dateProp(t.date_publication),
    [P.textes.date_vigueur]: dateProp(t.date_entree_en_vigueur),
    [P.textes.date_application]: dateProp(t.date_entree_en_application),
    [P.textes.statut]: select(t.statut_texte),
    [P.textes.hash]: text(t.hash_sha256),
    [P.textes.date_collecte]: dateProp(t.collecte_le),
    [P.textes.derniere_modification]: dateProp(t.derniere_modification_detectee),
    [P.textes.applicable]: select(t.applicable),
    [P.textes.justification_applicabilite]: text(t.justification_applicabilite),
    [P.textes.confiance_applicabilite]: numberProp(t.confiance_applicabilite),
    [P.textes.resume]: text(t.resume),
    [P.textes.nombre_articles]: numberProp(t.nombre_articles),
    [P.textes.run_id]: text(t.run_id),
  };
}

export interface ExigenceMappingOptions {
  textePageId?: string;
  /** Champs de validation humaine : uniquement à la création (jamais écrasés ensuite). */
  includeValidation: boolean;
}

export function exigenceToProperties(e: ExigenceRecord, options: ExigenceMappingOptions): NotionProperties {
  const props: NotionProperties = {
    [P.exigences.id]: titleProp(e.id),
    [P.exigences.titre]: text(e.titre),
    [P.exigences.description]: text(e.description),
    [P.exigences.articles]: text(e.articles.join(' ; ')),
    [P.exigences.extrait]: text(e.extrait_verbatim),
    [P.exigences.url_article]: urlProp(e.url_article),
    [P.exigences.verifie]: { checkbox: e.verifie_dans_source },
    [P.exigences.type_obligation]: select(e.type_obligation),
    [P.exigences.destinataires]: multiSelect(e.destinataires),
    [P.exigences.echeance]: dateProp(e.echeance?.date ?? null),
    [P.exigences.type_echeance]: select(e.echeance?.type ?? 'Non précisée'),
    [P.exigences.sanction]: text(e.sanction?.description ?? null),
    [P.exigences.niveau_sanction]: select(e.sanction?.niveau ?? 'Non précisé'),
    [P.exigences.confiance]: numberProp(e.confiance),
    [P.exigences.processus]: multiSelect(e.processus_impactes),
    [P.exigences.systemes]: multiSelect(e.systemes_impactes),
    [P.exigences.donnees]: multiSelect(e.donnees_concernees),
    [P.exigences.contrats]: text(e.contrats_concernes.join(' ; ')),
    [P.exigences.effort]: select(e.effort_estime),
    [P.exigences.couverture]: select(e.couverture),
    [P.exigences.run_id]: text(e.run_id),
  };
  if (options.textePageId) props[P.exigences.texte] = relation([options.textePageId]);
  if (options.includeValidation) {
    props[P.exigences.statut_validation] = select(e.statut_validation);
    props[P.exigences.validateur] = text(e.validateur);
    props[P.exigences.date_validation] = dateProp(e.date_validation);
    props[P.exigences.commentaire_validation] = text(e.commentaire_validation);
    props[P.exigences.version_corrigee] = text(e.version_corrigee ? JSON.stringify(e.version_corrigee) : null);
  }
  return props;
}

/** Champs de validation à ne jamais écraser lors d'une mise à jour (SPEC.md, section 13). */
export const VALIDATION_PROPERTIES = [
  P.exigences.statut_validation,
  P.exigences.validateur,
  P.exigences.date_validation,
  P.exigences.commentaire_validation,
  P.exigences.version_corrigee,
] as const;

export function controleToProperties(c: ControleRecord): NotionProperties {
  return {
    [P.controles.id]: titleProp(c.id),
    [P.controles.nom]: text(c.nom),
    [P.controles.description]: text(c.description),
    [P.controles.referentiel]: select(c.referentiel),
    [P.controles.reference]: text(c.reference),
    [P.controles.proprietaire]: text(c.proprietaire),
    [P.controles.statut]: select(c.statut),
    [P.controles.efficacite]: select(c.efficacite),
    [P.controles.preuves]: text(c.preuves),
    [P.controles.ecart]: text(c.ecart_constate),
  };
}

export function risqueToProperties(r: RisqueRecord): NotionProperties {
  return {
    [P.risques.id]: titleProp(r.id),
    [P.risques.intitule]: text(r.intitule),
    [P.risques.scenario]: text(r.scenario),
    [P.risques.categorie]: select(r.categorie),
    [P.risques.probabilite]: numberProp(r.probabilite),
    [P.risques.impact]: numberProp(r.impact),
    [P.risques.residuel]: numberProp(r.risque_residuel),
    [P.risques.niveau_residuel]: select(r.niveau_residuel),
    [P.risques.traitement]: select(r.traitement),
    [P.risques.proprietaire]: text(r.proprietaire),
    [P.risques.statut]: select(r.statut),
  };
}

export function jurisprudenceToProperties(j: JurisprudenceRecord): NotionProperties {
  return {
    [P.jurisprudence.id]: titleProp(j.id),
    [P.jurisprudence.juridiction]: select(j.juridiction),
    [P.jurisprudence.numero]: text(j.numero),
    [P.jurisprudence.date]: dateProp(j.date_decision),
    [P.jurisprudence.url]: urlProp(j.url_officielle),
    [P.jurisprudence.resume]: text(j.resume),
    [P.jurisprudence.solution]: text(j.solution_retenue),
    [P.jurisprudence.portee]: text(j.portee),
    [P.jurisprudence.pertinence]: numberProp(j.pertinence),
    [P.jurisprudence.mots_cles]: multiSelect(j.mots_cles),
  };
}

export function relationProperty(name: string, pageIds: string[]): NotionProperties {
  return { [name]: relation(pageIds) };
}

/** Lecture des propriétés d'une page Notion (pull). */
export function readPlainText(prop: unknown): string {
  const p = prop as { rich_text?: { plain_text?: string; text?: { content?: string } }[]; title?: { plain_text?: string; text?: { content?: string } }[] } | undefined;
  return (p?.rich_text ?? p?.title ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
}
export function readSelect(prop: unknown): string | null {
  return ((prop as { select?: { name?: string } | null } | undefined)?.select?.name ?? null) || null;
}
export function readDate(prop: unknown): string | null {
  return (prop as { date?: { start?: string } | null } | undefined)?.date?.start ?? null;
}

export function lotToProperties(l: LotRecord): NotionProperties {
  return {
    [P.lots.id]: titleProp(l.id),
    [P.lots.titre]: text(l.titre),
    [P.lots.description]: text(l.description),
    [P.lots.priorite]: select(l.priorite),
    [P.lots.responsable]: text(l.responsable),
    [P.lots.echeance]: dateProp(l.echeance_cible),
    [P.lots.statut]: select(l.statut),
    [P.lots.cadre]: select(l.cadre_gouvernance),
    [P.lots.phase]: text(l.phase_ou_pratique),
    [P.lots.livrable]: text(l.livrable_attendu),
    [P.lots.effort]: select(l.effort),
  };
}

/** Champs d'un lot que l'humain pilote dans Notion : jamais écrasés par un push après création. */
export const LOT_HUMAN_PROPERTIES = [P.lots.statut, P.lots.cadre, P.lots.responsable] as const;
