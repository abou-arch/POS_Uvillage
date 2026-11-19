import { describe, expect, it } from 'vitest';
import type { LocalCashMovement, LocalCashSession } from './cashSession';
import type { ReceiptData } from './receipt';
import {
  addDays, byCategory, customPeriod, byDay, byHour, byMethod, byProduct, csvMad, customerRows, dayKey, filterSales, hourOf, inPeriod,
  periodRange, previousPeriod, sessionRows, stockStatus, stockSummary, summarize, toCsv, variation, vatSummary,
} from './stats';
import { lineTotals, saleTotals } from './totals.js';
import type { Payment, Refund, RefundLine, Sale, SaleLine } from '../types';

const lineAmounts = (quantity: number, price: number, discount: number, tva: number) => {
  const t = lineTotals(quantity, price, discount, tva);
  return { total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc };
};

// Fuseau UTC dans les tests : le résultat ne dépend pas des données de fuseaux installées sur la machine.
const TZ = 'UTC';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function line(product: string, quantity: number, price: number, tva: number, discount = 0, unit: 'unit' | 'kg' = 'unit'): SaleLine {
  return {
    id: uuid(Math.round(quantity * 1000) + price), product_id: product, name: product.toUpperCase(), unit, quantity,
    unit_price_ttc: price, discount, tva_rate: tva, ...lineAmounts(quantity, price, discount, tva),
  };
}

let counter = 0;
function sale(at: string, lines: SaleLine[], payments: Payment[] | 'cash' = 'cash', extra: Partial<Sale> = {}): Sale {
  counter += 1;
  const totals = saleTotals(lines, extra.other_charges ?? 0, extra.global_discount ?? 0);
  return {
    id: uuid(counter), number: `ST1-REG1-${String(counter).padStart(6, '0')}`, store_id: 'st_1', register_id: 'reg_1',
    session_id: 'ses_1', cashier_id: 'u_1', customer_id: null, created_at: at, lines, other_charges: 0, global_discount: 0,
    totals, payments: payments === 'cash' ? [{ method: 'cash', amount: totals.ttc }] : payments, amount_received: 0,
    change_given: 0, send_sms: false, status: 'completed', ...extra,
  };
}

function refund(at: string, of: Sale, lines: RefundLine[], method: Payment['method'] = 'cash', extra: Partial<Refund> = {}): Refund {
  const totals = lines.reduce((t, l) => ({ ht: t.ht + l.total_ht, tva: t.tva + l.total_tva, ttc: t.ttc + l.total_ttc }), { ht: 0, tva: 0, ttc: 0 });
  return {
    id: uuid(900 + counter++), number: 'R-1', store_id: 'st_1', register_id: 'reg_1', session_id: of.session_id,
    original_sale_id: of.id, cashier_id: 'u_1', customer_id: of.customer_id, created_at: at, reason: 'changed_mind',
    reason_text: null, lines, totals, payments: [{ method, amount: totals.ttc }], ...extra,
  };
}

const rline = (l: SaleLine, quantity: number, index = 0): RefundLine => ({
  original_line_id: l.id ?? null, line_index: index, product_id: l.product_id, name: l.name, unit: l.unit, quantity,
  unit_price_ttc: l.unit_price_ttc, tva_rate: l.tva_rate, ...lineAmounts(quantity, l.unit_price_ttc, 0, l.tva_rate),
});

