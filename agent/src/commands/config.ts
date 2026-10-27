import { hasLlmApiKey, isNotionConfigured, loadEnv } from '../config/env.js';
import { loadAllConfig } from '../config/schemas.js';
import { fileExists } from '../utils/fs.js';
import { paths } from '../utils/paths.js';

export interface ConfigCommandOptions {
  json?: boolean;
}

/** Valide `.env` et les quatre fichiers de `config/`, puis affiche un résumé. */
export default async function configCommand(options: ConfigCommandOptions): Promise<void> {
  const env = loadEnv();
  const cfg = loadAllConfig();
  const localDocs = cfg.sources.sources
    .filter((s) => s.id === 'local-file')
    .flatMap((s) => s.documents ?? [])
    .map((doc) => ({ fichier: doc.fichier, present: fileExists(paths.resolve(doc.fichier)) }));

  const summary = {
    racine: paths.root(),
    llm: {
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      effort: env.LLM_EFFORT,
      cle_api_presente: hasLlmApiKey(env),
      cache: env.LLM_CACHE,
      max_cost_per_run_usd: env.LLM_MAX_COST_PER_RUN,
    },
    notion: {
      configure: isNotionConfigured(env),
      api_version: env.NOTION_API_VERSION,
      ids_json_present: fileExists(paths.notion('ids.json')),
    },
    organisation: cfg.organisation.organisation.nom,
    controles: cfg.controles.controles.length,
    niveaux_risque: cfg.risques.niveaux.map((n) => n.nom),
    sources_actives: cfg.sources.sources.filter((s) => s.enabled).map((s) => s.id),
    documents_locaux: localDocs,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`Racine du dépôt      : ${summary.racine}`);
  console.log(
    `LLM                  : ${summary.llm.provider} / ${summary.llm.model} (effort ${summary.llm.effort}, cache ${summary.llm.cache ? 'activé' : 'désactivé'}, plafond ${summary.llm.max_cost_per_run_usd} $)`,
  );
  console.log(`Clé API LLM          : ${summary.llm.cle_api_presente ? 'présente' : 'ABSENTE'}`);
  console.log(
    `Notion               : ${summary.notion.configure ? 'configuré' : 'NON configuré'} (API ${summary.notion.api_version}, ids.json ${summary.notion.ids_json_present ? 'présent' : 'absent'})`,
  );
  console.log(`Organisation         : ${summary.organisation}`);
  console.log(`Contrôles            : ${summary.controles}`);
  console.log(`Niveaux de risque    : ${summary.niveaux_risque.join(', ')}`);
  console.log(`Sources actives      : ${summary.sources_actives.join(', ')}`);
  for (const doc of summary.documents_locaux) {
    console.log(`Document local       : ${doc.fichier} (${doc.present ? 'présent' : 'ABSENT'})`);
  }
  const problems: string[] = [];
  if (!summary.llm.cle_api_presente)
    problems.push('clé API LLM absente (étape extract impossible)');
  if (!summary.notion.configure)
    problems.push('Notion non configuré (étapes notion init/push impossibles)');
  for (const doc of summary.documents_locaux)
    if (!doc.present) problems.push(`document absent : ${doc.fichier}`);
  if (problems.length > 0) {
    console.log(`\nÀ corriger avant la démo complète : ${problems.join(' ; ')}`);
  } else {
    console.log('\nConfiguration complète.');
  }
}
