import { describe, expect, it } from 'vitest';
import { allocate, lineTotals, paidByLine, refundLine, saleTotals, vatBreakdown, vatBreakdownOfLines } from './totals.js';

const line = (quantity, unit_price_ttc, tva_rate, discount = 0) => ({ quantity, unit_price_ttc, discount, tva_rate });

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
    // +30 réparti au prorata (200 / 150) : 17 à 20 %, 13 à 0 %.
    expect(saleTotals([line(2, 100, 20), line(1, 150, 0)], 50, 20)).toEqual({ ht: 344, tva: 36, ttc: 380 });
  });
});

describe('TVA des autres charges et de la remise globale (au prorata des taux)', () => {
  it('répartit la remise globale entre les taux', () => {
    // 10 DH à 20 % + 5 DH à 0 %, remise de 3 DH : 2 DH sur le 20 %, 1 DH sur le 0 %.
    expect(vatBreakdown([line(1, 1000, 20), line(1, 500, 0)], 0, 300)).toEqual([
      { rate: 20, ht: 667, tva: 133, ttc: 800 },
      { rate: 0, ht: 400, tva: 0, ttc: 400 },
    ]);
    expect(saleTotals([line(1, 1000, 20), line(1, 500, 0)], 0, 300)).toEqual({ ht: 1067, tva: 133, ttc: 1200 });
  });
  it('répartit les autres charges de la même façon', () => {
    expect(vatBreakdown([line(1, 1000, 20), line(1, 1000, 7)], 200)).toEqual([
      { rate: 20, ht: 917, tva: 183, ttc: 1100 },
      { rate: 7, ht: 1028, tva: 72, ttc: 1100 },
    ]);
  });
  it('donne toujours HT + TVA = TTC, par taux et pour la vente', () => {
    const baskets = [
      [[line(3, 333, 20), line(1, 999, 14), line(2, 1, 10), line(0.375, 2150, 7), line(5, 150, 0)], 157, 389],
      [[line(1, 1, 20), line(1, 1, 0)], 1, 0],
      [[line(7, 1299, 20, 500)], 0, 8000],
    ];
    for (const [lines, charges, discount] of baskets) {
      const groups = vatBreakdown(lines, charges, discount);
      for (const g of groups) expect(g.ht + g.tva).toBe(g.ttc);
      const t = saleTotals(lines, charges, discount);
      const linesTtc = lines.reduce((s, l) => s + lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate).ttc, 0);
      expect(t.ttc).toBe(linesTtc + charges - discount);
      expect(t.ht + t.tva).toBe(t.ttc);
    }
  });
  it('donne le même récapitulatif à partir des total_ttc enregistrés des lignes (ticket)', () => {
    const lines = [line(3, 333, 20), line(1, 999, 14, 99), line(0.375, 2150, 7), line(5, 150, 0)];
    const stored = lines.map((l) => ({ tva_rate: l.tva_rate, total_ttc: lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate).ttc }));
    expect(vatBreakdownOfLines(stored, 157, 389)).toEqual(vatBreakdown(lines, 157, 389));
  });
  it('met tout sur le taux le plus élevé quand les lignes ne coûtent rien', () => {
    expect(vatBreakdown([line(1, 500, 0, 500), line(1, 300, 20, 300)], 120)).toEqual([
      { rate: 20, ht: 100, tva: 20, ttc: 120 },
      { rate: 0, ht: 0, tva: 0, ttc: 0 },
    ]);
  });
  it('ne perd aucun centime en répartissant', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(7, [1000, 0, 3000])).toEqual([2, 0, 5]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('montant remboursé lors d’un retour (§7)', () => {
  const stored = (total_ttc, tva_rate) => ({ total_ttc, tva_rate });

  it('payé de chaque ligne : la remise globale est répartie par taux, puis entre les lignes du taux', () => {
    // 20 % : 1 500 de TTC, 0 % : 500 → remise de 300 : 225 sur le 20 % (150 + 75), 75 sur le 0 %.
    const paid = paidByLine([stored(1000, 20), stored(500, 0), stored(500, 20)], 0, 300);
    expect(paid).toEqual([850, 425, 425]);
    expect(paid.reduce((s, p) => s + p, 0)).toBe(1700);
  });
  it('payé de chaque ligne : les autres charges s’ajoutent, sans centime perdu', () => {
    const paid = paidByLine([stored(333, 20), stored(333, 20), stored(334, 20)], 100, 0);
    expect(paid.reduce((s, p) => s + p, 0)).toBe(1100);
    expect(paidByLine([stored(500, 20)])).toEqual([500]);
  });
  it('payé de chaque ligne : à TTC nul, tout va sur la première ligne du taux le plus élevé', () => {
    expect(paidByLine([stored(0, 0), stored(0, 20), stored(0, 20)], 120, 0)).toEqual([0, 120, 0]);
  });
  it('exemple du contrat : 3 articles payés 29 DH, retournés en 1 puis 2', () => {
    expect(refundLine(2900, 20, 3, 0, 1)).toEqual({ ht: 806, tva: 161, ttc: 967 });
    expect(refundLine(2900, 20, 3, 1, 2)).toEqual({ ht: 1611, tva: 322, ttc: 1933 });
  });
  it('retours un par un : la somme est exactement le payé', () => {
    const parts = [0, 1, 2, 3, 4, 5].map((r) => refundLine(1001, 20, 7, r, 1).ttc);
    const last = refundLine(1001, 20, 7, 6, 1).ttc;
    expect([...parts, last].reduce((s, p) => s + p, 0)).toBe(1001);
  });
  it('articles au poids : calcul en millièmes', () => {
    expect(refundLine(1234, 0, 1.5, 0, 0.5).ttc).toBe(411);
    expect(refundLine(1234, 0, 1.5, 0.5, 1).ttc).toBe(823);
  });
});
