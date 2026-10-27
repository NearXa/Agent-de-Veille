import type { Gouvernance } from '../schemas/gouvernance.js';
import { store } from '../store/repository.js';
import type {
  ControleRecord,
  DecisionGouvernance,
  ExigenceRecord,
  LotRecord,
  RisqueRecord,
  TexteRecord,
  ValidationRecord,
} from '../store/types.js';
import { readJson, fileExists, writeTextAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';

export interface Kpis {
  exigences: number;
  validees: number;
  pct_validees: number;
  pct_couverture: number;
  couverture: Record<string, number>;
  echeances_90j: number;
  echeances_depassees: number;
  delai_moyen_validation_jours: number | null;
  risques_par_niveau: Record<string, number>;
  lots_par_statut: Record<string, number>;
}

/** Indicateurs de pilotage calculés depuis le store (SPEC.md, section 12). */
export function computeKpis(
  exigences: ExigenceRecord[],
  risques: RisqueRecord[],
  lots: LotRecord[],
  validations: ValidationRecord[],
  textes: TexteRecord[],
  now = new Date(),
): Kpis {
  const validees = exigences.filter(
    (e) => e.statut_validation === 'Validée' || e.statut_validation === 'Corrigée',
  ).length;
  const couverture: Record<string, number> = {};
  for (const e of exigences) couverture[e.couverture] = (couverture[e.couverture] ?? 0) + 1;
  const score = exigences.reduce(
    (acc, e) => acc + (e.couverture === 'Couverte' ? 1 : e.couverture === 'Partielle' ? 0.5 : 0),
    0,
  );
  const in90 = new Date(now.getTime() + 90 * 86_400_000);
  let echeances90 = 0;
  let depassees = 0;
  for (const e of exigences) {
    if (!e.echeance?.date) continue;
    const d = new Date(e.echeance.date);
    if (d < now) depassees += 1;
    else if (d <= in90) echeances90 += 1;
  }
  const collecte = new Map(textes.map((t) => [t.id, new Date(t.collecte_le).getTime()] as const));
  const delais = validations
    .map((v) => {
      const e = exigences.find((x) => x.id === v.exigence_id);
      const start = e ? collecte.get(e.texte_id) : undefined;
      return start ? (new Date(v.date).getTime() - start) / 86_400_000 : null;
    })
    .filter((d): d is number => d !== null && Number.isFinite(d) && d >= 0);
  const risquesParNiveau: Record<string, number> = {};
  for (const r of risques)
    risquesParNiveau[r.niveau_residuel] = (risquesParNiveau[r.niveau_residuel] ?? 0) + 1;
  const lotsParStatut: Record<string, number> = {};
  for (const l of lots) lotsParStatut[l.statut] = (lotsParStatut[l.statut] ?? 0) + 1;
  return {
    exigences: exigences.length,
    validees,
    pct_validees: exigences.length ? Math.round((validees / exigences.length) * 1000) / 10 : 0,
    pct_couverture: exigences.length ? Math.round((score / exigences.length) * 1000) / 10 : 0,
    couverture,
    echeances_90j: echeances90,
    echeances_depassees: depassees,
    delai_moyen_validation_jours: delais.length
      ? Math.round((delais.reduce((a, b) => a + b, 0) / delais.length) * 10) / 10
      : null,
    risques_par_niveau: risquesParNiveau,
    lots_par_statut: lotsParStatut,
  };
}

const ROLES = ['RSSI', 'DSI', 'Conformité', 'Juridique', 'Métiers', 'Direction'] as const;

/** RACI d'un lot : R = responsable du lot, A = Direction (P1) ou DSI, C = Conformité et Juridique, I = les autres. */
export function raciFor(lot: LotRecord): Record<(typeof ROLES)[number], string> {
  const raci: Record<(typeof ROLES)[number], string> = {
    RSSI: 'I',
    DSI: 'I',
    Conformité: 'C',
    Juridique: 'C',
    Métiers: 'I',
    Direction: 'I',
  };
  const responsable = (ROLES as readonly string[]).includes(lot.responsable)
    ? (lot.responsable as (typeof ROLES)[number])
    : 'DSI';
  raci[responsable] = 'R';
  let accountable: (typeof ROLES)[number] = lot.priorite === 'P1' ? 'Direction' : 'DSI';
  if (accountable === responsable) accountable = responsable === 'DSI' ? 'Direction' : 'DSI';
  raci[accountable] = 'A';
  if (lot.cadre_gouvernance === 'ITIL' && raci.RSSI === 'I') raci.RSSI = 'C';
  return raci;
}

const TOGAF_ORDER = [
  'Phase A',
  'Phase B',
  'Phase C',
  'Phase D',
  'Phase E',
  'Phase F',
  'Phase G',
  'Phase H',
];

/** Dépendances : un lot TOGAF dépend des lots des phases précédentes ; un lot ITIL dépend des lots TOGAF A et B. */
export function dependenciesFor(lot: LotRecord, lots: LotRecord[]): string[] {
  const phaseIndex = (l: LotRecord): number =>
    TOGAF_ORDER.findIndex((p) => l.phase_ou_pratique.includes(p));
  if (lot.cadre_gouvernance === 'TOGAF') {
    const mine = phaseIndex(lot);
    return lots
      .filter(
        (l) =>
          l.id !== lot.id &&
          l.cadre_gouvernance === 'TOGAF' &&
          phaseIndex(l) >= 0 &&
          phaseIndex(l) < mine,
      )
      .map((l) => l.id);
  }
  return lots
    .filter((l) => l.cadre_gouvernance === 'TOGAF' && phaseIndex(l) >= 0 && phaseIndex(l) <= 1)
    .map((l) => l.id);
}

export interface RecommandationFile extends Gouvernance {
  texte_id: string;
  run_id: string;
  genere_le: string;
  repartition: { TOGAF: number; ITIL: number };
  lots: string[];
}

export function readRecommandation(): RecommandationFile | undefined {
  const file = paths.output('gouvernance', 'recommandation.json');
  return fileExists(file) ? readJson<RecommandationFile>(file) : undefined;
}

export function readDecision(): DecisionGouvernance | undefined {
  const file = paths.output('gouvernance', 'decision.json');
  return fileExists(file) ? readJson<DecisionGouvernance>(file) : undefined;
}

const md = (v: string | null | undefined): string =>
  (v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Plan de gouvernance en Markdown (SPEC.md, section 12). */
export function buildPlanMarkdown(input: {
  texte: TexteRecord;
  recommandation: RecommandationFile;
  exigences: ExigenceRecord[];
  lots: LotRecord[];
  risques: RisqueRecord[];
  controles: ControleRecord[];
  validations: ValidationRecord[];
  decision: DecisionGouvernance | undefined;
  now?: Date;
}): string {
  const { texte, recommandation: r, exigences, lots, risques, validations, decision } = input;
  const now = input.now ?? new Date();
  const kpis = computeKpis(exigences, risques, lots, validations, [texte], now);
  const titles = new Map(exigences.map((e) => [e.id, e.titre] as const));
  const lines: string[] = [];
  lines.push(`# Plan de gouvernance : ${texte.titre}`, '');
  lines.push(
    `Généré le ${now.toISOString().slice(0, 10)} · texte ${texte.id} (${texte.reference}) · run ${r.run_id}.`,
    '',
  );
  lines.push(
    '> Principe : l’agent recommande, l’humain décide. La décision finale est enregistrée dans la vue « Pilotage » du cockpit (Notion et `output/gouvernance/decision.json`).',
    '',
  );
  lines.push('## 1. Recommandation', '');
  lines.push(
    `**Cadre recommandé : ${r.cadre_recommande}** · score TOGAF ${r.score_togaf}/100 · score ITIL ${r.score_itil}/100 · mapping : ${r.repartition.TOGAF} exigence(s) TOGAF, ${r.repartition.ITIL} ITIL.`,
    '',
  );
  lines.push(r.justification, '');
  lines.push('| Critère | Poids | Évaluation |', '| --- | --- | --- |');
  for (const c of r.criteres) lines.push(`| ${md(c.critere)} | ${c.poids} | ${md(c.evaluation)} |`);
  lines.push('', '**Alternatives** : ' + md(r.alternatives), '');
  lines.push('## 2. Décision humaine', '');
  if (decision) {
    lines.push(
      `**Cadre retenu : ${decision.cadre}** par ${decision.auteur} le ${decision.date.slice(0, 16).replace('T', ' ')}${decision.commentaire ? ` : ${md(decision.commentaire)}` : ''}.`,
      '',
    );
  } else {
    lines.push('_En attente de décision (vue « Pilotage » du cockpit)._', '');
  }
  lines.push('## 3. Mapping exigence → cadre → phase ou pratique → livrable', '');
  lines.push(
    '| Exigence | Titre | Cadre | Phase ou pratique | Livrable |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const m of [...r.mapping].sort((a, b) => a.exigence_id.localeCompare(b.exigence_id))) {
    lines.push(
      `| ${m.exigence_id} | ${md(titles.get(m.exigence_id) ?? '')} | ${m.cadre} | ${md(m.phase_ou_pratique)} | ${md(m.livrable)} |`,
    );
  }
  lines.push('', '## 4. Feuille de route en lots d’action', '');
  lines.push(
    '| Lot | Priorité | Cadre | Phase ou pratique | Exigences | Risques | Responsable | Échéance cible | Effort | Dépendances | Statut |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const l of lots) {
    lines.push(
      `| ${l.id} | ${l.priorite} | ${l.cadre_gouvernance} | ${md(l.phase_ou_pratique)} | ${l.exigences_ids.join(', ')} | ${l.risques_ids.join(', ') || '—'} | ${l.responsable} | ${l.echeance_cible ?? '—'} | ${l.effort} | ${dependenciesFor(l, lots).join(', ') || '—'} | ${l.statut} |`,
    );
  }
  lines.push('', '## 5. RACI', '');
  lines.push(`| Lot | ${ROLES.join(' | ')} |`, `| --- | ${ROLES.map(() => '---').join(' | ')} |`);
  for (const l of lots) {
    const raci = raciFor(l);
    lines.push(`| ${l.id} | ${ROLES.map((role) => raci[role]).join(' | ')} |`);
  }
  lines.push('', '## 6. Indicateurs de pilotage', '');
  lines.push(
    `- Exigences validées ou corrigées : ${kpis.validees} / ${kpis.exigences} (${kpis.pct_validees} %)`,
  );
  lines.push(
    `- Couverture par les contrôles existants : ${kpis.pct_couverture} % (${Object.entries(
      kpis.couverture,
    )
      .map(([k, v]) => `${k} : ${v}`)
      .join(', ')})`,
  );
  lines.push(
    `- Échéances à moins de 90 jours : ${kpis.echeances_90j} · dépassées : ${kpis.echeances_depassees}`,
  );
  lines.push(
    `- Délai moyen de validation : ${kpis.delai_moyen_validation_jours === null ? 'n/a (aucune validation)' : `${kpis.delai_moyen_validation_jours} jour(s)`}`,
  );
  lines.push(
    `- Risques par niveau résiduel : ${
      Object.entries(kpis.risques_par_niveau)
        .map(([k, v]) => `${k} : ${v}`)
        .join(', ') || 'aucun'
    }`,
  );
  lines.push(
    `- Lots par statut : ${
      Object.entries(kpis.lots_par_statut)
        .map(([k, v]) => `${k} : ${v}`)
        .join(', ') || 'aucun'
    }`,
  );
  lines.push('', '## 7. Points de décision humaine', '');
  for (const p of r.points_de_decision_humaine) lines.push(`- ${p}`);
  lines.push('');
  return lines.join('\n');
}

/** Écrit output/gouvernance/plan-gouvernance.md (et sa copie docs/plan-gouvernance.md). */
export function writeGovernancePlan(texteId: string): { output: string; docs: string } {
  const texte = store.textes.findById(texteId);
  const recommandation = readRecommandation();
  if (!texte || !recommandation)
    throw new Error(
      `Plan impossible : texte ${texteId} ou recommandation.json introuvable (lancer governance).`,
    );
  const exigences = store.exigences.readAll().filter((e) => e.texte_id === texteId);
  const scope = new Set(exigences.map((e) => e.id));
  const content = buildPlanMarkdown({
    texte,
    recommandation,
    exigences,
    lots: store.lots.readAll().filter((l) => l.exigences_ids.some((id) => scope.has(id))),
    risques: store.risques.readAll().filter((r) => scope.has(r.exigence_id)),
    controles: store.controles.readAll(),
    validations: store.validations.readAll().filter((v) => scope.has(v.exigence_id)),
    decision: readDecision(),
  });
  const output = paths.output('gouvernance', 'plan-gouvernance.md');
  const docs = paths.resolve('docs/plan-gouvernance.md');
  writeTextAtomic(output, content);
  writeTextAtomic(docs, content);
  return { output, docs };
}
