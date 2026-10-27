import type { Client } from '@notionhq/client';
import { loadEnv } from '../config/env.js';
import { store } from '../store/repository.js';
import type { ControleRecord, ExigenceRecord, JurisprudenceRecord, LotRecord, RisqueRecord, TexteRecord } from '../store/types.js';
import { AppError } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import { NotionGateway, requireNotionConfig } from './client.js';
import { readNotionIds, readPagesMap, writePagesMap, type NotionIds, type PagesMap } from './ids.js';
import {
  controleToProperties,
  exigenceToProperties,
  jurisprudenceToProperties,
  LOT_HUMAN_PROPERTIES,
  lotToProperties,
  risqueToProperties,
  texteToProperties,
  type NotionProperties,
} from './mapping.js';
import { P } from './schema.js';

type PageProps = Parameters<Client['pages']['create']>[0]['properties'];

export type PushCollection = 'textes' | 'exigences' | 'controles' | 'risques' | 'jurisprudence' | 'lots' | 'relations';
export const PUSH_COLLECTIONS: PushCollection[] = ['textes', 'exigences', 'controles', 'risques', 'jurisprudence', 'lots', 'relations'];

export interface PushOptions {
  only?: PushCollection[];
  runId?: string;
  gateway?: NotionGateway;
  log?: Logger;
}

interface Counter {
  created: number;
  updated: number;
}

export interface PushSummary {
  textes: Counter;
  exigences: Counter & { revalidees: number };
  controles: Counter;
  risques: Counter;
  jurisprudence: Counter;
  lots: Counter;
  relations: number;
  calls: number;
}

class Pusher {
  constructor(
    private readonly gateway: NotionGateway,
    private readonly ids: NotionIds,
    private readonly pagesMap: PagesMap,
    private readonly log: Logger,
  ) {}

  async findPageId(dataSourceId: string, businessId: string): Promise<string | undefined> {
    const cached = this.pagesMap[businessId];
    if (cached) return cached;
    const res = await this.gateway.call(`query ${businessId}`, (c) =>
      c.dataSources.query({
        data_source_id: dataSourceId,
        filter: { property: P.exigences.id, title: { equals: businessId } },
        page_size: 1,
      }),
    );
    const page = res.results[0];
    if (!page) return undefined;
    this.pagesMap[businessId] = page.id;
    return page.id;
  }

  async upsert(dataSourceId: string, businessId: string, create: NotionProperties, update: NotionProperties): Promise<'created' | 'updated'> {
    const pageId = await this.findPageId(dataSourceId, businessId);
    if (pageId) {
      await this.gateway.call(`pages.update ${businessId}`, (c) => c.pages.update({ page_id: pageId, properties: update as PageProps }));
      return 'updated';
    }
    const page = await this.gateway.call(`pages.create ${businessId}`, (c) =>
      c.pages.create({ parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties: create as PageProps }),
    );
    this.pagesMap[businessId] = page.id;
    return 'created';
  }

  async pushSimple<T extends { id: string }>(dataSourceId: string, records: T[], toProps: (r: T) => NotionProperties, counter: Counter, label: string): Promise<void> {
    for (const record of records) {
      const props = toProps(record);
      const result = await this.upsert(dataSourceId, record.id, props, props);
      counter[result] += 1;
      this.log.info({ id: record.id, result }, `${label} poussé`);
    }
  }

  /** Lots d'action : statut, cadre et responsable sont pilotés par l'humain dans Notion après création. */
  async pushLots(lots: LotRecord[], summary: PushSummary): Promise<void> {
    const ds = this.ids.bases.lots.data_source_id;
    for (const lot of lots) {
      const create = lotToProperties(lot);
      const update: NotionProperties = { ...create };
      for (const key of LOT_HUMAN_PROPERTIES) delete update[key];
      const result = await this.upsert(ds, lot.id, create, update);
      summary.lots[result] += 1;
      this.log.info({ id: lot.id, result }, 'Lot poussé');
    }
  }

  async pushExigences(exigences: ExigenceRecord[], summary: PushSummary): Promise<void> {
    const ds = this.ids.bases.exigences.data_source_id;
    for (const exigence of exigences) {
      const textePageId = this.pagesMap[exigence.texte_id] ?? (await this.findPageId(this.ids.bases.textes.data_source_id, exigence.texte_id));
      if (!textePageId) this.log.warn({ id: exigence.id, texte: exigence.texte_id }, 'Texte parent absent de Notion : relation non posée');
      const create = exigenceToProperties(exigence, { textePageId, includeValidation: true });
      const update = exigenceToProperties(exigence, { textePageId, includeValidation: false });
      const result = await this.upsert(ds, exigence.id, create, update);
      summary.exigences[result] += 1;
      this.log.info({ id: exigence.id, result }, 'Exigence poussée');
      if (exigence.statut_validation === 'À revalider' && exigence.revalidation_motif) {
        await this.markRevalidation(exigence, summary);
      }
    }
  }

