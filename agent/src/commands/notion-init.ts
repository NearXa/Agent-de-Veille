import { initNotion } from '../notion/init.js';
import { notionIdsFile } from '../notion/ids.js';

export default async function notionInitCommand(): Promise<void> {
  const summary = await initNotion();
  console.log(
    `Bases Notion sous la page ${summary.ids.parent_page_id} (API ${summary.ids.api_version})`,
  );
  for (const [key, base] of Object.entries(summary.ids.bases)) {
    const state = summary.created.includes(key as never) ? 'créée' : 'réutilisée';
    console.log(
      `  ${base.titre.padEnd(14)} ${state.padEnd(10)} database ${base.database_id} · data source ${base.data_source_id}`,
    );
  }
  console.log(
    `  propriétés ajoutées : ${summary.properties_added} · relations posées : ${summary.relations_added} · formules : ${summary.formulas_added} · ${summary.calls} requête(s)`,
  );
  console.log(`  identifiants écrits dans ${notionIdsFile()}`);
}
