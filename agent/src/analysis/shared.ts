import {
  loadControles,
  loadOrganisation,
  type Controles,
  type Organisation,
} from '../config/schemas.js';
import { IdRegistry } from '../store/ids.js';
import { store } from '../store/repository.js';
import type { ArticleRecord, ControleRecord, ExigenceRecord, TexteRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { truncate } from '../utils/text.js';

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function requireTexte(texteId: string): TexteRecord {
  const texte = store.textes.findById(texteId);
  if (!texte) throw new AppError(`Texte ${texteId} introuvable dans ${store.textes.file}`);
  return texte;
}

export function exigencesOfTexte(texteId: string): ExigenceRecord[] {
  const exigences = store.exigences.readAll().filter((e) => e.texte_id === texteId);
  if (exigences.length === 0)
    throw new AppError(`Aucune exigence pour ${texteId} : lancer extract d'abord.`);
  return exigences.sort((a, b) => a.id.localeCompare(b.id));
}

/** Profil de l'organisation rendu pour les prompts (multi-lignes, sans YAML brut). */
export function organisationProfile(org: Organisation = loadOrganisation()): string {
  const o = org.organisation;
  const si = org.systeme_information;
  return [
    `Nom : ${o.nom}${o.nom_court ? ` (${o.nom_court})` : ''}`,
    `Forme et secteur : ${o.forme_juridique ?? 'n/p'}, ${o.secteur}, ${o.pays}, ${o.effectif} salariés`,
    `Description : ${o.description.trim()}`,
    `Agréments : ${o.agrements.map((a) => `${a.autorite} : ${a.type}`).join(' ; ') || 'aucun'}`,
    `Statuts réglementaires : ${o.statuts_reglementaires.join(' ; ') || 'n/p'}`,
    `Exclusions connues : ${o.exclusions_connues.join(' ; ') || 'aucune'}`,
    `Système d'information : ${si.modele}`,
    `Cloud : ${si.cloud.join(' ; ') || 'n/p'} ; on-premise : ${si.on_premise.join(' ; ') || 'n/p'}`,
    `Prestataires TIC critiques : ${org.prestataires_tic_critiques.map((p) => `${p.nom} (${p.service}, ${p.criticite})`).join(' ; ') || 'n/p'}`,
  ].join('\n');
}

export function organisationShort(org: Organisation = loadOrganisation()): string {
  const o = org.organisation;
  return `${o.nom} : ${o.secteur}, ${o.effectif} salariés, ${o.pays} ; ${o.statuts_reglementaires.slice(0, 2).join(' ; ')}`;
}

export function formatArticles(articles: ArticleRecord[]): string {
  return articles
    .map((a) => `Article ${a.numero}${a.titre ? ` – ${a.titre}` : ''}\n${a.contenu}`)
    .join('\n\n');
}

/** Articles transversaux : champ d'application, définitions, sanctions, entrée en vigueur / application. */
export function transversalArticles(texte: TexteRecord): {
  champ: ArticleRecord[];
  definitions: ArticleRecord[];
  sanctions: ArticleRecord[];
  entree: ArticleRecord[];
} {
  const by = (pattern: RegExp): ArticleRecord[] =>
    texte.articles.filter(
      (a) => a.type === 'article' && pattern.test(`${a.titre ?? ''} ${a.contenu.slice(0, 200)}`),
    );
  const champ = by(/\bobjet\b|champ d['’]application|\bapplicabilit/i);
  const definitions = by(/^\s*d[ée]finitions?\b|\bd[ée]finitions\b/i);
  const sanctions = by(
    /sanction|amende|p[ée]nalit|mesures? correctiv|pouvoirs? (?:de surveillance|des autorit)/i,
  );
  const entree = by(/entr[ée]e en vigueur|entr[ée]e en application|\bs['’]applique à partir du/i);
  const first = texte.articles.filter((a) => a.type === 'article').slice(0, 2);
  return { champ: champ.length > 0 ? champ : first, definitions, sanctions, entree };
}

export function exigenceLine(
  e: ExigenceRecord,
  options: { description?: boolean; couverture?: boolean; echeance?: boolean } = {},
): string {
  const parts = [
    `- ${e.id} · ${e.titre} · articles : ${e.articles.join(' ; ')} · type : ${e.type_obligation}`,
  ];
  if (options.description) parts.push(`  description : ${truncate(e.description, 600)}`);
  if (options.echeance) {
    parts.push(
      `  échéance actuelle : ${e.echeance ? `${e.echeance.date ?? 'date inconnue'} (${e.echeance.type}, ${e.echeance.texte_source ?? 'source n/p'})` : 'aucune'}`,
    );
    parts.push(
      `  sanction actuelle : ${e.sanction ? `${e.sanction.description} (${e.sanction.niveau})` : 'aucune'} · destinataires : ${e.destinataires.join(', ') || 'aucun'}`,
    );
  }
  if (options.couverture) {
    const detail = e.couverture_detail
      .map((c) => `${c.controle_id} ${c.couverture}${c.ecart ? ` (écart : ${c.ecart})` : ''}`)
      .join(' ; ');
    parts.push(`  couverture : ${e.couverture}${detail ? ` · ${detail}` : ''}`);
  }
  return parts.join('\n');
}

/** Seed des contrôles du catalogue dans data/store/controles.json (idempotent, conserve les liens). */
export function seedControles(
  runId: string | null,
  config: Controles = loadControles(),
): ControleRecord[] {
  const existing = new Map(store.controles.readAll().map((c) => [c.id, c] as const));
  const records: ControleRecord[] = config.controles.map((c) => ({
    id: c.id,
    nom: c.nom,
    description: c.description,
    referentiel: c.referentiel,
    reference: c.reference,
    proprietaire: c.proprietaire,
    statut: c.statut,
    efficacite: c.efficacite,
    preuves: c.preuves ?? null,
    exigences_ids: existing.get(c.id)?.exigences_ids ?? [],
    risques_ids: existing.get(c.id)?.risques_ids ?? [],
    ecart_constate: existing.get(c.id)?.ecart_constate ?? null,
    run_id: runId ?? existing.get(c.id)?.run_id ?? null,
  }));
  store.controles.writeAll(records);
  return records;
}

export function formatControles(controles: ControleRecord[]): string {
  return controles
    .map(
      (c) =>
        `- ${c.id} · ${c.nom} · ${c.referentiel} ${c.reference} · statut ${c.statut} · efficacité ${c.efficacite} · ${truncate(c.description, 220)}${c.preuves ? ` · preuves : ${truncate(c.preuves, 120)}` : ''}`,
    )
    .join('\n');
}

export function registryKeyForRisque(exigenceId: string): string {
  return IdRegistry.makeKey('RK', [exigenceId]);
}
