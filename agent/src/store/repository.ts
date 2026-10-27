import type { z } from 'zod';
import { AppError, formatZodIssues } from '../utils/errors.js';
import { readJson, writeJsonAtomic } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import {
  ControleRecordSchema,
  ExigenceRecordSchema,
  JurisprudenceRecordSchema,
  LotRecordSchema,
  RisqueRecordSchema,
  TexteRecordSchema,
  ValidationRecordSchema,
  type ControleRecord,
  type ExigenceRecord,
  type JurisprudenceRecord,
  type LotRecord,
  type RisqueRecord,
  type StoreCollectionName,
  type TexteRecord,
  type ValidationRecord,
} from './types.js';

/** Collection JSON persistée dans `data/store/<nom>.json`, validée par Zod à la lecture. */
export class JsonCollection<T extends { id: string }> {
  constructor(
    readonly name: StoreCollectionName,
    private readonly schema?: z.ZodType<T>,
  ) {}

  get file(): string {
    return paths.store(`${this.name}.json`);
  }

  readAll(): T[] {
    const items = readJson<unknown[]>(this.file, []);
    if (!Array.isArray(items)) {
      throw new AppError(`${this.file} doit contenir un tableau JSON`);
    }
    if (!this.schema) return items as T[];
    const schema = this.schema;
    return items.map((item, index) => {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        throw new AppError(
          `${this.file} : enregistrement ${index} invalide : ${formatZodIssues(parsed.error)}`,
        );
      }
      return parsed.data;
    });
  }

  writeAll(items: T[]): void {
    writeJsonAtomic(this.file, items);
  }

  findById(id: string): T | undefined {
    return this.readAll().find((item) => item.id === id);
  }

  /** Remplace l'enregistrement de même `id` ou l'ajoute en fin de collection. */
  upsert(item: T): T {
    this.upsertMany([item]);
    return item;
  }

  upsertMany(items: T[]): void {
    const all = this.readAll();
    const index = new Map(all.map((item, i) => [item.id, i] as const));
    for (const item of items) {
      const existing = index.get(item.id);
      if (existing === undefined) {
        index.set(item.id, all.length);
        all.push(item);
      } else {
        all[existing] = item;
      }
    }
    this.writeAll(all);
  }

  count(): number {
    return this.readAll().length;
  }
}

/** Point d'accès unique au store local. */
export const store = {
  textes: new JsonCollection<TexteRecord>('textes', TexteRecordSchema),
  exigences: new JsonCollection<ExigenceRecord>('exigences', ExigenceRecordSchema),
  validations: new JsonCollection<ValidationRecord>('validations', ValidationRecordSchema),
  controles: new JsonCollection<ControleRecord>('controles', ControleRecordSchema),
  risques: new JsonCollection<RisqueRecord>('risques', RisqueRecordSchema),
  jurisprudence: new JsonCollection<JurisprudenceRecord>(
    'jurisprudence',
    JurisprudenceRecordSchema,
  ),
  lots: new JsonCollection<LotRecord>('lots', LotRecordSchema),
};
