import { describe, expect, it } from 'vitest';
import { sha256, shortHash } from '../src/utils/hash.js';

describe('sha256', () => {
  it('calcule les empreintes de référence', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it("change dès qu'un caractère change (détection de modification)", () => {
    expect(sha256('texte v1')).not.toBe(sha256('texte v2'));
    expect(shortHash('abc')).toBe('ba7816bf8f01');
  });
});
