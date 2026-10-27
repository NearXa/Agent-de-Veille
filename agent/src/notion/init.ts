import { collectPaginatedAPI, type Client } from '@notionhq/client';
import { loadEnv } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger, type Logger } from '../utils/logger.js';
import { NotionGateway, requireNotionConfig } from './client.js';
import { readNotionIds, writeNotionIds, type NotionBaseIds, type NotionIds } from './ids.js';
import { BASES, BASE_KEYS, FORMULAS, P, RELATIONS, type BaseKey, type PropertySchema } from './schema.js';

type UpdateProps = NonNullable<Parameters<Client['dataSources']['update']>[0]['properties']>;
type CreateDbParams = Parameters<Client['databases']['create']>[0];
type PropertyMap = Record<string, { type?: string; id?: string; relation?: unknown; [key: string]: unknown }>;

export interface InitSummary {
  ids: NotionIds;
  created: BaseKey[];
  reused: BaseKey[];
  properties_added: number;
  relations_added: number;
  formulas_added: number;
  calls: number;
}

interface BaseState {
  key: BaseKey;
  database_id: string;
  data_source_id: string;
  properties: PropertyMap;
}

function plainTitle(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((t) => (typeof t === 'object' && t && 'plain_text' in t ? String(t.plain_text) : '')).join('');
  }
  return typeof value === 'string' ? value : '';
}

/** Bases enfants de la page parente : titre → id du bloc child_database. */
async function listChildDatabases(gateway: NotionGateway, parentPageId: string): Promise<Map<string, string>> {
  const blocks = await gateway.call('blocks.children.list', (c) =>
    collectPaginatedAPI(c.blocks.children.list, { block_id: parentPageId }),
  );
  const found = new Map<string, string>();
  for (const block of blocks) {
    if ('type' in block && block.type === 'child_database') {
      const title = block.child_database.title;
      if (!found.has(title)) found.set(title, block.id);
    }
  }
  return found;
}

async function retrieveState(gateway: NotionGateway, key: BaseKey, databaseId: string): Promise<BaseState> {
  const database = await gateway.call(`databases.retrieve ${key}`, (c) => c.databases.retrieve({ database_id: databaseId }));
  const dataSources = (database as { data_sources?: { id: string }[] }).data_sources ?? [];
  const dataSourceId = dataSources[0]?.id;
  if (!dataSourceId) throw new AppError(`Base ${key} (${databaseId}) sans data source`);
  const ds = await gateway.call(`dataSources.retrieve ${key}`, (c) => c.dataSources.retrieve({ data_source_id: dataSourceId }));
  return { key, database_id: database.id, data_source_id: dataSourceId, properties: (ds as { properties: PropertyMap }).properties };
}

/** Repli quand l'id du bloc n'est pas l'id de la base : recherche par titre parmi les data sources. */
async function findBySearch(gateway: NotionGateway, key: BaseKey, titre: string): Promise<BaseState | undefined> {
  const res = await gateway.call(`search ${key}`, (c) =>
    c.search({ query: titre, filter: { property: 'object', value: 'data_source' }, page_size: 20 }),
  );
  for (const item of res.results) {
    const ds = item as { object: string; id: string; title?: unknown; name?: string; parent?: { database_id?: string } };
    if (ds.object !== 'data_source') continue;
    const name = ds.name ?? plainTitle(ds.title);
    if (name !== titre || !ds.parent?.database_id) continue;
    return retrieveState(gateway, key, ds.parent.database_id);
  }
  return undefined;
}

async function createBase(gateway: NotionGateway, parentPageId: string, key: BaseKey): Promise<BaseState> {
  const def = BASES[key];
  const params = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: def.titre } }],
    initial_data_source: { properties: def.properties },
  } as unknown as CreateDbParams;
  const database = await gateway.call(`databases.create ${key}`, (c) => c.databases.create(params));
  const dataSourceId = (database as { data_sources?: { id: string }[] }).data_sources?.[0]?.id;
  if (!dataSourceId) throw new AppError(`Création de la base ${def.titre} : data source absente de la réponse`);
  return { key, database_id: database.id, data_source_id: dataSourceId, properties: { ...def.properties } as PropertyMap };
}

async function addMissingProperties(gateway: NotionGateway, state: BaseState): Promise<number> {
  const missing: Record<string, PropertySchema> = {};
  for (const [name, schema] of Object.entries(BASES[state.key].properties)) {
    if (!(name in state.properties)) missing[name] = schema;
  }
  const count = Object.keys(missing).length;
  if (count === 0) return 0;
  const updated = await gateway.call(`dataSources.update ${state.key} (+${count} propriétés)`, (c) =>
    c.dataSources.update({ data_source_id: state.data_source_id, properties: missing as unknown as UpdateProps }),
  );
  state.properties = (updated as { properties: PropertyMap }).properties;
  return count;
}

