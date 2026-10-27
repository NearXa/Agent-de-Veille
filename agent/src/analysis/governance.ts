import { loadRisques } from '../config/schemas.js';
import { generateStructured } from '../llm/structured.js';
import { loadPrompt, renderPrompt } from '../prompts/loader.js';
import {
  GouvernanceSchema,
  ITIL_PRACTICES,
  TOGAF_PHASES,
  type Gouvernance,
} from '../schemas/gouvernance.js';
import { IdRegistry } from '../store/ids.js';
import { store } from '../store/repository.js';
import {
  addCount,
  addWarning,
  createRun,
  finishRun,
  writeRunArtifact,
  type RunContext,
} from '../store/run.js';
import type { ExigenceRecord, LotRecord, RisqueRecord } from '../store/types.js';
import { writeJsonAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import type { StructuredCaller } from './extract.js';
import { exigencesOfTexte, organisationShort, requireTexte } from './shared.js';

export interface GovernanceOptions {
  texteId: string;
  run?: RunContext;
  llm?: StructuredCaller;
  useCache?: boolean;
}

export interface GovernanceResult {
  texte_id: string;
  run_id: string;
  recommandation: Gouvernance;
  lots: LotRecord[];
  repartition: { TOGAF: number; ITIL: number };
}

const PRIORITE_PAR_NIVEAU: Record<RisqueRecord['niveau_residuel'], LotRecord['priorite']> = {
  Critique: 'P1',
  Élevé: 'P2',
  Modéré: 'P3',
  Faible: 'P4',
};
const EFFORT_ORDER: Record<string, number> = { Faible: 1, Moyen: 2, Élevé: 3 };

/** Responsable d'un lot selon le cadre et la pratique (rôles RACI de la spec). */
export function responsableFor(cadre: 'TOGAF' | 'ITIL', phaseOuPratique: string): string {
  const p = phaseOuPratique.toLowerCase();
  if (cadre === 'TOGAF') return /phase a|phase b|vision|business/.test(p) ? 'Direction' : 'DSI';
  if (/incident|monitoring|security|sécurité/.test(p)) return 'RSSI';
  if (/supplier|fournisseur|contract/.test(p)) return 'Conformité';
  if (/continuity|continuité|change|service level/.test(p)) return 'DSI';
  return 'DSI';
}

/**
 * Lots d'action construits par code à partir du mapping : un lot par couple (cadre, phase ou pratique)
 * pour les exigences non couvertes ou partiellement couvertes ; priorité selon le risque résiduel maximal.
 */
export function buildLots(
  mapping: Gouvernance['mapping'],
  exigences: ExigenceRecord[],
  risques: RisqueRecord[],
  runId: string,
  registry: IdRegistry,
  previous: Map<string, LotRecord>,
): LotRecord[] {
  const byExigence = new Map(exigences.map((e) => [e.id, e] as const));
  const risquesByExigence = new Map<string, RisqueRecord[]>();
  for (const r of risques)
    risquesByExigence.set(r.exigence_id, [...(risquesByExigence.get(r.exigence_id) ?? []), r]);
  const groups = new Map<
    string,
    { cadre: 'TOGAF' | 'ITIL'; phase: string; livrables: Set<string>; exigences: ExigenceRecord[] }
  >();
  for (const m of mapping) {
    const e = byExigence.get(m.exigence_id);
    if (!e || e.couverture === 'Couverte') continue;
    const key = `${m.cadre}|${m.phase_ou_pratique.trim()}`;
    const group = groups.get(key) ?? {
      cadre: m.cadre,
      phase: m.phase_ou_pratique.trim(),
      livrables: new Set<string>(),
      exigences: [],
    };
    group.livrables.add(m.livrable.trim());
    group.exigences.push(e);
    groups.set(key, group);
  }
  const lots: LotRecord[] = [];
  for (const group of groups.values()) {
    const linkedRisques = group.exigences.flatMap((e) => risquesByExigence.get(e.id) ?? []);
    const worst = linkedRisques
      .map((r) => r.niveau_residuel)
      .sort((a, b) => (PRIORITE_PAR_NIVEAU[a] < PRIORITE_PAR_NIVEAU[b] ? -1 : 1))[0];
    const priorite = worst
      ? PRIORITE_PAR_NIVEAU[worst]
      : group.exigences.some((e) => e.couverture === 'Non couverte')
        ? 'P2'
        : 'P3';
    const dates = group.exigences
      .map((e) => e.echeance?.date)
      .filter((d): d is string => Boolean(d))
      .sort();
    const effort =
      group.exigences
        .map((e) => e.effort_estime ?? 'Moyen')
        .sort((a, b) => (EFFORT_ORDER[b] ?? 2) - (EFFORT_ORDER[a] ?? 2))[0] ?? 'Moyen';
    const { id } = registry.resolve('LA', IdRegistry.makeKey('LA', [group.cadre, group.phase]));
    const old = previous.get(id);
    lots.push({
      id,
      titre: `${group.phase} : ${group.exigences.length} exigence(s) à couvrir`,
      description: `Mettre en conformité les exigences ${group.exigences.map((e) => e.id).join(', ')} (${group.cadre}, ${group.phase}). Livrables : ${Array.from(group.livrables).join(' ; ')}.`,
      exigences_ids: group.exigences.map((e) => e.id).sort(),
      risques_ids: Array.from(new Set(linkedRisques.map((r) => r.id))).sort(),
      priorite,
      responsable: old?.responsable ?? responsableFor(group.cadre, group.phase),
      echeance_cible: dates[0] ?? null,
      statut: old?.statut ?? 'À planifier',
      cadre_gouvernance: old?.cadre_gouvernance ?? group.cadre,
      phase_ou_pratique: group.phase,
      livrable_attendu: Array.from(group.livrables).join(' ; '),
      effort: effort as LotRecord['effort'],
      run_id: runId,
    });
  }
  return lots.sort((a, b) => a.priorite.localeCompare(b.priorite) || a.id.localeCompare(b.id));
}

/** Étape gouvernance : recommandation argumentée (LLM), lots d'action (code), recommandation.json. */
export async function recommendGovernance(options: GovernanceOptions): Promise<GovernanceResult> {
  const run = options.run ?? createRun('governance');
  const llm = options.llm ?? generateStructured;
  try {
    const texte = requireTexte(options.texteId);
    const exigences = exigencesOfTexte(texte.id);
    const risques = store.risques
      .readAll()
      .filter((r) => exigences.some((e) => e.id === r.exigence_id));
    const risqueByExigence = new Map(risques.map((r) => [r.exigence_id, r] as const));
    const grille = loadRisques();
    const couverture = { Couverte: 0, Partielle: 0, 'Non couverte': 0, 'À évaluer': 0 };
    for (const e of exigences) couverture[e.couverture] += 1;
    const niveaux: Record<string, number> = {};
    for (const r of risques) niveaux[r.niveau_residuel] = (niveaux[r.niveau_residuel] ?? 0) + 1;
    const synthese = `${exigences.length} exigences ; couverture : ${JSON.stringify(couverture)} ; risques résiduels : ${JSON.stringify(niveaux)} ; seuil d'acceptation : ${grille.seuil_acceptation} ; échéance d'application : ${texte.date_entree_en_application ?? 'n/p'}`;
    const prompt = loadPrompt('gouvernance');
    const rendered = renderPrompt(prompt.template, {
      organisation: organisationShort(),
      titre_texte: texte.titre,
      reference: texte.reference,
      phases_togaf: TOGAF_PHASES.join(' | '),
      pratiques_itil: ITIL_PRACTICES.join(' | '),
      synthese,
      exigences: exigences
        .map(
          (e) =>
            `- ${e.id} · ${e.titre} · ${e.type_obligation} · ${e.couverture} · effort ${e.effort_estime ?? 'n/p'} · risque ${risqueByExigence.get(e.id)?.niveau_residuel ?? 'aucun'} · processus ${e.processus_impactes.join(', ') || 'n/p'}`,
        )
        .join('\n'),
    });
    const result = await llm({
      schema: GouvernanceSchema,
      schemaName: 'Gouvernance',
      instructions: prompt.instructions,
      prompt: rendered,
      promptVersion: prompt.version,
      run,
      label: `gouvernance ${texte.id}`,
      useCache: options.useCache,
    });
    const recommandation = result.output;
    const known = new Set(exigences.map((e) => e.id));
    const missing = exigences.filter(
      (e) => !recommandation.mapping.some((m) => m.exigence_id === e.id),
    );
    for (const e of missing)
      addWarning(run, `gouvernance : ${e.id} absente du mapping renvoyé par le modèle`);
    recommandation.mapping = recommandation.mapping.filter((m) => known.has(m.exigence_id));
    const repartition = {
      TOGAF: recommandation.mapping.filter((m) => m.cadre === 'TOGAF').length,
      ITIL: recommandation.mapping.filter((m) => m.cadre === 'ITIL').length,
    };

    const registry = IdRegistry.load();
    const previous = new Map(store.lots.readAll().map((l) => [l.id, l] as const));
    const lots = buildLots(recommandation.mapping, exigences, risques, run.id, registry, previous);
    store.lots.upsertMany(lots);
    registry.save();
    const lotByExigence = new Map<string, string[]>();
    for (const lot of lots)
      for (const id of lot.exigences_ids)
        lotByExigence.set(id, [...(lotByExigence.get(id) ?? []), lot.id]);
    store.exigences.upsertMany(
      exigences.map((e) => ({
        ...e,
        lots_ids: lotByExigence.get(e.id) ?? [],
        lot_propose: (lotByExigence.get(e.id) ?? []).join(' ; ') || null,
      })),
    );
    const lotByRisque = new Map<string, string[]>();
    for (const lot of lots)
      for (const id of lot.risques_ids)
        lotByRisque.set(id, [...(lotByRisque.get(id) ?? []), lot.id]);
    if (risques.length > 0)
      store.risques.upsertMany(
        risques.map((r) => ({ ...r, lots_ids: lotByRisque.get(r.id) ?? [] })),
      );

    writeJsonAtomic(paths.output('gouvernance', 'recommandation.json'), {
      texte_id: texte.id,
      run_id: run.id,
      genere_le: new Date().toISOString(),
      repartition,
      ...recommandation,
      lots: lots.map((l) => l.id),
    });
    writeRunArtifact(run, `gouvernance-${texte.id}.json`, {
      prompt: rendered,
      output: recommandation,
      usage: result.usage,
      cached: result.cached,
    });
    addCount(run, 'lots', lots.length);
    run.log.info(
      {
        cadre: recommandation.cadre_recommande,
        togaf: recommandation.score_togaf,
        itil: recommandation.score_itil,
        lots: lots.length,
      },
      'Recommandation de gouvernance produite',
    );
    if (!options.run) finishRun(run, 'ok');
    return { texte_id: texte.id, run_id: run.id, recommandation, lots, repartition };
  } catch (error) {
    if (!options.run) finishRun(run, 'error', error);
    throw error;
  }
}
