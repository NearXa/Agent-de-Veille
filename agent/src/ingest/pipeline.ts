import path from 'node:path';
import { parseArticleNumber } from '../analysis/verify.js';
import type { DocumentBrut, TexteNormalise } from '../sources/types.js';
import { IdRegistry } from '../store/ids.js';
import { store } from '../store/repository.js';
import { addCount, addWarning, writeRunArtifact, type RunContext } from '../store/run.js';
import type { ExigenceRecord, TexteRecord } from '../store/types.js';
import { fileExists, writeTextAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import { estimateTokens } from '../utils/text.js';
import { findDuplicate } from './dedup.js';
import { diffArticles, summarizeDiff, type TexteDiff } from './diff.js';

export interface IngestOutcome {
  texte: TexteRecord;
  created: boolean;
  changed: boolean;
  /** Renseigné quand le texte a été rattaché à un enregistrement existant d'une autre source. */
  doublon_de: { id: string; raison: 'hash' | 'titre' } | null;
  diff: TexteDiff | null;
  exigences_a_revalider: string[];
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** Copie brute horodatée par hash dans data/raw/<source>/<ref>/ (ignoré par git), avec métadonnées. */
export function archiveRaw(texte: TexteNormalise, raw: DocumentBrut): string {
  const rawHash = String(texte.metadonnees.hash_brut_sha256 ?? texte.hash_sha256);
  const dir = paths.raw(texte.source, sanitizeForPath(texte.reference));
  const file = path.join(dir, `${rawHash}.${raw.format}`);
  if (!fileExists(file)) {
    writeTextAtomic(file, raw.contenu.toString(raw.format === 'pdf' ? 'base64' : 'utf8'));
    writeTextAtomic(
      `${file}.meta.json`,
      `${JSON.stringify({ url: raw.url_officielle, reference: raw.reference, recupere_le: raw.recupere_le, format: raw.format, hash_brut_sha256: rawHash, hash_contenu_sha256: texte.hash_sha256 }, null, 2)}\n`,
    );
  }
  return path.relative(paths.root(), file);
}

/** Exigences du texte dont un article cité a été modifié ou supprimé : statut « À revalider ». */
function flagRevalidation(texteId: string, diff: TexteDiff, run: RunContext): string[] {
  const impacted = new Set(
    [...diff.articles_modifies, ...diff.articles_supprimes].map((n) => n.toLowerCase()),
  );
  if (impacted.size === 0) return [];
  const flagged: string[] = [];
  const updated: ExigenceRecord[] = [];
  for (const exigence of store.exigences.readAll()) {
    if (exigence.texte_id !== texteId) continue;
    const touched = exigence.articles
      .map((ref) => parseArticleNumber(ref)?.toLowerCase())
      .filter((n): n is string => Boolean(n) && impacted.has(n!));
    if (touched.length === 0) continue;
    const motif = `Article(s) modifié(s) ou supprimé(s) dans la source le ${new Date().toISOString().slice(0, 10)} : ${Array.from(new Set(touched)).join(', ')}`;
    if (
      exigence.statut_validation === 'Validée' ||
      exigence.statut_validation === 'Corrigée' ||
      exigence.statut_validation === 'À revalider'
    ) {
      updated.push({ ...exigence, statut_validation: 'À revalider', revalidation_motif: motif });
      flagged.push(exigence.id);
    } else {
      updated.push({
        ...exigence,
        avertissements: Array.from(new Set([...exigence.avertissements, motif])),
      });
    }
  }
  if (updated.length > 0) store.exigences.upsertMany(updated);
  if (flagged.length > 0)
    addWarning(
      run,
      `${flagged.length} exigence(s) passée(s) « À revalider » : ${flagged.join(', ')}`,
    );
  return flagged;
}

/**
 * Enregistre un texte normalisé dans le store : IDs stables, déduplication inter-sources, détection de
 * modification par hash, diff par article, historique des versions et revalidation des exigences.
 */
export function ingestNormalized(
  texte: TexteNormalise,
  raw: DocumentBrut | null,
  run: RunContext,
): IngestOutcome {
  const log = run.log;
  const rawPath = raw ? archiveRaw(texte, raw) : null;
  const registry = IdRegistry.load();
  const key = IdRegistry.makeKey('TX', [texte.source, texte.reference]);
  let id = registry.lookup(key);
  let existing = id ? store.textes.findById(id) : undefined;
  let doublon: IngestOutcome['doublon_de'] = null;
  if (!existing) {
    const dup = findDuplicate(store.textes.readAll(), texte);
    if (dup && dup.raison !== 'reference') {
      doublon = { id: dup.record.id, raison: dup.raison };
      registry.alias(key, dup.record.id);
      id = dup.record.id;
      existing = dup.record;
      log.info(
        { id, source: texte.source, reference: texte.reference, raison: dup.raison },
        'Texte déjà connu via une autre source, rattaché',
      );
    }
  }
  if (!id) id = registry.resolve('TX', key).id;
  const created = existing === undefined;
  const now = new Date().toISOString();
  const urls = Array.from(
    new Set(
      [
        ...(existing?.urls_connues ?? []),
        existing?.url_officielle ?? '',
        texte.url_officielle,
      ].filter((u) => u),
    ),
  );

  let record: TexteRecord;
  let diff: TexteDiff | null = null;
  let changed = false;
  let flagged: string[] = [];
  if (existing && existing.hash_sha256 === texte.hash_sha256) {
    record = {
      ...existing,
      collecte_le: now,
      run_id: run.id,
      fichier_source: raw?.fichier ?? existing.fichier_source,
      urls_connues: urls,
    };
    log.info(
      { id, hash: texte.hash_sha256.slice(0, 12) },
      'Texte inchangé depuis la dernière collecte',
    );
  } else {
    changed = existing !== undefined;
    const version = existing ? existing.version + 1 : 1;
    const historique = [...(existing?.historique ?? [])];
    if (existing) {
      diff = diffArticles(existing.articles, texte.articles);
      historique.push({
        version,
        hash_sha256: texte.hash_sha256,
        collecte_le: now,
        run_id: run.id,
        articles_ajoutes: diff.articles_ajoutes,
        articles_supprimes: diff.articles_supprimes,
        articles_modifies: diff.articles_modifies,
      });
      writeRunArtifact(run, `diff-${id}-v${version}.json`, diff);
      addWarning(
        run,
        `Contenu modifié pour ${id} (${texte.reference}) : version ${version}, ${summarizeDiff(diff)}`,
      );
      flagged = flagRevalidation(id, diff, run);
    }
    record = {
      id,
      source: existing?.source ?? texte.source,
      reference: existing?.reference ?? texte.reference,
      titre: texte.titre,
      type: texte.type,
      url_officielle: existing?.url_officielle ?? texte.url_officielle,
      urls_connues: urls,
      date_publication: texte.dates.publication ?? existing?.date_publication ?? null,
      date_entree_en_vigueur:
        texte.dates.entree_en_vigueur ?? existing?.date_entree_en_vigueur ?? null,
      date_entree_en_application:
        texte.dates.entree_en_application ?? existing?.date_entree_en_application ?? null,
      statut_texte: changed ? 'Modifié' : (existing?.statut_texte ?? 'En vigueur'),
      hash_sha256: texte.hash_sha256,
      collecte_le: now,
      derniere_modification_detectee: changed
        ? now
        : (existing?.derniere_modification_detectee ?? null),
      fichier_source: raw?.fichier ?? null,
      applicable: existing?.applicable ?? 'À déterminer',
      justification_applicabilite: existing?.justification_applicabilite ?? null,
      confiance_applicabilite: existing?.confiance_applicabilite ?? null,
      resume: existing?.resume ?? null,
      nombre_articles: texte.articles.length,
      articles: texte.articles,
      run_id: run.id,
      version,
      historique,
    };
  }
  store.textes.upsert(record);
  registry.save();

  addCount(run, 'textes', 1);
  if (created) addCount(run, 'textes_nouveaux', 1);
  if (changed) addCount(run, 'textes_modifies', 1);
  addCount(run, 'articles', texte.articles.length);
  addCount(run, 'tokens_estimes', estimateTokens(texte.contenu_texte));
  writeRunArtifact(run, `ingest-${id}.json`, {
    texte_id: id,
    created,
    changed,
    doublon_de: doublon,
    reference: texte.reference,
    titre: texte.titre,
    hash_sha256: texte.hash_sha256,
    raw: rawPath,
    articles: texte.articles.map((a) => ({
      numero: a.numero,
      titre: a.titre,
      caracteres: a.contenu.length,
    })),
    metadonnees: texte.metadonnees,
  });
  log.info(
    { id, created, changed, articles: texte.articles.length },
    created ? 'Texte enregistré' : changed ? 'Texte mis à jour' : 'Texte revu',
  );
  return {
    texte: record,
    created,
    changed,
    doublon_de: doublon,
    diff,
    exigences_a_revalider: flagged,
  };
}
