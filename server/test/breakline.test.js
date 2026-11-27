// Connexion BreakLine contre un faux BreakLine en mémoire (aucun réseau) : catalogue reçu, ventes envoyées une seule fois,
// panne (tunnel ngrok coupé) sans perte ni double décompte.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createBreakline, priceToCents, toProduct } from '../src/breakline.js';
import { get } from '../src/db.js';
import { line, sale, sessionBody, startServer } from './helpers.js';

const ITEM = { id: randomUUID(), name: 'Msemen maison', price: '12.50', stock_quantity: 10, sku: 'msm-01', category: 'c1' };

/** Faux BreakLine : stock par article, mouvements comptés une fois par clé ; `down` simule le tunnel coupé, `loseNext` une réponse perdue. */
function fakeBreakline() {
  const state = { stock: new Map([[ITEM.id, ITEM.stock_quantity]]), keys: new Set(), down: false, loseNext: false, posted: 0 };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, { method = 'GET', body } = {}) => {
    if (state.down) return new Response('<html>offline</html>', { status: 404, headers: { 'ngrok-error-code': 'ERR_NGROK_3200' } });
    const path = new URL(url).pathname;
    if (path === '/api/auth/login/') return json({ access: 'jeton' });
    if (path === '/api/categories/') return json({ results: [{ id: 'c1', name: 'Boulangerie BreakLine' }], next: null });
    if (path === '/api/pos/items/') return json({ results: [{ ...ITEM, stock_quantity: state.stock.get(ITEM.id) }], next: null });
    if (path === '/api/pos/stock-movements/' && method === 'POST') {
      state.posted += 1;
      const results = JSON.parse(body).movements.map((m) => {
        if (state.keys.has(m.key)) return { key: m.key, status: 'duplicate' };
        state.keys.add(m.key);
        state.stock.set(m.item_id, state.stock.get(m.item_id) + m.delta);
        return { key: m.key, status: 'applied' };
      });
      if (state.loseNext) { state.loseNext = false; return json({ detail: 'passerelle' }, 503); } // appliqué, mais réponse perdue
      return json({ results });
    }
    return json({ detail: 'introuvable' }, 404);
  };
  return { state, fetchImpl };
}

const quiet = { info() {}, warn() {} };

describe('BreakLine : lecture des données', () => {
  test('prix décimal en centimes, articles aberrants refusés', () => {
    assert.equal(priceToCents('12.5'), 1250);
    assert.equal(priceToCents('12'), 1200);
    assert.equal(priceToCents(3.05), 305);
    assert.equal(priceToCents('1,50'), null);
    assert.equal(priceToCents('-3'), null);
    assert.equal(toProduct({ ...ITEM, price: '0' }, 0), null);
    assert.equal(toProduct({ ...ITEM, stock_quantity: -1 }, 0), null);
    assert.equal(toProduct({ ...ITEM, id: 'pas-un-uuid' }, 0), null);
    assert.equal(toProduct(ITEM, 0).code, 'MSM-01');
  });
});

describe('BreakLine : synchronisation', () => {
  let srv;
  let manager;
  let bridge;
  let fake;
  let session;
  before(async () => {
    srv = await startServer();
    manager = await srv.login('responsable');
    fake = fakeBreakline();
    bridge = createBreakline({ db: srv.db, url: 'https://exemple.ngrok-free.dev', email: 'pos@exemple.ma', password: 'x', storeId: 'st_1',
      fetchImpl: fake.fetchImpl, log: quiet });
    session = sessionBody('st_1', 'reg_2', 'u_3');
    assert.equal((await manager.post('/cash-sessions', session)).status, 201);
  });
  after(async () => {
    await new Promise((ok) => setTimeout(ok, 600)); // envoi programmé après une vente
    await bridge.idle();
    bridge.stop();
    await srv.close();
  });

  const stock = () => get(srv.db, 'SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?', ITEM.id, 'st_1').quantity / 1000;
  const sell = async (quantity) => {
    const product = { id: ITEM.id, name: ITEM.name, price_ttc: 1250, tva_rate: 0 };
    const res = await manager.post('/sales', sale({ session, cashier_id: 'u_3', lines: [line(product, quantity)] }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
  };

  test('le catalogue BreakLine arrive dans le POS avec son stock', async () => {
    await bridge.sync();
    const p = get(srv.db, 'SELECT * FROM products WHERE id = ?', ITEM.id);
    assert.equal(p.source, 'breakline');
    assert.equal(p.price_ttc, 1250);
    assert.equal(p.code, 'MSM-01');
    assert.equal(stock(), 10);
  });

  test('une vente de la caisse est retirée du stock BreakLine, une seule fois', async () => {
    await sell(2);
    await bridge.sync();
    assert.equal(fake.state.stock.get(ITEM.id), 8);
    assert.equal(stock(), 8);
    assert.equal(bridge.status().pending, 0);
  });

  test('BreakLine injoignable : la vente attend dans la file, rien n’est perdu ni compté deux fois', async () => {
    fake.state.down = true;
    await sell(1);
    await bridge.sync();
    assert.equal(bridge.status().pending, 1);
    assert.match(bridge.status().problem, /ngrok/);
    assert.equal(stock(), 7);
    fake.state.stock.set(ITEM.id, fake.state.stock.get(ITEM.id) - 2); // pendant la panne, 2 précommandes sur BreakLine
    fake.state.down = false;
    await bridge.sync();
    assert.equal(bridge.status().pending, 0);
    assert.equal(bridge.status().problem, null);
    assert.equal(fake.state.stock.get(ITEM.id), 5); // 8 − 2 précommandes − 1 vente
    assert.equal(stock(), 5);
  });

  test('réponse perdue : le mouvement est renvoyé, BreakLine le reconnaît et ne le décompte pas deux fois', async () => {
    fake.state.loseNext = true;
    await sell(1);
    await bridge.sync();
    assert.equal(bridge.status().pending, 1);
    assert.equal(fake.state.stock.get(ITEM.id), 4);
    await bridge.sync();
    assert.equal(bridge.status().pending, 0);
    assert.equal(fake.state.stock.get(ITEM.id), 4);
    assert.equal(stock(), 4);
  });

  test('un article du POS (hors BreakLine) n’est jamais envoyé', async () => {
    const before = fake.state.posted;
    const p1 = get(srv.db, "SELECT id, name, price_ttc, tva_rate FROM products WHERE source IS NULL AND active = 1 AND price_ttc > 0 LIMIT 1");
    const res = await manager.post('/sales', sale({ session, cashier_id: 'u_3', lines: [line(p1, 1)] }));
    assert.equal(res.status, 201);
    await bridge.sync();
    assert.equal(fake.state.posted, before);
  });
});