async function ensureRelations(gateway: NotionGateway, states: Record<BaseKey, BaseState>, log: Logger): Promise<number> {
  let added = 0;
  for (const rel of RELATIONS) {
    const from = states[rel.from];
    const to = states[rel.to];
    if (from.properties[rel.property]?.type === 'relation') continue;
    const updated = await gateway.call(`relation ${rel.from}.${rel.property} → ${rel.to}`, (c) =>
      c.dataSources.update({
        data_source_id: from.data_source_id,
        properties: {
          [rel.property]: { relation: { data_source_id: to.data_source_id, type: 'dual_property', dual_property: {} } },
        } as unknown as UpdateProps,
      }),
    );
    from.properties = (updated as { properties: PropertyMap }).properties;
    added += 1;
    const relation = from.properties[rel.property]?.relation as
      | { dual_property?: { synced_property_id?: string; synced_property_name?: string } }
      | undefined;
    const synced = relation?.dual_property;
    if (synced?.synced_property_id && synced.synced_property_name !== rel.syncedName) {
      const renamed = await gateway.call(`rename ${rel.to}.${synced.synced_property_name} → ${rel.syncedName}`, (c) =>
        c.dataSources.update({
          data_source_id: to.data_source_id,
          properties: { [synced.synced_property_id as string]: { name: rel.syncedName } } as unknown as UpdateProps,
        }),
      );
      to.properties = (renamed as { properties: PropertyMap }).properties;
    }
    log.info({ from: rel.from, property: rel.property, to: rel.to }, 'Relation bidirectionnelle posée');
  }
  return added;
}

async function ensureFormulas(gateway: NotionGateway, states: Record<BaseKey, BaseState>): Promise<number> {
  let added = 0;
  for (const formula of FORMULAS) {
    const state = states[formula.base];
    if (state.properties[formula.property]) continue;
    const updated = await gateway.call(`formula ${formula.base}.${formula.property}`, (c) =>
      c.dataSources.update({
        data_source_id: state.data_source_id,
        properties: { [formula.property]: { formula: { expression: formula.expression } } } as unknown as UpdateProps,
      }),
    );
    state.properties = (updated as { properties: PropertyMap }).properties;
    added += 1;
  }
  return added;
}

/**
 * Crée les six bases sous la page parente (idempotent : réutilise une base existante du même
 * titre, complète ses propriétés), pose les relations et la formule, écrit notion/ids.json.
 */
export async function initNotion(options: { gateway?: NotionGateway; log?: Logger } = {}): Promise<InitSummary> {
  const env = loadEnv();
  const config = requireNotionConfig(env);
  const log = options.log ?? logger;
  const gateway = options.gateway ?? new NotionGateway(config, { log });
  const existing = await listChildDatabases(gateway, config.parentPageId);

  const states = {} as Record<BaseKey, BaseState>;
  const created: BaseKey[] = [];
  const reused: BaseKey[] = [];
  let propertiesAdded = 0;
  for (const key of BASE_KEYS) {
    const titre = BASES[key].titre;
    const blockId = existing.get(titre);
    let state: BaseState | undefined;
    if (blockId) {
      try {
        state = await retrieveState(gateway, key, blockId);
      } catch (error) {
        log.warn({ key, err: (error as Error).message }, 'Base enfant trouvée mais non lisible par son id de bloc, recherche par titre');
        state = await findBySearch(gateway, key, titre);
      }
    }
    if (state) {
      reused.push(key);
      propertiesAdded += await addMissingProperties(gateway, state);
      log.info({ key, database_id: state.database_id }, 'Base existante réutilisée');
    } else {
      state = await createBase(gateway, config.parentPageId, key);
      created.push(key);
      log.info({ key, database_id: state.database_id }, 'Base créée');
    }
    states[key] = state;
  }

  const relationsAdded = await ensureRelations(gateway, states, log);
  const formulasAdded = await ensureFormulas(gateway, states);

  const previous = readNotionIds();
  const now = new Date().toISOString();
  const bases = {} as Record<BaseKey, NotionBaseIds>;
  for (const key of BASE_KEYS) {
    bases[key] = {
      titre: BASES[key].titre,
      database_id: states[key].database_id,
      data_source_id: states[key].data_source_id,
      proprietes: { ...P[key] },
    };
  }
  const ids: NotionIds = {
    parent_page_id: config.parentPageId,
    api_version: config.apiVersion,
    created_at: previous?.created_at ?? now,
    updated_at: now,
    bases,
  };
  writeNotionIds(ids);
  return { ids, created, reused, properties_added: propertiesAdded, relations_added: relationsAdded, formulas_added: formulasAdded, calls: gateway.calls };
}
