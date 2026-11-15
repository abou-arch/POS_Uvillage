import { describe, expect, it } from 'vitest';
import { formatMad } from './totals.js';
import { fitsUnit, formatQuantity, lineUnit, quantityDetail, unitPrice } from './units';

describe('unités de vente (contrat 0.7)', () => {
  it('affichage d’une ligne : « 0,750 kg × 25,00 DH/kg » au poids, « 2 × 1,50 DH » à la pièce', () => {
    expect(quantityDetail(0.75, 2500, 'kg')).toBe(`0,750 kg × ${formatMad(2500)}/kg`);
    expect(quantityDetail(2, 150, 'unit')).toBe(`2 × ${formatMad(150)}`);
    expect(formatQuantity(1.5, 'kg')).toBe('1,500 kg');
    expect(unitPrice(2500, 'kg')).toBe(`${formatMad(2500)}/kg`);
  });

  it('ligne d’avant le contrat 0.7, sans unité : au poids si la quantité est décimale', () => {
    expect(lineUnit({ quantity: 0.375 })).toBe('kg');
    expect(lineUnit({ quantity: 2 })).toBe('unit');
    expect(lineUnit({ unit: 'kg', quantity: 2 })).toBe('kg');
  });

  it('quantité conforme à l’unité', () => {
    expect(fitsUnit('unit', 2)).toBe(true);
    expect(fitsUnit('unit', 1.5)).toBe(false);
    expect(fitsUnit('kg', 0.375)).toBe(true);
    expect(fitsUnit('kg', 0.1 + 0.2)).toBe(true); // 0,30000000000000004 : arrondi flottant, toujours au gramme
    expect(fitsUnit('kg', 0.3755)).toBe(false);
  });
});
