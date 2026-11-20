import { describe, expect, it } from 'vitest';
import { emptyCart } from '../state/cart';
import type { CartLine, Payment, Sale } from '../types';
import { buildSale } from './buildSale';
import { buildCancel, cancelBlocker, CancelError, cancelGiveBack, cancelKey, isSaleCancel } from './cancelSale';
import { expectedByMethod, sessionReport } from './cashSession';
import { formatMad } from './totals.js';

const SESSION = '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f';
const OTHER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const line = (product_id: string, quantity: number, unit_price_ttc: number): CartLine =>
  ({ product_id, name: product_id, unit: Number.isInteger(quantity) ? 'unit' : 'kg', quantity, unit_price_ttc, discount: 0, tva_rate: 20, stock: 100 });

let counter = 0;
function sale(payments: Payment[], sessionId = SESSION, lines = [line('p_1', 2, 1000)]): Sale {
  counter += 1;
  return buildSale({
    cart: { ...emptyCart, lines, customer: { id: 'c_1', name: 'Ahmed', phone: null, matricule: null } },
    storeId: 'st_2', registerId: 'reg_3', sessionId, cashierId: 'u_2', payments,
    amountReceived: payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0),
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, counter, now: new Date('2026-11-19T09:00:00Z'),
    lineIds: lines.map((_, i) => `10000000-0000-4000-8000-${String(counter * 10 + i).padStart(12, '0')}`),
  });
}

describe('annulation d’une vente à la caisse (§5, contrat 0.8)', () => {
  const paid = sale([{ method: 'cash', amount: 1500 }, { method: 'card', amount: 500 }]);

  it('permise pour une vente de la session ouverte, sans retour, quand les espèces à rendre sont dans le tiroir', () => {
    expect(cancelBlocker(paid, SESSION, [], 1500)).toBeNull();
  });

  it('refusée : déjà annulée, autre session, retour déjà fait, espèces insuffisantes', () => {
    expect(cancelBlocker({ ...paid, status: 'cancelled' }, SESSION, [], 1e6)).toBe('Cette vente est déjà annulée.');
    expect(cancelBlocker(sale([{ method: 'cash', amount: 2000 }], OTHER), SESSION, [], 1e6)).toMatch(/faites un retour/);
    expect(cancelBlocker(paid, SESSION, [{ original_sale_id: paid.id }], 1e6)).toMatch(/déjà un retour/);
    expect(cancelBlocker(paid, SESSION, [{ original_sale_id: 'autre' }], 1e6)).toBeNull();
    expect(cancelBlocker(paid, SESSION, [], 1499)).toBe(`Il faut rendre ${formatMad(1500)} en espèces, et il n’y a que ${formatMad(1499)} attendus dans la caisse.`);
  });

  it('ce qu’on rend au client, moyen par moyen ; le crédit est effacé, pas rendu', () => {
    expect(cancelGiveBack(paid.payments)).toEqual([
      { method: 'cash', label: 'Rendre en espèces', amount: 1500 }, { method: 'card', label: 'Rendre en carte', amount: 500 },
    ]);
    expect(cancelGiveBack([{ method: 'credit', amount: 800 }, { method: 'mobile', amount: 1200 }])).toEqual([
      { method: 'credit', label: 'Crédit effacé du compte client', amount: 800 }, { method: 'mobile', label: 'Rendre en mobile', amount: 1200 },
    ]);
  });

  it('opération mise en file : vente, session, magasin, articles à remettre en stock, qui a autorisé', () => {
    const cancel = buildCancel({ sale: paid, openSessionId: SESSION, refunds: [], cashAvailable: 1e6, approvedBy: 'u_3' });
    expect(cancel).toEqual({
      sale_id: paid.id, session_id: SESSION, store_id: 'st_2', approved_by: 'u_3', lines: [{ product_id: 'p_1', quantity: 2 }],
    });
    expect(isSaleCancel(cancel)).toBe(true);
    expect(cancelKey(paid.id)).toBe(`cancel:${paid.id}`);
    expect(() => buildCancel({ sale: paid, openSessionId: OTHER, refunds: [], cashAvailable: 1e6, approvedBy: null })).toThrow(CancelError);
  });

  it('relecture : une annulation abîmée est refusée', () => {
    const cancel = buildCancel({ sale: paid, openSessionId: SESSION, refunds: [], cashAvailable: 1e6, approvedBy: null });
    for (const bad of [
      { ...cancel, sale_id: 'x' }, { ...cancel, session_id: 'x' }, { ...cancel, store_id: '' }, { ...cancel, approved_by: 3 },
      { ...cancel, lines: [{ product_id: 'p_1', quantity: -1 }] }, { ...cancel, lines: 'p_1' }, null,
    ]) expect(isSaleCancel(bad), JSON.stringify(bad)).toBe(false);
  });

  it('une vente annulée ne compte ni dans les attendus ni dans le rapport : elle est seulement dénombrée', () => {
    const kept = sale([{ method: 'cash', amount: 2000 }]);
    const cancelled = { ...sale([{ method: 'card', amount: 2000 }]), status: 'cancelled' as const };
    expect(expectedByMethod(10000, [kept, cancelled], [])).toEqual({ cash: 12000, card: 0, mobile: 0 });
    const report = sessionReport({ opening_cash: 10000, counts: null }, [kept, cancelled], []);
    expect(report.salesCount).toBe(1);
    expect(report.totals.ttc).toBe(2000);
    expect(report.byMethod.find((m) => m.method === 'card')?.amount).toBe(0);
    expect(report.vat).toHaveLength(1);
    expect(report.vat[0].ttc).toBe(2000);
    expect([report.cancelledCount, report.cancelledTotal]).toEqual([1, 2000]);
  });
});
