// Routes du back-office (/api/admin, contrat §12 proposé).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { barcodeRules } from '../src/routes/admin.js';
import { buildReport, localParts } from '../src/reports.js';
import { line, P1, P6, sale, sessionBody, startServer } from './helpers.js';

let srv;
let admin;
let manager;
let cashier;
before(async () => {
  srv = await startServer();
  admin = await srv.login('admin');
  manager = await srv.login('responsable');
  cashier = await srv.login('caissier');
});
after(() => srv.close());

describe('accès', () => {
  test('caissier refusé ; responsable admis ; admin seul sur utilisateurs et réglages', async () => {
    assert.equal((await cashier.get('/admin/me')).status, 403);
    const me = (await manager.get('/admin/me')).body;
    assert.equal(me.user.role, 'manager');
    assert.deepEqual(me.settings.tva_rates, [20, 14, 10, 7, 0]);
    assert.equal((await manager.get('/admin/users')).status, 403);
    assert.equal((await manager.put('/admin/settings', { tva_rates: [20] })).status, 403);
    assert.equal((await admin.get('/admin/users')).status, 200);
  });
});

describe('catalogue', () => {
  let created;
  test('création d’un article : code unique, TVA de la liste, prix en centimes', async () => {
    const body = { code: 'IT0500', barcode: '6119999999991', name: 'Jus d’orange 1L', category_id: 'cat_1', price_ttc: 1200, cost_price: 800,
      tva_rate: 20, unit: 'unit', stock_alert: 6 };
    const res = await manager.post('/admin/products', body);
    assert.equal(res.status, 201);
    created = res.body;
    assert.equal(created.cost_price, 800);
    assert.equal((await manager.post('/admin/products', body)).body.error.code, 'CODE_TAKEN');
    assert.equal((await manager.post('/admin/products', { ...body, code: 'X1', barcode: null, tva_rate: 19 })).body.error.code, 'INVALID_TVA');
    assert.equal((await manager.post('/admin/products', { ...body, code: 'X1', barcode: null, price_ttc: 12.5 })).body.error.code, 'INVALID_PRICE');
  });

  test('un article modifié repart vers les caisses (updated_since)', async () => {
    srv.db.prepare(`UPDATE products SET updated_at = '2026-01-01T00:00:00.000Z'`).run();
    const since = '2026-06-01T00:00:00Z';
    const res = await manager.put(`/admin/products/${created.id}`, { price_ttc: 1300 });
    assert.equal(res.body.price_ttc, 1300);
    const changed = (await cashier.get(`/products?store_id=st_2&updated_since=${since}`)).body;
    assert.deepEqual(changed.map((p) => p.id), [created.id]);
    assert.equal(changed[0].stock, 0);
  });

  test('catégorie utilisée : suppression refusée', async () => {
    assert.equal((await manager.del('/admin/categories/cat_1')).status, 409);
    const cat = (await manager.post('/admin/categories', { name: 'Boissons', name_ar: 'مشروبات' })).body;
    assert.equal((await manager.del(`/admin/categories/${cat.id}`)).status, 204);
  });

  test('stock : réception, ajustement avec motif, inventaire', async () => {
    const receipt = await manager.post('/admin/stock-moves', { store_id: 'st_2', kind: 'receipt', note: 'Livraison',
      lines: [{ product_id: created.id, quantity: 24, unit_cost: 750 }] });
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.lines[0].stock, 24);
    assert.equal((await manager.post('/admin/stock-moves', { store_id: 'st_2', kind: 'adjustment', lines: [{ product_id: created.id, quantity: -2 }] }))
      .body.error.code, 'NOTE_REQUIRED');
    await manager.post('/admin/stock-moves', { store_id: 'st_2', kind: 'adjustment', note: 'Casse', lines: [{ product_id: created.id, quantity: -2 }] });
    const inv = await manager.post('/admin/stock-moves', { store_id: 'st_2', kind: 'inventory', lines: [{ product_id: created.id, quantity: 20 }] });
    assert.deepEqual(inv.body.lines[0], { product_id: created.id, delta: -2, stock: 20 });
    assert.equal((await manager.post('/admin/stock-moves', { store_id: 'st_2', kind: 'receipt', lines: [{ product_id: created.id, quantity: 1.5 }] }))
      .body.error.code, 'INVALID_QUANTITY');
    const detail = (await manager.get(`/admin/products/${created.id}`)).body;
    assert.equal(detail.product.cost_price, 750);
    assert.equal(detail.product.stock_by_store.st_2, 20);
    assert.deepEqual(detail.moves.map((m) => m.kind), ['inventory', 'adjustment', 'receipt']);
  });
});

