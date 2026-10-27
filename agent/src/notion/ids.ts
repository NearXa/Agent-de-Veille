import { readJson, writeJsonAtomic, fileExists } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import type { BaseKey } from './schema.js';

export interface NotionBaseIds {
  titre: string;
  database_id: string;
  data_source_id: string;
  /** Noms des propriétés (clé interne → libellé Notion), lus par le cockpit. */
  proprietes: Record<string, string>;
}

export interface NotionIds {
  parent_page_id: string;
  api_version: string;
  created_at: string;
  updated_at: string;
  bases: Record<BaseKey, NotionBaseIds>;
}

export const notionIdsFile = (): string => paths.notion('ids.json');

export function readNotionIds(): NotionIds | undefined {
  const file = notionIdsFile();
  return fileExists(file) ? readJson<NotionIds>(file) : undefined;
}

export function writeNotionIds(ids: NotionIds): void {
  writeJsonAtomic(notionIdsFile(), ids);
}

/** Cache local ID métier → page_id Notion (évite une requête par page à chaque push). */
export type PagesMap = Record<string, string>;

export const pagesMapFile = (): string => paths.notion('pages-map.json');

export function readPagesMap(): PagesMap {
  return readJson<PagesMap>(pagesMapFile(), {});
}

export function writePagesMap(map: PagesMap): void {
  writeJsonAtomic(pagesMapFile(), map);
}