describe('jours et périodes', () => {
  it('jour et heure dans le fuseau ; calendrier sans fuseau', () => {
    expect(dayKey('2026-11-18T23:30:00Z', TZ)).toBe('2026-11-18');
    expect(hourOf('2026-11-18T23:30:00Z', TZ)).toBe(23);
    expect(hourOf('2026-11-18T00:05:00Z', TZ)).toBe(0);
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('aujourd’hui, hier, 7 et 30 jours, et la période d’avant', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(periodRange('today', now, TZ)).toEqual({ from: '2026-11-18', to: '2026-11-18', days: ['2026-11-18'] });
    expect(periodRange('yesterday', now, TZ).days).toEqual(['2026-11-17']);
    const week = periodRange('week', now, TZ);
    expect(week.from).toBe('2026-11-12');
    expect(week.days).toHaveLength(7);
    expect(periodRange('month', now, TZ).from).toBe('2026-10-20');
    expect(previousPeriod(week)).toMatchObject({ from: '2026-11-05', to: '2026-11-11' });
    expect(inPeriod('2026-11-12T00:00:00Z', week, TZ)).toBe(true);
    expect(inPeriod('2026-11-11T23:59:59Z', week, TZ)).toBe(false);
  });

  it('période choisie : dates valides, dans l’ordre, 366 jours au plus', () => {
    expect(customPeriod('2026-10-30', '2026-11-02')?.days).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(customPeriod('2026-11-02', '2026-11-02')?.days).toEqual(['2026-11-02']);
    expect(customPeriod('2026-11-03', '2026-11-02')).toBeNull();
    expect(customPeriod('2026-02-30', '2026-03-02')).toBeNull();
    expect(customPeriod('', '2026-03-02')).toBeNull();
    expect(customPeriod('2025-01-01', '2026-01-02')).toBeNull(); // 367 jours
    expect(customPeriod('2025-01-01', '2026-01-01')?.days).toHaveLength(366);
    expect(customPeriod('2025-01-01', '2025-12-31')?.days).toHaveLength(365);
  });
});

describe('indicateurs', () => {
  const a = sale('2026-11-18T08:10:00Z', [line('lait', 2, 750, 0), line('soda', 1, 1200, 20, 200)]);
  const b = sale('2026-11-18T08:40:00Z', [line('olives', 0.75, 2500, 0, 0, 'kg')], [{ method: 'card', amount: 1875 }]);
  const c = sale('2026-11-18T15:00:00Z', [line('pain', 3, 120, 0)], 'cash', { status: 'cancelled' });
  const r = refund('2026-11-18T16:00:00Z', a, [rline(a.lines[0], 1)]);

  it('vente annulée exclue ; retour déduit ; panier moyen ; remises ; pièces et kg', () => {
    const s = summarize([a, b, c], [r]);
    expect(s).toMatchObject({ tickets: 2, cancelled: 1, refunds: 1, units: 3, kg: 0.75, discounts: 200 });
    expect(s.gross).toBe(a.totals.ttc + b.totals.ttc);
    expect(s.refunded).toBe(750);
    expect(s.net).toBe(s.gross - 750);
    expect(s.netHt + s.netTva).toBe(s.net);
    expect(s.average).toBe(Math.round(s.gross / 2));
    expect(summarize([], []).average).toBe(0);
  });

  it('évolution en % ; pas de comparaison sans période d’avant', () => {
    expect(variation(1500, 1000)).toBe(50);
    expect(variation(500, 1000)).toBe(-50);
    expect(variation(500, 0)).toBeNull();
  });

  it('par heure et par jour', () => {
    const hours = byHour([a, b, c], TZ);
    expect(hours).toHaveLength(24);
    expect(hours[8]).toEqual({ hour: 8, ttc: a.totals.ttc + b.totals.ttc, tickets: 2 });
    expect(hours[15].tickets).toBe(0); // annulée
    const days = byDay([a, b, c], [r], periodRange('week', new Date('2026-11-18T20:00:00Z'), TZ), TZ);
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ day: '2026-11-18', net: a.totals.ttc + b.totals.ttc - 750, tickets: 2 });
    expect(days[0].net).toBe(0);
  });

  it('par moyen de paiement : remboursements déduits, ordre fixe', () => {
    expect(byMethod([a, b, c], [r])).toEqual([
      { method: 'cash', amount: a.totals.ttc - 750 }, { method: 'card', amount: 1875 },
      { method: 'mobile', amount: 0 }, { method: 'credit', amount: 0 },
    ]);
  });
});

