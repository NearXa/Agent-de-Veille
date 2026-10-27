import { assessApplicability } from '../analysis/applicability.js';

export interface ApplicabilityCommandOptions {
  texte: string;
  force?: boolean;
  cache?: boolean;
}

export default async function applicabilityCommand(
  options: ApplicabilityCommandOptions,
): Promise<void> {
  const r = await assessApplicability({ texteId: options.texte, useCache: options.cache });
  console.log(
    `${r.texte_id} · applicable : ${r.applicable} (confiance ${r.applicabilite.confiance}) · run ${r.run_id}`,
  );
  console.log(`  ${r.applicabilite.justification}`);
  for (const c of r.applicabilite.criteres)
    console.log(
      `  ${c.satisfait ? '✔' : '✘'} ${c.critere}${c.article_preuve ? ` (${c.article_preuve})` : ''}`,
    );
  console.log(`  résumé : ${r.applicabilite.resume}`);
  if (r.applicable !== 'Oui' && !options.force)
    console.log('  Le pipeline complet s’arrêtera ici sans --force.');
}
