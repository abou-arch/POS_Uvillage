import { describe, expect, it } from 'vitest';
import { code128, code128Values, PATTERNS } from './code128';

describe('table du Code 128', () => {
  it('107 symboles différents, de 11 modules (13 pour le stop)', () => {
    expect(PATTERNS).toHaveLength(107);
    expect(new Set(PATTERNS).size).toBe(107);
    PATTERNS.forEach((p, v) => {
      const widths = [...p].map(Number);
      expect(widths.every((w) => w >= 1 && w <= 4)).toBe(true);
      expect(widths.reduce((s, w) => s + w, 0)).toBe(v === 106 ? 13 : 11);
    });
  });
  it('parité : les barres de chaque symbole font un nombre pair de modules', () => {
    for (const p of PATTERNS) {
      const bars = [...p].map(Number).filter((_, i) => i % 2 === 0);
      expect(bars.reduce((s, w) => s + w, 0) % 2).toBe(0);
    }
  });
});

describe('codage', () => {
  it('texte seul en jeu B, avec la clé de contrôle', () => {
    // Start B (104) + P, J, J, 1, 2, 3, C ; clé = (104 + 48 + 42×2 + 42×3 + 17×4 + 18×5 + 19×6 + 35×7) mod 103 = 55.
    expect(code128Values('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });
  it('numéro de ticket : la suite de 6 chiffres passe en jeu C', () => {
    const values = code128Values('ST2-REG3-000123');
    expect(values.slice(0, 10)).toEqual([104, 51, 52, 18, 13, 50, 37, 39, 19, 13]);
    expect(values.slice(10, 14)).toEqual([99, 0, 1, 23]);
    expect(values.at(-1)).toBe(106);
    const check = values.slice(0, -2).reduce((s, v, k) => s + v * Math.max(k, 1), 0) % 103;
    expect(values.at(-2)).toBe(check);
  });
  it('nombre impair de chiffres : le dernier reste en jeu B', () => {
    expect(code128Values('12345')).toEqual([105, 12, 34, 100, 21, expect.any(Number), 106]);
  });
  it('largeurs : barre d’abord, stop à la fin, longueur totale en modules', () => {
    const widths = code128('R-ST2-REG3-000004');
    const values = code128Values('R-ST2-REG3-000004');
    expect(widths.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]); // Start B
    expect(widths.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]); // Stop
    expect(widths.reduce((s, w) => s + w, 0)).toBe(11 * (values.length - 1) + 13);
  });
  it('refuse un texte vide ou un caractère non imprimable', () => {
    expect(() => code128('')).toThrow('vide');
    expect(() => code128('ST1é')).toThrow('impossible');
  });
});
