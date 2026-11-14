import { describe, expect, it } from 'vitest';
import { emptyCart } from '../state/cart';
import type { CartLine, Customer, Payment, Refund, Sale } from '../types';
import {
  buildRefund, creditRemaining, defaultRefundPayments, isRefund, mergeRefunds, parseQuantity, quantitiesError, reasonError,
  refundLines, refundPaymentsError, refundTotals, returnableLines, saleRefundError, type RefundInput,
} from './buildRefund';
import { buildSale } from './buildSale';

const ahmed: Customer = { id: 'c_1', name: 'Ahmed', phone: null, matricule: null };
const lait: CartLine = { product_id: 'p_2', name: 'LAIT 1L', quantity: 3, unit_price_ttc: 1000, discount: 300, tva_rate: 20, stock: 50 };
const pain: CartLine = { product_id: 'p_1', name: 'PAIN NORMAL', quantity: 2, unit_price_ttc: 150, discount: 0, tva_rate: 0, stock: 60 };
const thon: CartLine = { product_id: 'p_9', name: 'THON', quantity: 1, unit_price_ttc: 1000, discount: 0, tva_rate: 20, stock: 20 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f';

function sale(lines: CartLine[], payments: Payment[], opts: { globalDiscount?: number; customer?: Customer | null } = {}): Sale {
  const total = payments.reduce((s, p) => s + p.amount, 0);
  return buildSale({
    cart: { ...emptyCart, lines, globalDiscount: opts.globalDiscount ?? 0, customer: opts.customer ?? null },
    storeId: 'st_2', registerId: 'reg_3', sessionId: SESSION, cashierId: 'u_2', payments, amountReceived: total,
    id: uuid(1), lineIds: lines.map((_, i) => uuid(100 + i)), counter: 12, now: new Date('2026-11-12T10:00:00Z'),
  });
}

// 3 articles dont un remisé, avec une remise globale de 1 DH : 39,00 DH payés en espèces.
const S = sale([lait, pain, thon], [{ method: 'cash', amount: 3900 }], { globalDiscount: 100 });

let next = 0;
function refund(s: Sale, refunds: Refund[], quantities: [number, number][], payments?: Payment[], extra: Partial<RefundInput> = {}): Refund {
  const lines = refundLines(returnableLines(s, refunds), new Map(quantities));
  const total = refundTotals(lines).ttc;
  next += 1;
  return buildRefund({
    sale: s, refunds, quantities: new Map(quantities), reason: 'changed_mind', reasonText: '',
    payments: payments ?? defaultRefundPayments(s, refunds, total), cashAvailable: 1_000_000,
    storeId: 'st_2', registerId: 'reg_3', sessionId: SESSION, cashierId: 'u_2', id: uuid(500 + next), counter: next,
    now: new Date('2026-11-12T16:05:00.456Z'), ...extra,
  });
}

describe('lignes retournables', () => {
  it('payé de chaque ligne : remise de ligne, puis part de la remise globale', () => {
    const rows = returnableLines(S, []);
    expect(rows.map((r) => r.paid)).toEqual([2632, 293, 975]);
    expect(rows.reduce((s, r) => s + r.paid, 0)).toBe(S.totals.ttc);
    expect(rows[0]).toMatchObject({ index: 0, sold: 3, returned: 0, remaining: 3 });
  });
  it('compte les retours précédents, sans doublon (API + file de la caisse)', () => {
    const first = refund(S, [], [[0, 1]]);
    const rows = returnableLines(S, [first, first]);
    expect(rows[0]).toMatchObject({ returned: 1, remaining: 2 });
    expect(mergeRefunds(S.id, [first], [first])).toEqual([first]);
    expect(mergeRefunds('autre', [first])).toEqual([]);
  });
});

describe('montant remboursé (§7)', () => {
  it('retour partiel : 1 lait sur 3, au prorata du payé', () => {
    const r = refund(S, [], [[0, 1]]);
    expect(r.lines).toEqual([{
      original_line_id: uuid(100), line_index: 0, product_id: 'p_2', name: 'LAIT 1L', quantity: 1, unit_price_ttc: 1000,
      tva_rate: 20, total_ht: 731, total_tva: 146, total_ttc: 877,
    }]);
    expect(r.totals).toEqual({ ht: 731, tva: 146, ttc: 877 });
  });
  it('retour complet : rend exactement le total payé', () => {
    const r = refund(S, [], [[0, 3], [1, 2], [2, 1]]);
    expect(r.totals.ttc).toBe(3900);
    expect(r.totals.ht + r.totals.tva).toBe(3900);
  });
  it('deux retours successifs : la somme est le total payé, un troisième est refusé', () => {
    const first = refund(S, [], [[0, 1], [1, 2]]);
    const second = refund(S, [first], [[0, 2], [2, 1]]);
    expect(first.totals.ttc + second.totals.ttc).toBe(3900);
    expect(returnableLines(S, [first, second]).every((r) => r.remaining === 0)).toBe(true);
    expect(() => refund(S, [first, second], [[2, 1]], [{ method: 'cash', amount: 1 }])).toThrow('déjà entièrement retourné');
  });
  it('le même article sur deux lignes : chaque ligne a son reste et son prix payé', () => {
    const s = sale([pain, { ...pain, quantity: 1, discount: 50 }], [{ method: 'cash', amount: 400 }]);
    const r = refund(s, [], [[1, 1]]);
    expect(r.lines).toMatchObject([{ line_index: 1, original_line_id: uuid(101), total_ttc: 100 }]);
    expect(returnableLines(s, [r]).map((x) => x.remaining)).toEqual([2, 0]);
  });
  it('TVA mixte : chaque ligne garde le taux de la vente', () => {
    const r = refund(S, [], [[1, 1], [2, 1]]);
    expect(r.lines.map((l) => [l.tva_rate, l.total_ht, l.total_tva, l.total_ttc])).toEqual([[0, 147, 0, 147], [20, 813, 162, 975]]);
  });
  it('remise de ligne : le retour rend le prix remisé, pas le prix affiché', () => {
    const s = sale([lait], [{ method: 'cash', amount: 2700 }]);
    expect(refund(s, [], [[0, 1]]).totals.ttc).toBe(900);
  });
  it('remise globale : chaque retour en prend sa part', () => {
    const s = sale([thon, { ...thon, product_id: 'p_8', name: 'SARDINE' }], [{ method: 'cash', amount: 1900 }], { globalDiscount: 100 });
    expect(refund(s, [], [[0, 1]]).totals.ttc).toBe(950);
  });
  it('arrondis : retours un par un, jamais 1 centime de plus que le payé', () => {
    const s = sale([{ ...thon, quantity: 3, unit_price_ttc: 333 }], [{ method: 'cash', amount: 998 }], { globalDiscount: 1 });
    const refunds: Refund[] = [];
    for (let i = 0; i < 3; i += 1) refunds.push(refund(s, refunds, [[0, 1]]));
    expect(refunds.map((r) => r.totals.ttc)).toEqual([333, 332, 333]);
    expect(refunds.reduce((n, r) => n + r.totals.ttc, 0)).toBe(998);
  });
  it('article au poids : 3 décimales', () => {
    const s = sale([{ ...pain, quantity: 1.5, unit_price_ttc: 2000 }], [{ method: 'cash', amount: 3000 }]);
    const r = refund(s, [], [[0, 0.25]]);
    expect(r.lines[0]).toMatchObject({ quantity: 0.25, total_ttc: 500 });
    expect(returnableLines(s, [r])[0].remaining).toBe(1.25);
  });
});

describe('remboursement proposé et contrôles des moyens (§10)', () => {
  it('même moyen que la vente ; espèces si elle a été payée de plusieurs façons', () => {
    const card = sale([thon], [{ method: 'card', amount: 1000 }]);
    expect(defaultRefundPayments(card, [], 1000)).toEqual([{ method: 'card', amount: 1000 }]);
    const mixed = sale([thon], [{ method: 'card', amount: 600 }, { method: 'mobile', amount: 400 }]);
    expect(defaultRefundPayments(mixed, [], 500)).toEqual([{ method: 'cash', amount: 500 }]);
    expect(defaultRefundPayments(card, [], 0)).toEqual([]);
  });
  it('vente à crédit : le retour réduit d’abord le crédit, puis le reste par le moyen de la vente', () => {
    const s = sale([thon], [{ method: 'card', amount: 500 }, { method: 'credit', amount: 500 }], { customer: ahmed });
    expect(defaultRefundPayments(s, [], 300)).toEqual([{ method: 'credit', amount: 300 }]);
    expect(defaultRefundPayments(s, [], 800)).toEqual([{ method: 'credit', amount: 500 }, { method: 'card', amount: 300 }]);
    const first = { ...refund(s, [], [[0, 0.5]]), payments: [{ method: 'credit' as const, amount: 500 }] };
    expect(creditRemaining(s, [first])).toBe(0);
    expect(defaultRefundPayments(s, [first], 500)).toEqual([{ method: 'card', amount: 500 }]);
  });
  it('le client de la vente est repris sur le retour', () => {
    const s = sale([thon], [{ method: 'credit', amount: 1000 }], { customer: ahmed });
    const r = refund(s, [], [[0, 1]]);
    expect(r.customer_id).toBe('c_1');
    expect(r.payments).toEqual([{ method: 'credit', amount: 1000 }]);
  });
  it('refuse un crédit sans crédit à réduire, trop d’espèces, ou une somme fausse', () => {
    const limits = { credit: 0, cash: 500 };
    expect(refundPaymentsError(1000, [{ method: 'credit', amount: 1000 }], limits)).toContain('pas de crédit');
    expect(refundPaymentsError(1000, [{ method: 'credit', amount: 600 }, { method: 'card', amount: 400 }], { credit: 500, cash: 0 }))
      .toContain('au plus');
    expect(refundPaymentsError(1000, [{ method: 'cash', amount: 1000 }], limits)).toContain('seulement dans le tiroir');
    expect(refundPaymentsError(1000, [{ method: 'card', amount: 900 }], limits)).toContain('Reste à rembourser');
    expect(refundPaymentsError(1000, [{ method: 'card', amount: 1100 }], limits)).toContain('Trop remboursé');
    expect(refundPaymentsError(1000, [{ method: 'card', amount: 0 }], limits)).toContain('montant');
    expect(refundPaymentsError(1000, [{ method: 'cash', amount: 500 }, { method: 'card', amount: 500 }], limits)).toBeNull();
  });
});

describe('document de retour (§10)', () => {
  it('numéro R-, session, vente d’origine, motif, date au format du contrat', () => {
    const r = refund(S, [], [[2, 1]], undefined, { reason: 'other', reasonText: '  Emballage   abîmé ', counter: 4 });
    expect(r).toMatchObject({
      number: 'R-ST2-REG3-000004', store_id: 'st_2', register_id: 'reg_3', session_id: SESSION, original_sale_id: S.id,
      cashier_id: 'u_2', customer_id: null, created_at: '2026-11-12T16:05:00Z', reason: 'other', reason_text: 'Emballage abîmé',
      payments: [{ method: 'cash', amount: 975 }],
    });
    expect(isRefund(r)).toBe(true);
  });
  it('vente d’avant le contrat 0.5 : ligne repérée par sa position, sans id', () => {
    const old = { ...S, lines: S.lines.map(({ id: _id, ...l }) => l) };
    expect(refund(old, [], [[1, 1]]).lines[0]).toMatchObject({ original_line_id: null, line_index: 1 });
  });
  it('refuse une vente annulée, d’un autre magasin, sans article, sans motif, ou trop d’espèces', () => {
    expect(saleRefundError({ ...S, status: 'cancelled' }, 'st_2')).toContain('annulée');
    expect(saleRefundError(S, 'st_1')).toContain('autre magasin');
    expect(() => refund({ ...S, status: 'cancelled' }, [], [[0, 1]])).toThrow('annulée');
    expect(() => refund(S, [], [], [{ method: 'cash', amount: 1 }])).toThrow('au moins un article');
    expect(() => refund(S, [], [[0, 1]], undefined, { reason: null })).toThrow('motif');
    expect(() => refund(S, [], [[0, 4]], [{ method: 'cash', amount: 3509 }])).toThrow('3 au plus');
    expect(() => refund(S, [], [[0, 1]], undefined, { cashAvailable: 100 })).toThrow('tiroir');
  });
  it('retour autorisé par un responsable (§10, §11) : approved_by envoyé ; absent avant le contrat 0.6', () => {
    expect(refund(S, [], [[0, 1]]).approved_by).toBeNull();
    const r = refund(S, [], [[0, 1]], undefined, { approvedBy: 'u_3' });
    expect(r.approved_by).toBe('u_3');
    expect(isRefund(r)).toBe(true);
    const { approved_by: _a, ...before06 } = r;
    expect(isRefund(before06)).toBe(true);
    expect(isRefund({ ...r, approved_by: '' })).toBe(false);
    expect(isRefund({ ...r, approved_by: 3 })).toBe(false);
  });
  it('relecture : un retour abîmé n’est pas reconnu', () => {
    const r = refund(S, [], [[0, 1]]);
    expect(isRefund({ ...r, number: 'ST2-REG3-000001' })).toBe(false);
    expect(isRefund({ ...r, reason: 'vol' })).toBe(false);
    expect(isRefund({ ...r, lines: [r.lines[0], r.lines[0]] })).toBe(false);
    expect(isRefund({ ...r, lines: [] })).toBe(false);
    expect(isRefund(null)).toBe(false);
  });
});

describe('saisies', () => {
  it('quantité : positive, 3 décimales au plus, virgule acceptée', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity(' 1,5 ')).toBe(1.5);
    expect(parseQuantity('0.250')).toBe(0.25);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1,2345')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
  it('quantités : au moins une, chacune dans le reste ; une ligne à 0 est ignorée', () => {
    const rows = returnableLines(S, []);
    expect(quantitiesError(rows, new Map())).toContain('au moins un article');
    expect(quantitiesError(rows, new Map([[0, 0]]))).toContain('au moins un article');
    expect(quantitiesError(rows, new Map([[0, null]]))).toContain('quantité invalide');
    expect(quantitiesError(rows, new Map([[1, 3]]))).toContain('2 au plus');
    expect(quantitiesError(rows, new Map([[0, 0], [1, 2]]))).toBeNull();
  });
  it('motif : obligatoire, précision pour « Autre »', () => {
    expect(reasonError(null, '')).toContain('motif');
    expect(reasonError('other', '  ')).toContain('précisez');
    expect(reasonError('other', 'x'.repeat(201))).toContain('200');
    expect(reasonError('defective', '')).toBeNull();
  });
});
