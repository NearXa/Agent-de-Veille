import path from 'node:path';
import { recommendGovernance } from '../analysis/governance.js';
import { writeGovernancePlan } from '../governance/plan.js';
import { paths } from '../utils/paths.js';

export interface GovernanceCommandOptions {
  texte: string;
  cache?: boolean;
}

export default async function governanceCommand(options: GovernanceCommandOptions): Promise<void> {
  const r = await recommendGovernance({ texteId: options.texte, useCache: options.cache });
  const plan = writeGovernancePlan(options.texte);
  console.log(
    `${r.texte_id} · cadre recommandé : ${r.recommandation.cadre_recommande} (TOGAF ${r.recommandation.score_togaf}, ITIL ${r.recommandation.score_itil}) · run ${r.run_id}`,
  );
  console.log(
    `  mapping : ${r.repartition.TOGAF} exigence(s) TOGAF, ${r.repartition.ITIL} ITIL · ${r.lots.length} lot(s) d'action`,
  );
  for (const l of r.lots)
    console.log(
      `  ${l.id} ${l.priorite} ${l.cadre_gouvernance.padEnd(5)} ${l.phase_ou_pratique} · ${l.exigences_ids.length} exigence(s) · ${l.responsable} · ${l.echeance_cible ?? 'sans échéance'}`,
    );
  console.log(
    `  points de décision humaine : ${r.recommandation.points_de_decision_humaine.length}`,
  );
  console.log(
    `  plan : ${path.relative(paths.root(), plan.output)} (copie ${path.relative(paths.root(), plan.docs)}) · recommandation : output/gouvernance/recommandation.json`,
  );
  console.log(
    '  La décision finale (TOGAF, ITIL ou Hybride) se prend dans la vue « Pilotage » du cockpit.',
  );
}
