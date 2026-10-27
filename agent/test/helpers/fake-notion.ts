/** Faux client Notion en mémoire : bases, data sources, pages, relations, commentaires. */
import type { Client } from '@notionhq/client';

interface FakeDataSource {
  id: string;
  database_id: string;
  name: string;
  properties: Record<string, Record<string, unknown>>;
}

interface FakePage {
  id: string;
  data_source_id: string;
  properties: Record<string, unknown>;
}

export class FakeNotion {
  databases = new Map<
    string,
    { id: string; title: string; parent_page_id: string; data_sources: string[] }
  >();
  dataSources = new Map<string, FakeDataSource>();
  pages = new Map<string, FakePage>();
  comments: { page_id: string; text: string }[] = [];
  calls: string[] = [];
  private counter = 0;

  constructor(readonly parentPageId = 'page-parent') {}

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(3, '0')}`;
  }

  private dsResponse(ds: FakeDataSource) {
    return {
      object: 'data_source',
      id: ds.id,
      name: ds.name,
      properties: ds.properties,
      parent: { type: 'database_id', database_id: ds.database_id },
    };
  }

  /** Objet exposé aux appels `client.xxx` du code testé. */
  get client(): Client {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const fake = {
      blocks: {
        children: {
          list: async (args: { block_id: string }) => {
            self.calls.push('blocks.children.list');
            const results = Array.from(self.databases.values())
              .filter((db) => db.parent_page_id === args.block_id)
              .map((db) => ({
                object: 'block',
                id: db.id,
                type: 'child_database',
                child_database: { title: db.title },
              }));
            return { object: 'list', results, has_more: false, next_cursor: null };
          },
        },
      },
      databases: {
        create: async (args: {
          parent: { page_id: string };
          title: { text: { content: string } }[];
          initial_data_source: { properties: Record<string, Record<string, unknown>> };
        }) => {
          self.calls.push('databases.create');
          const id = self.nextId('db');
          const dsId = self.nextId('ds');
          const title = args.title[0]!.text.content;
          const props: Record<string, Record<string, unknown>> = {};
          for (const [name, schema] of Object.entries(args.initial_data_source.properties)) {
            const type = Object.keys(schema)[0]!;
            props[name] = { id: self.nextId('prop'), type, ...schema };
          }
          self.databases.set(id, {
            id,
            title,
            parent_page_id: args.parent.page_id,
            data_sources: [dsId],
          });
          self.dataSources.set(dsId, { id: dsId, database_id: id, name: title, properties: props });
          return {
            object: 'database',
            id,
            title: [{ plain_text: title }],
            data_sources: [{ id: dsId, name: title }],
          };
        },
        retrieve: async (args: { database_id: string }) => {
          self.calls.push('databases.retrieve');
          const db = self.databases.get(args.database_id);
          if (!db)
            throw Object.assign(new Error('not found'), {
              code: 'object_not_found',
              status: 404,
              name: 'APIResponseError',
            });
          return {
            object: 'database',
            id: db.id,
            data_sources: db.data_sources.map((id) => ({ id, name: db.title })),
          };
        },
      },
      dataSources: {
        retrieve: async (args: { data_source_id: string }) => {
          self.calls.push('dataSources.retrieve');
          return self.dsResponse(self.dataSources.get(args.data_source_id)!);
        },
        update: async (args: {
          data_source_id: string;
          properties: Record<string, Record<string, unknown> | null>;
        }) => {
          self.calls.push('dataSources.update');
          const ds = self.dataSources.get(args.data_source_id)!;
          for (const [name, schema] of Object.entries(args.properties)) {
            if (schema === null) {
              delete ds.properties[name];
              continue;
            }
            const existingById = Object.entries(ds.properties).find(([, p]) => p.id === name);
            if (existingById && typeof schema.name === 'string') {
              const [oldName, prop] = existingById;
              delete ds.properties[oldName];
              ds.properties[schema.name] = prop;
              continue;
            }
            const type = Object.keys(schema)[0]!;
            const prop: Record<string, unknown> = { id: self.nextId('prop'), type, ...schema };
            if (type === 'relation') {
              const rel = schema.relation as { data_source_id: string };
              const target = self.dataSources.get(rel.data_source_id)!;
              const syncedId = self.nextId('prop');
              const syncedName = `Related to ${ds.name} (${name})`;
              target.properties[syncedName] = {
                id: syncedId,
                type: 'relation',
                relation: { data_source_id: ds.id, type: 'dual_property', dual_property: {} },
              };
              prop.relation = {
                data_source_id: rel.data_source_id,
                type: 'dual_property',
                dual_property: { synced_property_id: syncedId, synced_property_name: syncedName },
              };
            }
            ds.properties[name] = prop;
          }
          return self.dsResponse(ds);
        },
        query: async (args: {
          data_source_id: string;
          filter?: { property: string; title?: { equals: string } };
        }) => {
          self.calls.push('dataSources.query');
          const equals = args.filter?.title?.equals;
          const results = Array.from(self.pages.values())
            .filter((p) => p.data_source_id === args.data_source_id)
            .filter((p) => {
              if (!equals) return true;
              const title = (
                p.properties[args.filter!.property] as
                  { title?: { text: { content: string } }[] } | undefined
              )?.title?.[0]?.text.content;
              return title === equals;
            })
            .map((p) => ({ object: 'page', id: p.id, properties: p.properties }));
          return { object: 'list', results, has_more: false, next_cursor: null };
        },
      },
      pages: {
        retrieve: async (args: { page_id: string }) => {
          self.calls.push('pages.retrieve');
          const page = self.pages.get(args.page_id)!;
          return { object: 'page', id: page.id, properties: page.properties };
        },
        create: async (args: {
          parent: { data_source_id: string };
          properties: Record<string, unknown>;
        }) => {
          self.calls.push('pages.create');
          const id = self.nextId('page');
          self.pages.set(id, {
            id,
            data_source_id: args.parent.data_source_id,
            properties: { ...args.properties },
          });
          return { object: 'page', id };
        },
        update: async (args: { page_id: string; properties: Record<string, unknown> }) => {
          self.calls.push('pages.update');
          const page = self.pages.get(args.page_id)!;
          page.properties = { ...page.properties, ...args.properties };
          return { object: 'page', id: page.id };
        },
      },
      search: async () => {
        self.calls.push('search');
        return { object: 'list', results: [], has_more: false, next_cursor: null };
      },
      comments: {
        create: async (args: {
          parent: { page_id: string };
          rich_text: { text: { content: string } }[];
        }) => {
          self.calls.push('comments.create');
          self.comments.push({
            page_id: args.parent.page_id,
            text: args.rich_text.map((r) => r.text.content).join(''),
          });
          return { object: 'comment', id: self.nextId('comment') };
        },
      },
    };
    return fake as unknown as Client;
  }
}
