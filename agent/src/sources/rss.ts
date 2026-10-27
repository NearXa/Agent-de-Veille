import { XMLParser } from 'fast-xml-parser';
import { collapseWhitespace } from '../utils/text.js';

export interface FeedItem {
  titre: string;
  lien: string;
  date: string | null;
  description: string | null;
  guid: string | null;
}

export interface Feed {
  titre: string | null;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>))
    return text((value as Record<string, unknown>)['#text']);
  if (Array.isArray(value)) return text(value[0]);
  return '';
}

function toIso(value: unknown): string | null {
  const raw = text(value).replace(/^([A-Za-z]{3}),(\S)/, '$1, $2');
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function atomLink(value: unknown): string {
  const links = asArray(value as Record<string, unknown> | Record<string, unknown>[]);
  const alternate = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
  return alternate ? text(alternate['@_href'] ?? alternate) : '';
}

/** Parse un flux RSS 2.0 ou Atom en liste d'entrées normalisées (titre, lien, date ISO, description). */
export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    const items = asArray(channel.item as Record<string, unknown>[]).map((item) => ({
      titre: collapseWhitespace(text(item.title)),
      lien: text(item.link).trim(),
      date: toIso(item.pubDate ?? item['dc:date']),
      description: collapseWhitespace(text(item.description)) || null,
      guid: text(item.guid).trim() || null,
    }));
    return { titre: collapseWhitespace(text(channel.title)) || null, items };
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const items = asArray(feed.entry as Record<string, unknown>[]).map((entry) => ({
      titre: collapseWhitespace(text(entry.title)),
      lien: atomLink(entry.link),
      date: toIso(entry.updated ?? entry.published),
      description: collapseWhitespace(text(entry.summary ?? entry.content)) || null,
      guid: text(entry.id).trim() || null,
    }));
    return { titre: collapseWhitespace(text(feed.title)) || null, items };
  }
  return { titre: null, items: [] };
}

/** Entrées publiées après `since` (ISO 8601) ; sans date, l'entrée est conservée. */
export function itemsSince(items: FeedItem[], since?: string): FeedItem[] {
  if (!since) return items;
  const limit = new Date(since).getTime();
  return items.filter((item) => item.date === null || new Date(item.date).getTime() > limit);
}