describe('articles, catégories et TVA', () => {
  it('part réellement payée : la remise globale est répartie, la somme retombe sur le total', () => {
    const s = sale('2026-11-18T09:00:00Z', [line('lait', 2, 750, 0), line('soda', 1, 1200, 20)], 'cash', { global_discount: 101 });
    const rows = byProduct([s], []);
    expect(rows.reduce((t, p) => t + p.ttc, 0)).toBe(s.totals.ttc);
    expect(rows[0].product_id).toBe('lait'); // 1500 avant remise, devant 1200
  });

  it('retour déduit en quantité et en montant ; même article sur deux lignes regroupé ; kg au gramme', () => {
    const s = sale('2026-11-18T09:00:00Z', [line('lait', 2, 750, 0), line('lait', 1, 750, 0), line('olives', 0.75, 2500, 0, 0, 'kg')]);
    const r = refund('2026-11-18T10:00:00Z', s, [rline(s.lines[0], 1), rline(s.lines[2], 0.25, 2)]);
    const rows = byProduct([s], [r]);
    expect(rows.find((p) => p.product_id === 'lait')).toMatchObject({ quantity: 2, ttc: 1500, unit: 'unit' });
    expect(rows.find((p) => p.product_id === 'olives')).toMatchObject({ quantity: 0.5, ttc: 1875 - 625, unit: 'kg' });
  });

  it('par catégorie, article inconnu dans « Sans catégorie »', () => {
    const rows = byCategory(
      [{ product_id: 'lait', name: 'LAIT', unit: 'unit', quantity: 1, ttc: 500 }, { product_id: 'x', name: 'X', unit: 'unit', quantity: 1, ttc: 900 }],
      new Map([['lait', 'cat_1']]), new Map([['cat_1', 'Crèmerie']]),
    );
    expect(rows).toEqual([{ category_id: null, name: 'Sans catégorie', ttc: 900 }, { category_id: 'cat_1', name: 'Crèmerie', ttc: 500 }]);
  });

  it('TVA mixte 0 % et 20 %, retour déduit, HT + TVA = TTC par taux', () => {
    const s = sale('2026-11-18T09:00:00Z', [line('lait', 2, 750, 0), line('soda', 2, 1200, 20)]);
    const r = refund('2026-11-18T10:00:00Z', s, [rline(s.lines[1], 1, 1)]);
    const vat = vatSummary([s], [r]);
    expect(vat.map((v) => v.rate)).toEqual([20, 0]);
    expect(vat[0].ttc).toBe(1200);
    expect(vat[1].ttc).toBe(1500);
    for (const v of vat) expect(v.ht + v.tva).toBe(v.ttc);
  });
});

