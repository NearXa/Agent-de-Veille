import { analyseJurisprudence } from '../analysis/jurisprudence.js';

export interface JurisprudenceCommandOptions {
  texte: string;
  cache?: boolean;
}

export default async function jurisprudenceCommand(
  options: JurisprudenceCommandOptions,
): Promise<void> {
  const r = await analyseJurisprudence({ texteId: options.texte, useCache: options.cache });
  if (r.ignoree) {
    console.log(
      `${r.texte_id} · étape ignorée : aucune source de jurisprudence (PISTE_API_KEY ou corpus data/sources/jurisprudence/) · run ${r.run_id}`,
    );
    return;
  }
  console.log(
    `${r.texte_id} · sources ${r.sources.join(', ')} · ${r.requetes} requête(s) · ${r.candidates} candidate(s) · ${r.decisions_retenues} décision(s) retenue(s) · ${r.appels} appel(s) LLM · run ${r.run_id}`,
  );
}
