import { normalizeForMatch } from '../utils/text.js';
import { readJson, writeJsonAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import type { IdPrefix } from '../schemas/common.js';

interface RegistryFile {
  version: 1;
  counters: Partial<Record<IdPrefix, number>>;
  keys: Record<string, string>;
}

export function formatId(prefix: IdPrefix, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/**
 * Registre d'identifiants stables (`data/store/ids-registry.json`).
 * Une clé métier normalisée est associée une fois pour toutes à un ID ; un nouveau run réutilise
 * les IDs connus et n'en crée que pour les clés nouvelles. Aucune renumérotation.
 */
export class IdRegistry {
  private constructor(private readonly data: RegistryFile) {}

  static get file(): string {
    return paths.store('ids-registry.json');
  }

  static load(): IdRegistry {
    const data = readJson<RegistryFile>(IdRegistry.file, { version: 1, counters: {}, keys: {} });
    return new IdRegistry({ version: 1, counters: data.counters ?? {}, keys: data.keys ?? {} });
  }

  /** Construit une clé métier normalisée à partir de ses composantes. */
  static makeKey(prefix: IdPrefix, parts: string[]): string {
    return [prefix, ...parts.map((p) => normalizeForMatch(p))].join('|');
  }

  /** Renvoie l'ID associé à la clé, en le créant si nécessaire. */
  resolve(prefix: IdPrefix, key: string): { id: string; created: boolean } {
    const existing = this.data.keys[key];
    if (existing) return { id: existing, created: false };
    const id = this.next(prefix);
    this.data.keys[key] = id;
    return { id, created: true };
  }

  /** Alloue le prochain identifiant d'un préfixe, sans clé associée. */
  next(prefix: IdPrefix): string {
    const n = (this.data.counters[prefix] ?? 0) + 1;
    this.data.counters[prefix] = n;
    return formatId(prefix, n);
  }

  /** Associe une nouvelle clé à un identifiant existant (fusion par similarité). */
  alias(key: string, id: string): void {
    if (!this.data.keys[key]) this.data.keys[key] = id;
  }

  lookup(key: string): string | undefined {
    return this.data.keys[key];
  }

  counter(prefix: IdPrefix): number {
    return this.data.counters[prefix] ?? 0;
  }

  save(): void {
    writeJsonAtomic(IdRegistry.file, this.data);
  }
}