describe('ventes, sessions, clients', () => {
  const receipt = (s: Sale, customer: string | null = null): ReceiptData => ({ sale: s, cashier: 'Caissier', customer });

  it('filtre des ventes', () => {
    const a = sale('2026-11-18T09:00:00Z', [line('lait', 1, 750, 0)]);
    const b = sale('2026-11-18T09:05:00Z', [line('lait', 1, 750, 0)], [{ method: 'card', amount: 750 }]);
    const c = sale('2026-11-18T09:10:00Z', [line('lait', 1, 750, 0)], [{ method: 'card', amount: 750 }], { status: 'cancelled' });
    const rows = [receipt(a), receipt(b), receipt(c)];
    expect(filterSales(rows, 'all', new Set())).toHaveLength(3);
    expect(filterSales(rows, 'card', new Set()).map((r) => r.sale)).toEqual([b]);
    expect(filterSales(rows, 'cancelled', new Set()).map((r) => r.sale)).toEqual([c]);
    expect(filterSales(rows, 'refunded', new Set([a.id])).map((r) => r.sale)).toEqual([a]);
  });

  it('une ligne par session : ventes, retours, mouvements, espèces attendues, écart', () => {
    const session = (id: string, opened_at: string, closed: boolean): LocalCashSession => ({
      id, store_id: 'st_1', register_id: 'reg_1', opened_by: 'u_1', opened_at, opening_cash: 50000, opening_note: null,
      status: closed ? 'closed' : 'open', closed_by: closed ? 'u_1' : null, closed_at: closed ? opened_at : null,
      counts: closed ? [{ method: 'cash', expected: 57000, counted: 56000, difference: -1000 }, { method: 'card', expected: 8000, counted: 8000, difference: 0 }, { method: 'mobile', expected: 0, counted: 0, difference: 0 }] : null,
      cash_count: null, closing_note: null, opened_by_name: 'Caissier', closed_by_name: closed ? 'Caissier' : null,
    });
    const s1 = sale('2026-11-17T09:00:00Z', [line('soda', 10, 1200, 20)], 'cash', { session_id: 'ses_old' }); // 120 DH
    const s2 = sale('2026-11-17T09:30:00Z', [line('soda', 1, 8000, 20)], [{ method: 'card', amount: 8000 }], { session_id: 'ses_old' });
    const out: LocalCashMovement = { id: uuid(500), session_id: 'ses_old', type: 'out', amount: 5000, reason: 'Achat', created_by: 'u_1', created_at: '2026-11-17T10:00:00Z', cashier_name: 'Caissier' };
    const rows = sessionRows(
      [session('ses_old', '2026-11-17T08:00:00Z', true), session('ses_new', '2026-11-18T08:00:00Z', false)], [s1, s2], [], [out],
    );
    expect(rows.map((r) => r.session.id)).toEqual(['ses_new', 'ses_old']);
    expect(rows[1]).toMatchObject({ tickets: 2, net: 20000, cashOut: 5000, cashIn: 0, expectedCash: 57000, difference: -1000 });
    expect(rows[0]).toMatchObject({ tickets: 0, net: 0, expectedCash: 50000, difference: null });
  });

  it('clients : achats, crédit restant après retour, client de passage et ventes annulées écartés', () => {
    const c1 = 'cus_1';
    const a = sale('2026-11-17T09:00:00Z', [line('lait', 2, 750, 0)], [{ method: 'credit', amount: 1500 }], { customer_id: c1 });
    const b = sale('2026-11-18T09:00:00Z', [line('lait', 1, 750, 0)], 'cash', { customer_id: c1 });
    const x = sale('2026-11-18T09:30:00Z', [line('lait', 1, 750, 0)], 'cash', { customer_id: c1, status: 'cancelled' });
    const anon = sale('2026-11-18T10:00:00Z', [line('lait', 1, 750, 0)]);
    const r = refund('2026-11-18T11:00:00Z', a, [rline(a.lines[0], 1)], 'credit');
    const rows = customerRows([receipt(a, 'Ahmed'), receipt(b, 'Ahmed Benani'), receipt(x, 'Ahmed'), receipt(anon)], [r]);
    expect(rows).toEqual([{ customer_id: c1, name: 'Ahmed Benani', purchases: 2, net: 1500, credit: 750, last: '2026-11-18T09:00:00Z' }]);
  });
});

describe('stock et export', () => {
  it('rupture, stock bas, valeur du stock', () => {
    expect(stockStatus({ stock: 0, stock_alert: 5 })).toBe('out');
    expect(stockStatus({ stock: -2, stock_alert: 5 })).toBe('out');
    expect(stockStatus({ stock: 5, stock_alert: 5 })).toBe('low');
    expect(stockStatus({ stock: 6, stock_alert: 5 })).toBe('ok');
    expect(stockSummary([
      { stock: 10, stock_alert: 2, price_ttc: 750, unit: 'unit' },
      { stock: 1.5, stock_alert: 2, price_ttc: 2500, unit: 'kg' },
      { stock: -1, stock_alert: 2, price_ttc: 999, unit: 'unit' },
    ])).toEqual({ count: 3, out: 1, low: 1, value: 7500 + 3750 });
  });

  it('CSV français : « ; », guillemets, formules neutralisées, montants à virgule', () => {
    expect(csvMad(123450)).toBe('1234,50');
    expect(csvMad(-5)).toBe('-0,05');
    expect(toCsv([['Ticket', 'Client', 'Total'], ['ST1-1', 'Dupont; "Ali"', csvMad(-1500)], ['=SOMME(A1)', '@x', 3]]))
      .toBe('Ticket;Client;Total\r\nST1-1;"Dupont; ""Ali""";-15,00\r\n\'=SOMME(A1);\'@x;3');
  });
});
