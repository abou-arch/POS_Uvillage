// Fournisseurs, factures d'achat, dépenses et chiffres du tableau de bord (/api/admin, contrat §12 proposé).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { localMidnight } from '../src/reports.js';
import { addDays, dayRange, overview, todayIn } from '../src/routes/purchases.js';
import { line, P1, sale, sessionBody, startServer } from './helpers.js';

let srv;
let admin;
let manager;
const TZ = 'Africa/Casablanca';
const today = () => todayIn(TZ);
before(async () => {
  srv = await startServer();
  admin = await srv.login('admin');
  manager = await srv.login('responsable');
});
after(() => srv.close());

describe('jours locaux', () => {
  test('minuit local en UTC, y compris quand le fuseau change d’heure', () => {
    assert.equal(localMidnight('2026-01-15', 'UTC'), '2026-01-15T00:00:00Z');
    assert.equal(localMidnight('2026-07-01', 'Europe/Paris'), '2026-06-30T22:00:00Z');
    assert.equal(localMidnight('2026-03-29', 'Europe/Paris'), '2026-03-28T23:00:00Z'); // jour du passage à l'heure d'été
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.deepEqual(dayRange({ from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z' }, 'UTC'), { first: '2026-11-01', last: '2026-11-07' });
  });
});

describe('fournisseurs', () => {
  let sup;
  test('création : nom obligatoire et unique, téléphone, e-mail et ICE contrôlés', async () => {
    const res = await manager.post('/admin/suppliers', { name: 'Centrale Laitière', phone: '05 22 00 00 00', ice: '001234567000089' });
    assert.equal(res.status, 201);
    sup = res.body;
    assert.equal(sup.purchases_count, 0);
    assert.equal(sup.due, 0);
    assert.equal((await manager.post('/admin/suppliers', { name: 'centrale laitière' })).body.error.code, 'DUPLICATE');
    for (const bad of [{ name: '' }, { name: 'X', phone: '12' }, { name: 'X', email: 'pas-un-mail' }, { name: 'X', ice: '123' }]) {
      assert.equal((await manager.post('/admin/suppliers', bad)).status, 400, JSON.stringify(bad));
    }
    const put = await manager.put(`/admin/suppliers/${sup.id}`, { ...sup, address: 'Casablanca', active: true });
    assert.equal(put.body.address, 'Casablanca');
  });

  test('facture d’achat : stock reçu, prix d’achat mis à jour, numéro, premier règlement, reste dû', async () => {
    const stockBefore = (await admin.get('/admin/products/p_1')).body.product.stock_by_store.st_1;
    const id = randomUUID();
    const body = {
      id, supplier_id: sup.id, store_id: 'st_1', invoice_ref: 'FA-2026-118', invoice_date: today(),
      lines: [{ product_id: 'p_1', quantity: 40, unit_cost: 90 }, { product_id: 'p_20', quantity: 2.5, unit_cost: 1800 }],
      payment: { amount: 3000, method: 'cash' },
    };
    const res = await manager.post('/admin/purchases', body);
    assert.equal(res.status, 201);
    const p = res.body.purchase;
    assert.match(p.number, /^ACH-\d{6}$/);
    assert.equal(p.total, 40 * 90 + 2.5 * 1800);
    assert.equal(p.paid, 3000);
    assert.equal(p.due, p.total - 3000);
    assert.deepEqual(res.body.lines.map((l) => l.quantity), [40, 2.5]);
    const product = (await admin.get('/admin/products/p_1')).body.product;
    assert.equal(product.stock_by_store.st_1, stockBefore + 40);
    assert.equal(product.cost_price, 90);
    // Rejouée (double clic) : rien de plus en stock.
    const again = await manager.post('/admin/purchases', body);
    assert.equal(again.body.status, 'duplicate');
    assert.equal((await admin.get('/admin/products/p_1')).body.product.stock_by_store.st_1, stockBefore + 40);
    const moves = (await admin.get('/admin/stock-moves?kind=receipt&store_id=st_1')).body;
    assert.ok(moves.some((m) => m.ref_id === id && m.note === `Facture d’achat ${p.number}`));

    const due = p.due;
    const over = await manager.post(`/admin/purchases/${id}/payments`, { amount: due + 1, method: 'transfer' });
    assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_DUE');
    const payId = randomUUID();
    const paid = await manager.post(`/admin/purchases/${id}/payments`, { id: payId, amount: due, method: 'cheque', note: 'Chèque 001' });
    assert.equal(paid.status, 201);
    assert.equal(paid.body.purchase.due, 0);
    assert.equal((await manager.post(`/admin/purchases/${id}/payments`, { id: payId, amount: due, method: 'cheque' })).body.status, 'duplicate');

    const s = (await manager.get(`/admin/suppliers/${sup.id}`)).body;
    assert.equal(s.supplier.purchases_count, 1);
    assert.equal(s.supplier.due, 0);
    assert.equal(s.purchases[0].id, id);
    const list = (await manager.get('/admin/purchases?store_id=st_1')).body;
    assert.equal(list.count, 1);
    assert.equal(list.total, p.total);
  });

  test('facture refusée : fournisseur ou article inconnu, quantité, prix, date future, règlement trop élevé, magasin', async () => {
    const base = { supplier_id: sup.id, store_id: 'st_1', invoice_date: today(), lines: [{ product_id: 'p_1', quantity: 1, unit_cost: 100 }] };
    const cases = [
      [{ supplier_id: 'sup_x' }, 'SUPPLIER_UNKNOWN'],
      [{ lines: [{ product_id: 'p_x', quantity: 1, unit_cost: 1 }] }, 'PRODUCT_UNKNOWN'],
      [{ lines: [{ product_id: 'p_1', quantity: 1.5, unit_cost: 1 }] }, 'INVALID_QUANTITY'],
      [{ lines: [{ product_id: 'p_1', quantity: 1, unit_cost: 1.5 }] }, 'INVALID_DATA'],
      [{ lines: [] }, 'INVALID_DATA'],
      [{ invoice_date: addDays(today(), 5) }, 'INVALID_DATA'],
      [{ payment: { amount: 101, method: 'cash' } }, 'PAYMENT_EXCEEDS_DUE'],
      [{ payment: { amount: 50, method: 'credit' } }, 'INVALID_DATA'],
    ];
    for (const [patch, code] of cases) {
      const res = await manager.post('/admin/purchases', { ...base, ...patch });
      assert.equal(res.body?.error?.code, code, JSON.stringify(patch));
    }
    assert.equal((await manager.post('/admin/purchases', { ...base, store_id: 'st_9' })).status, 403);
  });
});

describe('dépenses', () => {
  test('saisie, liste par catégorie, « Autre » sans précision refusé, suppression', async () => {
    const rent = await manager.post('/admin/expenses', { store_id: 'st_1', category: 'rent', amount: 450000, method: 'transfer', spent_on: today() });
    assert.equal(rent.status, 201);
    await manager.post('/admin/expenses', { store_id: 'st_1', category: 'electricity', amount: 82000, method: 'cash', spent_on: today() });
    assert.equal((await manager.post('/admin/expenses', { store_id: 'st_1', category: 'other', amount: 100, method: 'cash', spent_on: today() })).body.error.code, 'NOTE_REQUIRED');
    for (const bad of [{ category: 'x' }, { amount: 0 }, { amount: 10.5 }, { method: 'credit' }, { spent_on: addDays(today(), 3) }]) {
      const res = await manager.post('/admin/expenses', { store_id: 'st_1', category: 'water', amount: 100, method: 'cash', spent_on: today(), ...bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    const list = (await manager.get('/admin/expenses?store_id=st_1')).body;
    assert.equal(list.total, 532000);
    assert.deepEqual(list.by_category.map((c) => c.category), ['rent', 'electricity']);
    const extra = await manager.post('/admin/expenses', { store_id: 'st_1', category: 'water', amount: 100, method: 'cash', spent_on: today() });
    assert.equal((await manager.del(`/admin/expenses/${extra.body.expense.id}`)).status, 204);
    assert.equal((await manager.get('/admin/expenses?store_id=st_1')).body.total, 532000);
  });
});

describe('tableau de bord : achats, ventes, dépenses', () => {
  test('totaux, journée, effectifs, mois par mois, articles récents', async () => {
    const session = sessionBody('st_1', 'reg_2');
    assert.equal((await admin.post('/cash-sessions', session)).status, 201);
    const s1 = sale({ session, lines: [line(P1, 4)] });
    const s2 = sale({ session, lines: [line(P1, 2)], customer_id: 'c_2', payments: [{ method: 'cash', amount: 100 }, { method: 'credit', amount: 200 }] });
    assert.equal((await admin.post('/sales', s1)).status, 201);
    assert.equal((await admin.post('/sales', s2)).status, 201);

    const d = (await manager.get('/admin/dashboard?store_id=st_1')).body.overview;
    assert.equal(d.today, today());
    assert.equal(d.totals.sales, 900);
    assert.equal(d.totals.sales_due, 200);
    assert.equal(d.totals.purchases_due, 0);
    assert.equal(d.totals.expenses, 532000);
    assert.equal(d.today_totals.sales, 900);
    assert.equal(d.today_totals.received, 700);
    assert.equal(d.today_totals.purchases, 40 * 90 + 2.5 * 1800);
    assert.equal(d.today_totals.expenses, 532000);
    assert.equal(d.counts.suppliers, 1);
    assert.equal(d.counts.purchases, 1);
    assert.equal(d.counts.sales, 2);
    assert.equal(d.monthly.months.length, 12);
    const month = d.monthly.months.find((m) => m.month === today().slice(0, 7));
    assert.deepEqual([month.sales, month.purchases, month.expenses], [900, 40 * 90 + 2.5 * 1800, 532000]);
    assert.equal(d.period.expenses_by_category[0].category, 'rent');
    assert.equal(d.recent_products.length, 8);

    // Autre magasin : rien de tout cela ; autre année : mois vides.
    const other = (await manager.get('/admin/dashboard?store_id=st_2')).body.overview;
    assert.deepEqual([other.totals.sales, other.totals.expenses, other.counts.purchases], [0, 0, 0]);
    const past = (await manager.get('/admin/dashboard?store_id=st_1&year=2020')).body.overview;
    assert.equal(past.monthly.year, 2020);
    assert.ok(past.monthly.months.every((m) => m.sales === 0 && m.purchases === 0));
  });

  test('la journée suit le fuseau des magasins', () => {
    const night = new Date('2026-06-30T23:30:00Z'); // déjà le 1er juillet à Casablanca (UTC+1)
    assert.equal(todayIn(TZ, night), '2026-07-01');
    const o = overview(srv.db, { storeIds: ['st_2'], from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z', timeZone: TZ, now: night });
    assert.equal(o.today, '2026-07-01');
    assert.equal(o.monthly.year, 2026);
  });
});
