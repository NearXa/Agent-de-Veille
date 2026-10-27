import { iteratePaginatedAPI } from '@notionhq/client';
import { applyCorrections } from '../analysis/extract.js';
import { loadEnv } from '../config/env.js';
import { store } from '../store/repository.js';
import type { ExigenceRecord, LotRecord, ValidationRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { sha256 } from '../utils/hash.js';
import { logger, type Logger } from '../utils/logger.js';
import { NotionGateway, requireNotionConfig } from './client.js';
import { readNotionIds, readPagesMap, writePagesMap } from './ids.js';
import { readDate, readPlainText, readSelect } from './mapping.js';
import { P } from './schema.js';

export interface PullOptions {
  gateway?: NotionGateway;
  log?: Logger;
}

export interface PullSummary {
  pages_lues: number;
  exigences_mises_a_jour: number;
  decisions_journalisees: number;
  lots_mis_a_jour: number;
  calls: number;
}

type PageLike = { id: string; properties?: Record<string, unknown> };

/**
 * Rapatrie depuis Notion les décisions humaines (statut, validateur, date, commentaire, version
 * corrigée) vers data/store/exigences.json et le journal data/store/validations.json.
 */
export async function pullFromNotion(options: PullOptions = {}): Promise<PullSummary> {
  const env = loadEnv();
  const config = requireNotionConfig(env);
  const log = options.log ?? logger;
  const ids = readNotionIds();
  if (!ids) throw new AppError('notion/ids.json absent : lancer « pnpm notion init » d’abord.');
  const gateway = options.gateway ?? new NotionGateway(config, { log });
  const pagesMap = readPagesMap();
  const summary: PullSummary = { pages_lues: 0, exigences_mises_a_jour: 0, decisions_journalisees: 0, lots_mis_a_jour: 0, calls: 0 };

  const pages: PageLike[] = await gateway.call('dataSources.query exigences', async (c) => {
    const out: PageLike[] = [];
    for await (const page of iteratePaginatedAPI(c.dataSources.query, { data_source_id: ids.bases.exigences.data_source_id, page_size: 100 })) {
      out.push(page as PageLike);
    }
    return out;
  });
  summary.pages_lues = pages.length;

  const exigences = new Map(store.exigences.readAll().map((e) => [e.id, e] as const));
  const validations = store.validations.readAll();
  const known = new Set(validations.map((v) => v.id));
  const updated: ExigenceRecord[] = [];
  const journal: ValidationRecord[] = [];

  for (const page of pages) {
    const props = page.properties ?? {};
    const businessId = readPlainText(props[P.exigences.id]);
    if (!businessId) continue;
    pagesMap[businessId] = page.id;
    const local = exigences.get(businessId);
    if (!local) continue;
    const statut = readSelect(props[P.exigences.statut_validation]) as ExigenceRecord['statut_validation'] | null;
    if (!statut) continue;
    const validateur = readPlainText(props[P.exigences.validateur]) || null;
    const dateValidation = readDate(props[P.exigences.date_validation]);
    const commentaire = readPlainText(props[P.exigences.commentaire_validation]) || null;
    const rawVersion = readPlainText(props[P.exigences.version_corrigee]);
    let versionCorrigee: Record<string, unknown> | null = null;
    if (rawVersion) {
      try {
        versionCorrigee = JSON.parse(rawVersion) as Record<string, unknown>;
      } catch {
        versionCorrigee = { brut: rawVersion };
      }
    }
    const changed =
      statut !== local.statut_validation ||
      validateur !== local.validateur ||
      dateValidation !== local.date_validation ||
      commentaire !== local.commentaire_validation ||
      JSON.stringify(versionCorrigee) !== JSON.stringify(local.version_corrigee);
    if (!changed) continue;
    let record: ExigenceRecord = { ...local, statut_validation: statut, validateur, date_validation: dateValidation, commentaire_validation: commentaire, version_corrigee: versionCorrigee };
    if (statut === 'Corrigée') record = applyCorrections(record, versionCorrigee);
    updated.push(record);
    summary.exigences_mises_a_jour += 1;
    if (statut !== 'À valider' && validateur && dateValidation) {
      const id = `VAL-${sha256(`${businessId}|${statut}|${dateValidation}|${validateur}`).slice(0, 12)}`;
      if (!known.has(id)) {
        known.add(id);
        journal.push({
          id,
          exigence_id: businessId,
          action: statut,
          validateur,
          date: dateValidation,
          commentaire,
          champs_modifies: statut === 'Corrigée' ? versionCorrigee : null,
          source: 'notion',
        });
      }
    }
  }
  if (updated.length > 0) store.exigences.upsertMany(updated);
  if (journal.length > 0) store.validations.writeAll([...validations, ...journal]);
  summary.decisions_journalisees = journal.length;

  // Lots d'action : statut, cadre de gouvernance et responsable décidés dans Notion.
  const lots = new Map(store.lots.readAll().map((l) => [l.id, l] as const));
  if (lots.size > 0) {
    const lotPages: PageLike[] = await gateway.call('dataSources.query lots', async (c) => {
      const out: PageLike[] = [];
      for await (const page of iteratePaginatedAPI(c.dataSources.query, { data_source_id: ids.bases.lots.data_source_id, page_size: 100 })) out.push(page as PageLike);
      return out;
    });
    const updatedLots: LotRecord[] = [];
    for (const page of lotPages) {
      const props = page.properties ?? {};
      const businessId = readPlainText(props[P.lots.id]);
      const local = lots.get(businessId);
      if (!local) continue;
      pagesMap[businessId] = page.id;
      const statut = (readSelect(props[P.lots.statut]) ?? local.statut) as LotRecord['statut'];
      const cadre = (readSelect(props[P.lots.cadre]) ?? local.cadre_gouvernance) as LotRecord['cadre_gouvernance'];
      const responsable = readPlainText(props[P.lots.responsable]) || local.responsable;
      if (statut !== local.statut || cadre !== local.cadre_gouvernance || responsable !== local.responsable) {
        updatedLots.push({ ...local, statut, cadre_gouvernance: cadre, responsable });
      }
    }
    if (updatedLots.length > 0) store.lots.upsertMany(updatedLots);
    summary.lots_mis_a_jour = updatedLots.length;
  }
  writePagesMap(pagesMap);
  summary.calls = gateway.calls;
  log.info(summary, 'Pull Notion terminé');
  return summary;
}
