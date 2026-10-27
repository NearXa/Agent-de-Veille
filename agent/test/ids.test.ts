import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdRegistry, formatId } from '../src/store/ids.js';
import { useTmpRoot } from './helpers/tmp-root.js';

describe('IdRegistry', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
  });
  afterEach(() => tmp.cleanup());

  it('formate les identifiants sur quatre chiffres minimum', () => {
    expect(formatId('EX', 7)).toBe('EX-0007');
    expect(formatId('TX', 12345)).toBe('TX-12345');
  });

  it('réutilise le même ID pour la même clé et ne renumérote jamais', () => {
    const registry = IdRegistry.load();
    const key1 = IdRegistry.makeKey('EX', [
      'TX-0001',
      'Art. 6 §1',
      'Cadre de gestion du risque TIC',
    ]);
    const key2 = IdRegistry.makeKey('EX', [
      'TX-0001',
      'art 6 §1',
      'cadre de gestion du risque tic',
    ]);
    const first = registry.resolve('EX', key1);
    const second = registry.resolve('EX', key2);
    expect(first).toEqual({ id: 'EX-0001', created: true });
    expect(second).toEqual({ id: 'EX-0001', created: false });
    const third = registry.resolve('EX', IdRegistry.makeKey('EX', ['TX-0001', 'Art. 7', 'Autre']));
    expect(third.id).toBe('EX-0002');
    registry.save();

    const reloaded = IdRegistry.load();
    expect(reloaded.lookup(key1)).toBe('EX-0001');
    expect(reloaded.counter('EX')).toBe(2);
    expect(reloaded.next('EX')).toBe('EX-0003');
    expect(reloaded.next('TX')).toBe('TX-0001');
  });
});