describe('ventes, tableau de bord, clients', () => {
  let session;
  let credit;
  before(async () => {
    session = sessionBody('st_2', 'reg_3', 'u_2');
    await cashier.post('/cash-sessions', session);
    await cashier.post('/sales', sale({ session, cashier_id: 'u_2', lines: [line(P1, 2), line(P6, 1)] }));
    credit = sale({ session, cashier_id: 'u_2', lines: [line(P1, 10)], customer_id: 'c_1', payments: [{ method: 'card', amount: 500 }] });
    await cashier.post('/sales', credit);
  });

  test('liste des ventes : payé et dû, filtres', async () => {
    const list = (await manager.get('/admin/sales?store_id=st_2')).body;
    assert.equal(list.total, 2);
    assert.deepEqual(list.sums, { ttc: 1900, paid: 900, due: 1000 });
    const due = (await manager.get('/admin/sales?store_id=st_2&due=1')).body;
    assert.deepEqual(due.rows.map((r) => r.id), [credit.id]);
    assert.equal(due.rows[0].cashier_name, 'Caissier 1');
    assert.equal(due.rows[0].customer_name, 'Ahmed');
    const detail = (await manager.get(`/admin/sales/${credit.id}`)).body;
    assert.equal(detail.sale.number, credit.number);
    assert.equal(detail.store.name, 'Magasin quartier');
  });

  test('tableau de bord : chiffre, moyens de paiement, alertes de stock, session ouverte', async () => {
    const d = (await manager.get('/admin/dashboard?store_id=st_2')).body;
    assert.equal(d.report.summary.sales_count, 2);
    assert.equal(d.report.summary.sales_ttc, 1900);
    assert.equal(d.report.summary.credit_given, 1000);
    const byMethod = Object.fromEntries(d.report.by_method.map((m) => [m.method, m.sales]));
    assert.deepEqual(byMethod, { cash: 400, card: 500, credit: 1000 });
    assert.equal(d.open_sessions.length, 1);
    assert.equal(d.open_sessions[0].expected.cash, session.opening_cash + 400);
    assert.ok(d.stock_alerts.count >= 0);
    assert.equal(d.customers_due.total, 1000);
  });

  test('règlement d’une dette : jamais plus que le reste dû, idempotent', async () => {
    assert.equal((await manager.get('/admin/customers?due=1')).body[0].balance, 1000);
    const over = await manager.post('/admin/customers/c_1/payments', { store_id: 'st_2', method: 'cash', amount: 1500 });
    assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_BALANCE');
    const id = randomUUID();
    const pay = await manager.post('/admin/customers/c_1/payments', { id, store_id: 'st_2', method: 'cash', amount: 600 });
    assert.equal(pay.status, 201);
    assert.equal(pay.body.balance, 400);
    assert.equal((await manager.post('/admin/customers/c_1/payments', { id, store_id: 'st_2', method: 'cash', amount: 600 })).body.status, 'duplicate');
    const detail = (await manager.get('/admin/customers/c_1')).body;
    assert.equal(detail.balance, 400);
    assert.equal(detail.payments.length, 1);
  });

  test('matricule déjà pris : 409', async () => {
    const res = await manager.post('/admin/customers', { name: 'Doublon', matricule: '2023001542' });
    assert.equal(res.status, 409);
  });

  test('session clôturée depuis le back-office : motif obligatoire, marquée forcée', async () => {
    assert.equal((await manager.post(`/admin/cash-sessions/${session.id}/force-close`, {})).body.error.code, 'NOTE_REQUIRED');
    const res = await manager.post(`/admin/cash-sessions/${session.id}/force-close`, { note: 'Poste en panne' });
    assert.equal(res.body.status, 'closed');
    assert.equal(res.body.forced, true);
    assert.equal((await cashier.get('/cash-sessions/current?register_id=reg_3')).body.session, null);
  });
});

