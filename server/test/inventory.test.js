// Inventaire par feuille de comptage, modification groupée d'articles, fusion de catégories (back-office).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { line, P1, sale, sessionBody, startServer } from './helpers.js';

let srv;
let manager;
let cashier;
before(async () => {
  srv = await startServer();
  manager = await srv.login('responsable');
  cashier = await srv.login('caissier');
});
after(() => srv.close());

const stockOf = async (productId, storeId = 'st_1') => (await manager.get(`/admin/products/${productId}`)).body.product.stock_by_store[storeId] ?? 0;

describe('inventaire', () => {
  let inv;
  test('ouverture : nom obligatoire, un seul inventaire ouvert par magasin, caissier refusé', async () => {
    assert.equal((await manager.post('/admin/inventories', { store_id: 'st_1', name: ' ' })).status, 400);
    const res = await manager.post('/admin/inventories', { store_id: 'st_1', name: 'Inventaire de novembre', category_id: 'cat_1' });
    assert.equal(res.status, 201);
    inv = res.body;
    assert.equal(inv.status, 'open');
    assert.equal((await manager.post('/admin/inventories', { store_id: 'st_1', name: 'Autre' })).status, 409);
    assert.equal((await cashier.get('/admin/inventories')).status, 403);
  });

  test('feuille : articles actifs de la catégorie ; comptage enregistré, recompté, effacé', async () => {
    const sheet = (await manager.get(`/admin/inventories/${inv.id}`)).body;
    assert.ok(sheet.rows.length > 0);
    assert.ok(sheet.rows.every((r) => r.counted === null));
    assert.equal((await manager.put(`/admin/inventories/${inv.id}/counts/${P1.id}`, { counted: 1.5 })).status, 400); // pièce : entier
    assert.equal((await manager.put(`/admin/inventories/${inv.id}/counts/${P1.id}`, { counted: -1 })).status, 400);
    const before = await stockOf(P1.id);
    const c = (await manager.put(`/admin/inventories/${inv.id}/counts/${P1.id}`, { counted: before - 3 })).body;
    assert.equal(c.delta, -3);
    assert.equal(await stockOf(P1.id), before); // rien n'est appliqué avant la validation
    const again = (await manager.get(`/admin/inventories/${inv.id}`)).body;
    assert.equal(again.inventory.counted, 1);
    assert.equal(again.inventory.gaps, 1);
  });

  test('validation : l’écart constaté au comptage s’applique, les ventes faites entre-temps sont gardées', async () => {
    const before = await stockOf(P1.id); // compté : before − 3
    // Le responsable vend 2 pains à la caisse du magasin test après le comptage, avant la validation.
    const session = sessionBody('st_1', 'reg_2', 'u_3');
    const opened = await manager.post('/cash-sessions', session);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    const s = sale({ session, cashier_id: 'u_3', lines: [line(P1, 2)], payments: [{ method: 'cash', amount: 300 }] });
    const sold1 = await manager.post('/sales', s);
    assert.equal(sold1.status, 201, JSON.stringify(sold1.body));
    const sold = 2;
    const res = await manager.post(`/admin/inventories/${inv.id}/validate`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'validated');
    assert.equal(await stockOf(P1.id), before - sold - 3);
    assert.equal((await manager.put(`/admin/inventories/${inv.id}/counts/${P1.id}`, { counted: 1 })).status, 409);
    const sheet = (await manager.get(`/admin/inventories/${inv.id}`)).body;
    assert.equal(sheet.rows.length, 1); // terminé : seulement ce qui a été compté
  });

  test('inventaire complet : les articles non comptés passent à 0 ; annulation sans effet sur le stock', async () => {
    const full = (await manager.post('/admin/inventories', { store_id: 'st_1', name: 'Rayon boulangerie', category_id: 'cat_1' })).body;
    const sheet = (await manager.get(`/admin/inventories/${full.id}`)).body;
    const target = sheet.rows.find((r) => r.product_id !== P1.id && r.stock > 0);
    await manager.put(`/admin/inventories/${full.id}/counts/${P1.id}`, { counted: 4 });
    await manager.post(`/admin/inventories/${full.id}/validate`, { zero_uncounted: true });
    assert.equal(await stockOf(P1.id), 4);
    assert.equal(await stockOf(target.product_id), 0);

    const cancelled = (await manager.post('/admin/inventories', { store_id: 'st_1', name: 'Essai' })).body;
    await manager.put(`/admin/inventories/${cancelled.id}/counts/${P1.id}`, { counted: 99 });
    assert.equal((await manager.post(`/admin/inventories/${cancelled.id}/cancel`)).body.status, 'cancelled');
    assert.equal(await stockOf(P1.id), 4);
  });
});

describe('modification groupée et fusion', () => {
  test('changer la catégorie et désactiver plusieurs articles ; pas d’activation à 0 DH', async () => {
    const created = (await manager.post('/admin/products', { code: 'ZZ01', name: 'Sans prix', price_ttc: 0, tva_rate: 0, unit: 'unit', active: false })).body;
    const res = await manager.post('/admin/products/bulk', { ids: [P1.id, created.id], set: { category_id: 'cat_2', active: false } });
    assert.deepEqual(res.body, { updated: 2 });
    const p = (await manager.get(`/admin/products/${P1.id}`)).body.product;
    assert.equal(p.category_id, 'cat_2');
    assert.equal(p.active, false);
    const refused = await manager.post('/admin/products/bulk', { ids: [P1.id, created.id], set: { active: true } });
    assert.equal(refused.status, 422);
    assert.equal((await manager.post('/admin/products/bulk', { ids: [P1.id], set: { active: true } })).body.updated, 1);
    assert.equal((await manager.post('/admin/products/bulk', { ids: [], set: { active: true } })).status, 400);
    assert.equal((await manager.post('/admin/products/bulk', { ids: [P1.id], set: { tva_rate: 13 } })).status, 400);
  });

  test('fusion : les articles passent dans la catégorie gardée, l’autre disparaît', async () => {
    const dup = (await manager.post('/admin/categories', { name: 'LRS EPICES' })).body;
    await manager.post('/admin/products/bulk', { ids: [P1.id], set: { category_id: dup.id } });
    const res = await manager.post(`/admin/categories/${dup.id}/merge`, { into: 'cat_1' });
    assert.equal(res.body.moved, 1);
    assert.equal((await manager.get(`/admin/products/${P1.id}`)).body.product.category_id, 'cat_1');
    assert.ok(!(await manager.get('/admin/categories')).body.some((c) => c.id === dup.id));
    assert.equal((await manager.post(`/admin/categories/cat_1/merge`, { into: 'cat_1' })).status, 422);
  });
});
