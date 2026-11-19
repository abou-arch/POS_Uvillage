// Routes de la caisse (contrat 0.7) sur la vraie base.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { paidByLine, refundLine } from '../../pos-caisse/src/lib/totals.js';
import { expectedByMethod } from '../src/routes/pos.js';
import { line, OLIVES, P1, P6, sale, sessionBody, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

const stockOf = async (as, storeId, productId) => (await as.get(`/products?store_id=${storeId}`)).body.find((p) => p.id === productId).stock;

export function refundBody(session, original, lineIndex, quantity, { returnedBefore = 0, method = 'cash', id = randomUUID() } = {}) {
  const l = original.lines[lineIndex];
  const paid = paidByLine(original.lines, original.other_charges, original.global_discount);
  const t = refundLine(paid[lineIndex], l.tva_rate, l.quantity, returnedBefore, quantity);
  return {
    id, number: `R-${id.slice(0, 6)}`, store_id: original.store_id, register_id: session.register_id, session_id: session.id,
    original_sale_id: original.id, cashier_id: 'u_1', approved_by: null, customer_id: original.customer_id, created_at: new Date().toISOString(),
    reason: 'changed_mind', reason_text: null,
    lines: [{ original_line_id: l.id, line_index: lineIndex, product_id: l.product_id, name: l.name, unit: l.unit, quantity,
      unit_price_ttc: l.unit_price_ttc, tva_rate: l.tva_rate, total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc }],
    totals: { ht: t.ht, tva: t.tva, ttc: t.ttc },
    payments: [{ method, amount: t.ttc }],
  };
}

describe('connexion', () => {
  test('renvoie le token, l’utilisateur et ses magasins avec leurs caisses', async () => {
    const res = await srv.call('POST', '/auth/login', { body: { username: 'caissier', password: 'caissier' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'cashier');
    assert.deepEqual(res.body.stores.map((s) => s.id), ['st_2']);
    assert.deepEqual(res.body.stores[0].registers, [{ id: 'reg_3', name: 'Caisse 1' }]);
    assert.equal(res.body.stores[0].closing_difference_threshold, 2000);
  });

  test('mauvais mot de passe et compte inconnu : même erreur', async () => {
    const a = await srv.call('POST', '/auth/login', { body: { username: 'admin', password: 'faux' } });
    const b = await srv.call('POST', '/auth/login', { body: { username: 'personne', password: 'faux' } });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, b.body);
    srv.db.prepare('DELETE FROM login_failures').run();
  });

  test('5 échecs de suite bloquent le compte, même avec le bon mot de passe', async () => {
    for (let i = 0; i < 5; i += 1) await srv.call('POST', '/auth/login', { body: { username: 'responsable', password: 'x' } });
    const res = await srv.call('POST', '/auth/login', { body: { username: 'responsable', password: 'responsable' } });
    assert.equal(res.status, 401);
    srv.db.prepare('DELETE FROM login_failures').run();
  });

  test('sans token : 401 ; après déconnexion, le token ne marche plus', async () => {
    assert.equal((await srv.call('GET', '/categories')).status, 401);
    const as = await srv.login('admin');
    assert.equal((await as.get('/categories')).status, 200);
    assert.equal((await as.post('/auth/logout')).status, 204);
    assert.equal((await as.get('/categories')).status, 401);
  });

  test('token expiré : 401', async () => {
    const as = await srv.login('admin');
    srv.db.prepare(`UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00Z'`).run();
    assert.equal((await as.get('/categories')).status, 401);
  });
});

describe('catalogue', () => {
  test('articles avec le stock du magasin ; magasin non autorisé : 403', async () => {
    const as = await srv.login('caissier');
    const list = (await as.get('/products?store_id=st_2')).body;
    assert.equal(list.length, 22);
    assert.equal(list.find((p) => p.id === 'p_1').stock, 60);
    assert.equal(list.find((p) => p.id === 'p_20').unit, 'kg');
    assert.equal((await as.get('/products?store_id=st_1')).status, 403);
    assert.equal((await as.get('/products')).status, 400);
  });

  test('updated_since ne renvoie que les articles modifiés', async () => {
    const as = await srv.login('admin');
    assert.equal((await as.get('/products?store_id=st_1&updated_since=2999-01-01T00:00:00Z')).body.length, 0);
  });

  test('responsables avec empreinte du PIN, règles de la balance', async () => {
    const as = await srv.login('admin');
    const { approvers } = (await as.get('/stores/st_1/approvers')).body;
    assert.deepEqual(approvers.map((a) => a.user_id).sort(), ['u_1', 'u_3']);
    assert.equal(approvers[0].pin.algorithm, 'PBKDF2-SHA256');
    const { rules } = (await as.get('/stores/st_1/barcode-rules')).body;
    assert.deepEqual(rules.map((r) => r.prefix), ['21', '23']);
  });
});

describe('clients', () => {
  test('recherche de 2 caractères au moins, par nom ou téléphone local', async () => {
    const as = await srv.login('caissier');
    assert.deepEqual((await as.get('/customers?search=a')).body, []);
    assert.equal((await as.get('/customers?search=ahm')).body[0].id, 'c_1');
    assert.equal((await as.get('/customers?search=0600000002')).body[0].id, 'c_2');
  });

  test('création idempotente par id ; données aberrantes refusées', async () => {
    const as = await srv.login('caissier');
    const id = randomUUID();
    const first = await as.post('/customers', { id, name: 'Nadia', phone: '06 11 22 33 44', matricule: null });
    assert.equal(first.status, 201);
    assert.equal(first.body.phone, '0611223344');
    assert.equal((await as.post('/customers', { id, name: 'Autre' })).status, 200);
    assert.equal((await as.post('/customers', { name: '  ' })).status, 400);
    assert.equal((await as.post('/customers', { name: 'X', matricule: 'AB12' })).status, 400);
  });
});

describe('ventes, retours et sessions', () => {
  let as;
  let session;
  before(async () => {
    as = await srv.login('admin');
    session = sessionBody();
    assert.equal((await as.post('/cash-sessions', session)).status, 201);
  });

  test('une session par caisse ; caisse d’un autre magasin refusée', async () => {
    const again = await as.post('/cash-sessions', sessionBody());
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'SESSION_ALREADY_OPEN');
    assert.equal((await as.post('/cash-sessions', sessionBody('st_1', 'reg_3'))).body.error.code, 'REGISTER_MISMATCH');
    assert.equal((await as.post('/cash-sessions', session)).body.status, 'duplicate');
    assert.equal((await as.get('/cash-sessions/current?register_id=reg_1')).body.session.id, session.id);
  });

  test('vente : créée, puis doublon ; le stock baisse', async () => {
    const before = await stockOf(as, 'st_1', 'p_1');
    const s = sale({ session, lines: [line(P1, 2), line(OLIVES, 0.25, { unit: 'kg' })] });
    const res = await as.post('/sales', s);
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { id: s.id, status: 'created', stock_warning: false, session_closed: false });
    assert.equal((await as.post('/sales', s)).body.status, 'duplicate');
    assert.equal(await stockOf(as, 'st_1', 'p_1'), before - 2);
    assert.equal(await stockOf(as, 'st_1', 'p_20'), 39.75);
  });

  test('vente refusée : totaux faux, session inconnue, crédit sans client, quantité non entière', async () => {
    const bad = sale({ session, lines: [line(P1, 1)] });
    bad.totals.ttc += 5;
    assert.equal((await as.post('/sales', bad)).body.error.code, 'TOTALS_MISMATCH');
    const unknown = sale({ session: { ...session, id: randomUUID() }, lines: [line(P1, 1)] });
    assert.equal((await as.post('/sales', unknown)).body.error.code, 'SESSION_UNKNOWN');
    const credit = sale({ session, lines: [line(P1, 1)], payments: [{ method: 'credit', amount: 150 }] });
    assert.equal((await as.post('/sales', credit)).body.error.code, 'PAYMENTS_MISMATCH');
    const half = sale({ session, lines: [line(P1, 1.5)] });
    assert.equal((await as.post('/sales', half)).status, 400);
  });

  test('stock négatif accepté et signalé ; prix différent du catalogue noté', async () => {
    const s = sale({ session, lines: [line({ ...P6, price_ttc: 90 }, 500)] });
    const res = await as.post('/sales', s);
    assert.equal(res.body.stock_warning, true);
    assert.equal(srv.db.prepare('SELECT price_warning FROM sales WHERE id = ?').get(s.id).price_warning, 1);
  });

  test('lot de ventes : un résultat par vente', async () => {
    const ok = sale({ session, lines: [line(P1, 1)] });
    const bad = sale({ session: { ...session, id: randomUUID() }, lines: [line(P1, 1)] });
    const { results } = (await as.post('/sales/batch', { sales: [ok, bad, ok] })).body;
    assert.deepEqual(results.map((r) => r.status), ['created', 'error', 'duplicate']);
    assert.equal(results[1].error.code, 'SESSION_UNKNOWN');
  });

  test('retour partiel, puis retour en trop refusé, puis annulation impossible', async () => {
    const s = sale({ session, lines: [line(P6, 3)], global_discount: 30 });
    await as.post('/sales', s);
    const found = (await as.get(`/sales/by-number/${s.number}`)).body;
    assert.equal(found.sale.id, s.id);
    assert.deepEqual(found.refunds, []);
    const r1 = refundBody(session, s, 0, 2);
    const res = await as.post('/refunds', r1);
    assert.equal(res.status, 201);
    assert.equal((await as.post('/refunds', r1)).body.status, 'duplicate');
    const tooMuch = refundBody(session, s, 0, 2, { returnedBefore: 2 });
    const refused = await as.post('/refunds', tooMuch);
    assert.equal(refused.body.error.code, 'RETURN_EXCEEDS');
    assert.equal(refused.body.error.details.remaining, 1);
    assert.equal((await as.get(`/sales/by-number/${s.number}`)).body.refunds.length, 1);
    assert.equal((await as.post(`/sales/${s.id}/cancel`)).body.error.code, 'SALE_REFUNDED');
  });

  test('retour avec un montant faux refusé', async () => {
    const s = sale({ session, lines: [line(P6, 2)] });
    await as.post('/sales', s);
    const r = refundBody(session, s, 0, 1);
    r.lines[0].total_ttc += 10;
    r.totals.ttc += 10;
    r.payments[0].amount += 10;
    assert.equal((await as.post('/refunds', r)).body.error.code, 'TOTALS_MISMATCH');
  });

  test('annulation : responsable seulement ; le stock revient', async () => {
    const s = sale({ session, lines: [line(P1, 4)] });
    await as.post('/sales', s);
    const stock = await stockOf(as, 'st_1', 'p_1');
    const cashier = await srv.login('caissier');
    assert.equal((await cashier.post(`/sales/${s.id}/cancel`)).status, 403);
    assert.deepEqual((await as.post(`/sales/${s.id}/cancel`)).body, { id: s.id, status: 'cancelled' });
    assert.equal(await stockOf(as, 'st_1', 'p_1'), stock + 4);
    assert.equal((await as.get(`/sales/by-number/${s.number}`)).body.sale.status, 'cancelled');
  });

  test('vente à crédit d’un client', async () => {
    const s = sale({ session, lines: [line(P1, 10)], customer_id: 'c_2', payments: [{ method: 'cash', amount: 500 }] });
    assert.equal((await as.post('/sales', s)).status, 201);
    assert.equal(srv.db.prepare('SELECT credit FROM sales WHERE id = ?').get(s.id).credit, 1000);
  });

  test('mouvement d’espèces puis clôture : écart sans note refusé, attendus vérifiés', async () => {
    const move = { id: randomUUID(), session_id: session.id, type: 'out', amount: 1000, reason: 'Sacs', created_by: 'u_1', approved_by: null, created_at: new Date().toISOString() };
    assert.equal((await as.post('/cash-movements', move)).status, 201);
    assert.equal((await as.post('/cash-movements', move)).body.status, 'duplicate');

    const exp = expectedByMethod(srv.db, srv.db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id));
    const counts = ['cash', 'card', 'mobile'].map((m) => ({ method: m, expected: exp[m], counted: exp[m], difference: 0 }));
    const close = { closed_by: 'u_1', approved_by: null, closed_at: new Date().toISOString(), counts, cash_count: null, closing_note: null };

    const off = structuredClone(close);
    off.counts[0].counted -= 100;
    off.counts[0].difference = -100;
    assert.equal((await as.post(`/cash-sessions/${session.id}/close`, off)).body.error.code, 'CLOSING_NOTE_REQUIRED');
    const wrong = structuredClone(close);
    wrong.counts[0].difference = 5;
    assert.equal((await as.post(`/cash-sessions/${session.id}/close`, wrong)).body.error.code, 'DIFFERENCE_MISMATCH');

    const res = await as.post(`/cash-sessions/${session.id}/close`, close);
    assert.deepEqual(res.body, { id: session.id, status: 'closed', expected_mismatch: false });
    assert.equal((await as.post(`/cash-sessions/${session.id}/close`, close)).body.status, 'duplicate');
    assert.equal((await as.get('/cash-sessions/current?register_id=reg_1')).body.session, null);
  });

  test('vente arrivée après la clôture : acceptée et signalée', async () => {
    const s = sale({ session, lines: [line(P1, 1)] });
    assert.equal((await as.post('/sales', s)).body.session_closed, true);
  });
});
