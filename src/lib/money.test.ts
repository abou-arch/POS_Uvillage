import { describe, expect, it } from 'vitest';
import { madInput, parseMad } from './money';

describe('saisie des montants', () => {
  it('lit les dirhams avec virgule, point ou espaces', () => {
    expect(parseMad('12')).toBe(1200);
    expect(parseMad('12,5')).toBe(1250);
    expect(parseMad('12.50')).toBe(1250);
    expect(parseMad(' 1 000,00 ')).toBe(100000);
    expect(parseMad('0,29')).toBe(29);
  });
  it('refuse ce qui n’est pas un montant', () => {
    for (const bad of ['', 'abc', '-5', '12,345', '1,2,3', '12DH']) expect(parseMad(bad)).toBeNull();
  });
  it('affiche les centimes pour un champ de saisie', () => {
    expect(madInput(1250)).toBe('12,50');
    expect(madInput(20000)).toBe('200,00');
  });
});
