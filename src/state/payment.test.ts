import { describe, expect, it } from 'vitest';
import { cashError, MAX_CHANGE, paymentsError } from './payment';

describe('espèces', () => {
  it('accepte un montant suffisant', () => {
    expect(cashError(1150, 2000)).toBeNull();
    expect(cashError(1150, 1150)).toBeNull();
  });
  it('refuse un montant insuffisant, invalide ou aberrant', () => {
    expect(cashError(1150, 1000)).toMatch(/^Il manque 1,50/);
    expect(cashError(1150, null)).toBe('Montant reçu invalide.');
    expect(cashError(1150, 1150 + MAX_CHANGE + 1)).toMatch(/vérifiez le montant reçu/);
  });
});

describe('paiements', () => {
  it('accepte plusieurs moyens dont la somme fait le total', () => {
    expect(paymentsError(12000, [{ method: 'cash', amount: 2000 }, { method: 'card', amount: 10000 }], false)).toBeNull();
  });
  it('signale ce qui reste à payer ou le trop perçu', () => {
    expect(paymentsError(12000, [{ method: 'card', amount: 10000 }], false)).toMatch(/^Reste à payer : 20,00/);
    expect(paymentsError(12000, [{ method: 'card', amount: 12500 }], false)).toMatch(/^Trop perçu : 5,00/);
  });
  it('refuse le crédit sans client', () => {
    const credit = [{ method: 'cash' as const, amount: 2000 }, { method: 'credit' as const, amount: 10000 }];
    expect(paymentsError(12000, credit, false)).toMatch(/demande un client/);
    expect(paymentsError(12000, credit, true)).toBeNull();
  });
  it('refuse les montants nuls, négatifs ou non entiers', () => {
    for (const amount of [0, -100, 12.5, NaN]) {
      expect(paymentsError(12000, [{ method: 'card', amount }], false)).toBe('Chaque paiement doit avoir un montant.');
    }
  });
  it('refuse une vente sans rien à payer', () => {
    expect(paymentsError(0, [], false)).toBe('Rien à payer.');
  });
});
