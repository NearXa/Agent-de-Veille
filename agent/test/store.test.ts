import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonCollection } from '../src/store/repository.js';
import { ValidationRecordSchema, type ValidationRecord } from '../src/store/types.js';
import { useTmpRoot } from './helpers/tmp-root.js';

describe('JsonCollection', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
  });
  afterEach(() => tmp.cleanup());

  const record: ValidationRecord = {
    id: 'VAL-1',
    exigence_id: 'EX-0001',
    action: 'Validée',
    validateur: 'N. Kaci',
    date: '2026-10-27T16:01:00.000Z',
    commentaire: null,
    champs_modifies: null,
    source: 'cockpit',
  };

  it('lit une collection absente comme vide, puis upsert sans doublon', () => {
    const collection = new JsonCollection<ValidationRecord>('validations', ValidationRecordSchema);
    expect(collection.readAll()).toEqual([]);
    collection.upsert(record);
    collection.upsert({ ...record, commentaire: 'ok' });
    collection.upsert({ ...record, id: 'VAL-2' });
    const all = collection.readAll();
    expect(all).toHaveLength(2);
    expect(all[0]?.commentaire).toBe('ok');
    expect(collection.findById('VAL-2')?.id).toBe('VAL-2');
  });

  it('rejette un enregistrement invalide à la lecture', () => {
    const collection = new JsonCollection<ValidationRecord>('validations', ValidationRecordSchema);
    const raw = new JsonCollection<{ id: string }>('validations');
    raw.writeAll([{ id: 'VAL-1' }]);
    expect(() => collection.readAll()).toThrow(/invalide/);
  });
});
