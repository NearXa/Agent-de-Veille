import { enrichExigences } from '../analysis/enrich.js';

export interface EnrichCommandOptions {
  texte: string;
  cache?: boolean;
}

export default async function enrichCommand(options: EnrichCommandOptions): Promise<void> {
  const r = await enrichExigences({ texteId: options.texte, useCache: options.cache });
  console.log(
    `${r.texte_id} · ${r.exigences} exigence(s) enrichie(s) en ${r.appels} appel(s) · run ${r.run_id}`,
  );
  console.log(
    `  échéances renseignées : ${r.echeances_renseignees} · sanctions renseignées : ${r.sanctions_renseignees}`,
  );
}
