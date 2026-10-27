import { ingestNormalized, type IngestOutcome } from '../ingest/pipeline.js';
import { SourceId, TypeTexte } from '../schemas/common.js';
import { LocalFileConnector } from '../sources/local-file.js';
import { store } from '../store/repository.js';
import { createRun, finishRun, type RunContext } from '../store/run.js';
import { AppError } from '../utils/errors.js';

export interface IngestCommandOptions {
  file: string;
  source?: string;
  ref: string;
  url: string;
  title?: string;
  type?: string;
}

export interface IngestResult extends IngestOutcome {
  run_id: string;
}

/** Étape 1 du parcours : charge un texte officiel déjà téléchargé, le segmente et l'enregistre (TX-xxxx). */
export async function ingestTexte(
  options: IngestCommandOptions,
  run?: RunContext,
): Promise<IngestResult> {
  const ownRun = run ?? createRun('ingest');
  try {
    const source = SourceId.safeParse(options.source ?? 'eurlex');
    if (!source.success) {
      throw new AppError(
        `Source inconnue : ${options.source}. Valeurs : ${SourceId.options.join(', ')}`,
      );
    }
    const type = options.type ? TypeTexte.safeParse(options.type) : undefined;
    if (type && !type.success) {
      throw new AppError(
        `Type de texte inconnu : ${options.type}. Valeurs : ${TypeTexte.options.join(', ')}`,
      );
    }
    const connector = new LocalFileConnector();
    const raw = await connector.fetchDocument({
      fichier: options.file,
      reference: options.ref,
      url_officielle: options.url,
      source: source.data,
      titre: options.title,
      type: type?.data,
    });
    const texte = await connector.parse(raw);
    if (texte.articles.length === 0) {
      ownRun.warnings.push(
        `Aucun article détecté dans ${options.file} (parser ${String(texte.metadonnees.parser)})`,
      );
    }
    const outcome = ingestNormalized(texte, raw, ownRun);
    if (!run) finishRun(ownRun, 'ok');
    return { ...outcome, run_id: ownRun.id };
  } catch (error) {
    if (!run) finishRun(ownRun, 'error', error);
    throw error;
  }
}

export default async function ingestCommand(options: IngestCommandOptions): Promise<void> {
  const result = await ingestTexte(options);
  const t = result.texte;
  console.log(`${t.id}  ${t.titre}`);
  console.log(
    `  source ${t.source} · référence ${t.reference} · type ${t.type} · version ${t.version}${result.changed ? ' (contenu modifié)' : ''}`,
  );
  console.log(
    `  ${t.nombre_articles} article(s) segmenté(s) · hash ${t.hash_sha256.slice(0, 16)}… · collecté le ${t.collecte_le}`,
  );
  if (t.date_entree_en_application)
    console.log(`  entrée en application détectée : ${t.date_entree_en_application}`);
  if (result.doublon_de)
    console.log(
      `  doublon détecté (${result.doublon_de.raison}) : rattaché à ${result.doublon_de.id}`,
    );
  if (result.diff) {
    console.log(
      `  diff : ${result.diff.articles_ajoutes.length} ajouté(s), ${result.diff.articles_supprimes.length} supprimé(s), ${result.diff.articles_modifies.length} modifié(s)`,
    );
  }
  if (result.exigences_a_revalider.length > 0)
    console.log(`  exigences à revalider : ${result.exigences_a_revalider.join(', ')}`);
  console.log(`  store : ${store.textes.file} · run ${result.run_id}`);
}