  /**
   * Transition « À revalider » décidée par l'agent (article modifié) : seule exception à la règle
   * « ne jamais toucher aux champs de validation », tracée par un commentaire d'audit, idempotente.
   */
  async markRevalidation(exigence: ExigenceRecord, summary: PushSummary): Promise<void> {
    const pageId = this.pagesMap[exigence.id];
    if (!pageId) return;
    const page = await this.gateway.call(`pages.retrieve ${exigence.id}`, (c) => c.pages.retrieve({ page_id: pageId }));
    const current = (page as { properties?: Record<string, { select?: { name?: string } | null }> }).properties?.[P.exigences.statut_validation]?.select?.name;
    if (current === 'À revalider') return;
    await this.gateway.call(`pages.update (revalidation) ${exigence.id}`, (c) =>
      c.pages.update({ page_id: pageId, properties: { [P.exigences.statut_validation]: { select: { name: 'À revalider' } } } as PageProps }),
    );
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await this.gateway.call(`comments.create ${exigence.id}`, (c) =>
      c.comments.create({
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: `${stamp} · À revalider par l'agent · ${exigence.revalidation_motif}` } }],
      }),
    );
    summary.exigences.revalidees += 1;
    this.log.info({ id: exigence.id }, 'Exigence passée « À revalider » dans Notion');
  }

  /** Relations posées après la création de toutes les pages : exigences → contrôles, risques, jurisprudence ; risques → contrôles. */
  async pushRelations(exigences: ExigenceRecord[], risques: RisqueRecord[], lots: LotRecord[], summary: PushSummary): Promise<void> {
    const toPages = (ids: string[]): string[] => ids.map((id) => this.pagesMap[id]).filter((p): p is string => Boolean(p));
    for (const e of exigences) {
      if (e.controles_ids.length + e.risques_ids.length + e.jurisprudence_ids.length + e.lots_ids.length === 0) continue;
      const pageId = this.pagesMap[e.id];
      if (!pageId) continue;
      const props: NotionProperties = {
        [P.exigences.controles]: { relation: toPages(e.controles_ids).map((id) => ({ id })) },
        [P.exigences.risques]: { relation: toPages(e.risques_ids).map((id) => ({ id })) },
        [P.exigences.jurisprudence]: { relation: toPages(e.jurisprudence_ids).map((id) => ({ id })) },
        [P.exigences.lots]: { relation: toPages(e.lots_ids).map((id) => ({ id })) },
      };
      await this.gateway.call(`relations ${e.id}`, (c) => c.pages.update({ page_id: pageId, properties: props as PageProps }));
      summary.relations += 1;
    }
    for (const r of risques) {
      const pageId = this.pagesMap[r.id];
      if (!pageId || r.controles_attenuants.length + r.lots_ids.length === 0) continue;
      const props: NotionProperties = {
        [P.risques.controles]: { relation: toPages(r.controles_attenuants).map((id) => ({ id })) },
        [P.risques.lots]: { relation: toPages(r.lots_ids).map((id) => ({ id })) },
      };
      await this.gateway.call(`relations ${r.id}`, (c) => c.pages.update({ page_id: pageId, properties: props as PageProps }));
      summary.relations += 1;
    }
    for (const l of lots) {
      const pageId = this.pagesMap[l.id];
      if (!pageId || l.risques_ids.length === 0) continue;
      const props: NotionProperties = { [P.lots.risques]: { relation: toPages(l.risques_ids).map((id) => ({ id })) } };
      await this.gateway.call(`relations ${l.id}`, (c) => c.pages.update({ page_id: pageId, properties: props as PageProps }));
      summary.relations += 1;
    }
  }
}

/**
 * Pousse le store local vers Notion : upsert par ID métier (propriété title), relations posées une
 * fois toutes les pages créées, champs de validation humaine jamais écrasés après la création.
 */
export async function pushToNotion(options: PushOptions = {}): Promise<PushSummary> {
  const env = loadEnv();
  const config = requireNotionConfig(env);
  const log = options.log ?? logger;
  const ids = readNotionIds();
  if (!ids) throw new AppError('notion/ids.json absent : lancer « pnpm notion init » d’abord.');
  const gateway = options.gateway ?? new NotionGateway(config, { log });
  const pagesMap = readPagesMap();
  const pusher = new Pusher(gateway, ids, pagesMap, log);
  const only = options.only ?? PUSH_COLLECTIONS;
  const byRun = <T extends { run_id: string | null }>(items: T[]): T[] => (options.runId ? items.filter((i) => i.run_id === options.runId) : items);
  const summary: PushSummary = {
    textes: { created: 0, updated: 0 },
    exigences: { created: 0, updated: 0, revalidees: 0 },
    controles: { created: 0, updated: 0 },
    risques: { created: 0, updated: 0 },
    jurisprudence: { created: 0, updated: 0 },
    lots: { created: 0, updated: 0 },
    relations: 0,
    calls: 0,
  };
  try {
    if (only.includes('textes')) await pusher.pushSimple<TexteRecord>(ids.bases.textes.data_source_id, byRun(store.textes.readAll()), texteToProperties, summary.textes, 'Texte');
    if (only.includes('exigences')) await pusher.pushExigences(byRun(store.exigences.readAll()), summary);
    if (only.includes('controles')) await pusher.pushSimple<ControleRecord>(ids.bases.controles.data_source_id, byRun(store.controles.readAll()), controleToProperties, summary.controles, 'Contrôle');
    if (only.includes('risques')) await pusher.pushSimple<RisqueRecord>(ids.bases.risques.data_source_id, byRun(store.risques.readAll()), risqueToProperties, summary.risques, 'Risque');
    if (only.includes('jurisprudence')) await pusher.pushSimple<JurisprudenceRecord>(ids.bases.jurisprudence.data_source_id, byRun(store.jurisprudence.readAll()), jurisprudenceToProperties, summary.jurisprudence, 'Jurisprudence');
    if (only.includes('lots')) await pusher.pushLots(byRun(store.lots.readAll()), summary);
    if (only.includes('relations')) await pusher.pushRelations(byRun(store.exigences.readAll()), byRun(store.risques.readAll()), byRun(store.lots.readAll()), summary);
  } finally {
    writePagesMap(pagesMap);
  }
  summary.calls = gateway.calls;
  return summary;
}