describe('utilisateurs, magasins, réglages', () => {
  test('création d’un caissier : mot de passe de 8 caractères, au moins un magasin', async () => {
    const base = { username: 'samira', name: 'Samira', role: 'cashier', password: 'motdepasse1', store_ids: ['st_1'] };
    assert.equal((await admin.post('/admin/users', { ...base, password: 'court' })).body.error.code, 'WEAK_PASSWORD');
    assert.equal((await admin.post('/admin/users', { ...base, store_ids: [] })).body.error.code, 'STORE_REQUIRED');
    const res = await admin.post('/admin/users', base);
    assert.equal(res.status, 201);
    assert.equal((await admin.post('/admin/users', base)).body.error.code, 'USERNAME_TAKEN');
    const login = await srv.call('POST', '/auth/login', { body: { username: 'samira', password: 'motdepasse1' } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.stores.map((s) => s.id), ['st_1']);
  });

  test('PIN d’un responsable : 6 chiffres, apparaît dans les approbateurs', async () => {
    const m = (await admin.post('/admin/users', { username: 'karim', name: 'Karim', role: 'manager', password: 'motdepasse2', store_ids: ['st_2'], pin: '1234' })).body;
    assert.equal(m.error.code, 'INVALID_PIN');
    const ok = (await admin.post('/admin/users', { username: 'karim', name: 'Karim', role: 'manager', password: 'motdepasse2', store_ids: ['st_2'], pin: '482913' })).body;
    assert.equal(ok.has_pin, true);
    const { approvers } = (await cashier.get('/stores/st_2/approvers')).body;
    assert.ok(approvers.some((a) => a.user_id === ok.id));
    await admin.put(`/admin/users/${ok.id}`, { pin: null });
    assert.ok(!(await cashier.get('/stores/st_2/approvers')).body.approvers.some((a) => a.user_id === ok.id));
  });

  test('désactiver un compte coupe ses connexions ; l’admin ne se retire pas ses droits', async () => {
    const u = (await admin.get('/admin/users')).body.find((x) => x.username === 'samira');
    const samira = await srv.call('POST', '/auth/login', { body: { username: 'samira', password: 'motdepasse1' } });
    await admin.put(`/admin/users/${u.id}`, { active: false });
    assert.equal((await srv.call('GET', '/categories', { token: samira.body.token })).status, 401);
    assert.equal((await admin.put('/admin/users/u_1', { role: 'manager' })).body.error.code, 'SELF_LOCKOUT');
  });

  test('magasin : ICE de 15 chiffres, caisse ajoutée, règles de balance contrôlées', async () => {
    assert.equal((await admin.post('/admin/stores', { name: 'Annexe', ice: '123' })).body.error.code, 'INVALID_ICE');
    const st = (await admin.post('/admin/stores', { name: 'Annexe', ice: '001234567000089', address: 'Rabat' })).body;
    assert.equal(st.registers.length, 1);
    const reg = (await admin.post(`/admin/stores/${st.id}/registers`, { name: 'Caisse 2' })).body;
    assert.equal(reg.store_id, st.id);
    const rules = await admin.put(`/admin/stores/${st.id}/barcode-rules`, { rules: [{ prefix: '22', type: 'weight', integer_digits: 2, decimal_digits: 3 }] });
    assert.equal(rules.status, 200);
    assert.equal((await admin.get('/admin/stores')).body.find((s) => s.id === st.id).barcode_rules.length, 1);
  });

  test('taux de TVA encore utilisé : retrait refusé', async () => {
    const res = await admin.put('/admin/settings', { tva_rates: [20, 14, 10] });
    assert.equal(res.body.error.code, 'RATE_IN_USE');
    assert.deepEqual(res.body.error.details.rates.sort(), [0, 7]);
    assert.deepEqual((await admin.put('/admin/settings', { tva_rates: [0, 7, 10, 14, 20, 5] })).body.tva_rates, [20, 14, 10, 7, 5, 0]);
  });
});

describe('fonctions pures', () => {
  test('règles de balance : préfixe début d’un autre, code article trop court', () => {
    assert.throws(() => barcodeRules([{ prefix: '2', type: 'weight', integer_digits: 2, decimal_digits: 3 },
      { prefix: '21', type: 'price', integer_digits: 3, decimal_digits: 2 }]));
    assert.throws(() => barcodeRules([{ prefix: '213', type: 'weight', integer_digits: 6, decimal_digits: 3 }]));
    assert.throws(() => barcodeRules([{ prefix: '21', type: 'price', integer_digits: 3, decimal_digits: 3 }]));
    assert.equal(barcodeRules([]).length, 0);
  });

  test('jour local : une vente à 23h30 UTC compte le lendemain à Casablanca (UTC+1)', () => {
    assert.deepEqual(localParts('2026-11-12T23:30:00Z', 'Africa/Casablanca'), { day: '2026-11-13', hour: 0 });
  });

  test('rapport : retours déduits par taux et par article, annulées à part', () => {
    const lines = [
      { product_id: 'a', name: 'A', quantity: 2, unit_price_ttc: 600, discount: 0, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 },
      { product_id: 'b', name: 'B', quantity: 1, unit_price_ttc: 500, discount: 0, tva_rate: 0, total_ht: 500, total_tva: 0, total_ttc: 500 },
    ];
    const s = { id: 's1', store_id: 'st', cashier_id: 'u', created_at: '2026-11-12T10:00:00Z', lines, other_charges: 0, global_discount: 0,
      totals: { ht: 1500, tva: 200, ttc: 1700 }, payments: [{ method: 'cash', amount: 1700 }], status: 'completed' };
    const cancelled = { ...s, id: 's2', status: 'cancelled' };
    const refund = { store_id: 'st', created_at: '2026-11-12T11:00:00Z', totals: { ht: 500, tva: 100, ttc: 600 }, payments: [{ method: 'cash', amount: 600 }],
      lines: [{ line_index: 0, quantity: 1, total_ht: 500, total_tva: 100, total_ttc: 600 }] };
    const lookup = { products: new Map([['a', { code: 'A', name: 'A', category_id: null, cost_price: 400 }], ['b', { code: 'B', name: 'B', category_id: null, cost_price: 300 }]]),
      categories: new Map(), users: new Map([['u', 'Ali']]), stores: new Map([['st', 'Centre']]) };
    const r = buildReport({ sales: [s, cancelled], refunds: [{ refund, sale: s }] }, lookup, 'UTC');
    assert.equal(r.summary.sales_ttc, 1700);
    assert.equal(r.summary.net_ttc, 1100);
    assert.equal(r.summary.cancelled_count, 1);
    assert.deepEqual(r.vat, [{ rate: 20, ht: 500, tva: 100, ttc: 600 }, { rate: 0, ht: 500, tva: 0, ttc: 500 }]);
    const a = r.by_product.find((p) => p.product_id === 'a');
    assert.equal(a.quantity, 1);
    assert.equal(a.ttc, 600);
    assert.equal(r.summary.margin, 1100 - (400 + 300));
    assert.deepEqual(r.by_method, [{ method: 'cash', sales: 1700, refunds: 600, net: 1100 }]);
  });
});
