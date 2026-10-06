import { describe, expect, it } from 'vitest';
import { lineTotals, saleTotals } from './totals.js';

describe('totaux', () => {
  it('décompose un TTC à 20 %', () => {
    expect(lineTotals(2, 100, 0, 20)).toEqual({ ht: 167, tva: 33, ttc: 200 });
  });
  it('applique la remise de ligne avant la TVA', () => {
    expect(lineTotals(1, 1000, 100, 20)).toEqual({ ht: 750, tva: 150, ttc: 900 });
  });
  it('gère un taux à 0 %', () => {
    expect(lineTotals(3, 150, 0, 0)).toEqual({ ht: 450, tva: 0, ttc: 450 });
  });
  it('additionne les lignes, les charges et la remise globale', () => {
    const lines = [
      { quantity: 2, unit_price_ttc: 100, discount: 0, tva_rate: 20 },
      { quantity: 1, unit_price_ttc: 150, discount: 0, tva_rate: 0 },
    ];
    expect(saleTotals(lines, 50, 20)).toEqual({ ht: 317, tva: 33, ttc: 380 });
  });
});
