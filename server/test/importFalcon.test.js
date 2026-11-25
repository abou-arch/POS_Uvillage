// Reprise des exports de Falcon POS : règles de nettoyage et import sans doublon.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { get, openDb, run } from '../src/db.js';
import { centsOf, importFalcon, parseProducts, parseSuppliers, splitArabic } from '../src/importFalcon.js';
import { columnOf } from '../src/xlsx.js';

const HEADER = ['#', "Code de l'article", "Nom de l'article", 'Marque', 'Catégorie', 'Prix unitaire(.د.م )', 'Impôt', 'Prix de vente(.د.م )', 'Stock actuel', 'Valeur boursière'];
const PRODUCTS = [
  HEADER,
  ['1', 'IT0001', 'Pain normal (خبز عادي)', '', 'Boulangerie (مخبزة)', '0.65', 'None[Exc.]', '1.50', '999922114.00', ''],
  ['2', 'IT0005', 'FROMAGE CARRÉE', 'Dari', 'Pattes (عجائن)', '1.00', 'None[Exc.]', '1.00', '3085.00', ''],
  ['3', 'IT0022', 'NatiCrem 200ml', '', 'Produits laitiers (الحليب ومشتقاته)', '0.00', 'None[Exc.]', '0.00', '63.00', ''],
  ['4', 'IT0005', 'Jnane fraise (110g)', '', '', '2.00', 'None[Exc.]', '2.50', '699.00', ''],
  ['Total :', '', '', '', '', '38,436.98', '', '40,359.81', '4,894,452,511.00', ''],
];
const SUPPLIERS = [
  ['Liste des fournisseurs'],
  ['ID du fournisseur', 'Nom du fournisseur', 'Mobile', 'E-mail', 'Achat dû', "Retour d'achat dû", 'Statut'],
  ['SP0018', 'AYOUB NARJIS', '', '', '10088.31', '0', 'Active'],
  ['SP0014', 'DALAA', '', '', '0', '0', 'Active'],
];

describe('reprise de Falcon POS', () => {
  test('lecture : nom et arabe séparés, montants en centimes, colonnes du .xlsx', () => {
    assert.deepEqual(splitArabic('Pain normal (خبز عادي)'), { name: 'Pain normal', name_ar: 'خبز عادي' });
    assert.deepEqual(splitArabic('Jnane fraise (110g)'), { name: 'Jnane fraise (110g)', name_ar: null });
    assert.equal(centsOf('1,234.50'), 123450);
    assert.equal(centsOf('abc'), null);
    assert.deepEqual(['A1', 'J3', 'AA1'].map(columnOf), [0, 9, 26]);
  });

  test('nettoyage : ligne Total ignorée, code en double renommé, prix nul inactif, stock absurde à 0', () => {
    const { products, report } = parseProducts(PRODUCTS);
    assert.deepEqual(products.map((p) => p.code), ['IT0001', 'IT0005', 'IT0022', 'IT0005-2']);
    assert.equal(products[0].stock, 0);
    assert.equal(products[1].stock, 3085);
    assert.equal(products[2].active, false);
    assert.deepEqual(products[0].category, { name: 'Boulangerie', name_ar: 'مخبزة' });
    assert.equal(products[3].category, null);
    assert.deepEqual(report.absurdStock.map((r) => r.code), ['IT0001']);
    assert.deepEqual(report.renamedCodes.map((r) => r.to), ['IT0005-2']);
  });

  test('import : articles, stock, fournisseurs et reste dû ; relancé, rien en double', () => {
    const db = openDb(':memory:');
    run(db, "INSERT INTO stores (id, name) VALUES ('st_1', 'Supérette')");
    run(db, "INSERT INTO users (id, username, name, role, password_hash, created_at) VALUES ('u_1', 'admin', 'Admin', 'admin', 'x', '2026-01-01T00:00:00Z')");
    const { products } = parseProducts(PRODUCTS);
    const suppliers = parseSuppliers(SUPPLIERS);
    const first = importFalcon(db, { products, suppliers, storeId: 'st_1', userId: 'u_1' });
    assert.equal(first.products, 4);
    assert.equal(first.stockLines, 3);
    assert.equal(first.suppliers, 2);
    assert.equal(first.openingDues, 1);
    assert.equal(get(db, "SELECT total FROM purchases WHERE invoice_ref = 'Falcon SP0018'").total, 1008831);
    assert.equal(get(db, "SELECT quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE p.code = 'IT0005'").quantity, 3085000);
    const again = importFalcon(db, { products, suppliers, storeId: 'st_1', userId: 'u_1' });
    assert.deepEqual([again.products, again.suppliers, again.openingDues], [0, 0, 0]);
  });

  test('--update : un code déjà en base prend le nom, le prix et le stock de Falcon', () => {
    const db = openDb(':memory:');
    run(db, "INSERT INTO stores (id, name) VALUES ('st_1', 'Supérette')");
    run(db, "INSERT INTO products (id, code, name, price_ttc, tva_rate, unit, updated_at) VALUES ('p_1', 'IT0005', 'FROMAGE démo', 900, 20, 'unit', '2026-01-01')");
    run(db, "INSERT INTO stock (product_id, store_id, quantity) VALUES ('p_1', 'st_1', 120000)");
    const { products } = parseProducts(PRODUCTS);
    const r = importFalcon(db, { products, storeId: 'st_1', userId: null, update: true });
    assert.equal(r.productsUpdated, 1);
    const p = get(db, "SELECT name, price_ttc, active FROM products WHERE id = 'p_1'");
    assert.deepEqual({ ...p }, { name: 'FROMAGE CARRÉE', price_ttc: 100, active: 1 });
    assert.equal(get(db, "SELECT quantity FROM stock WHERE product_id = 'p_1'").quantity, 3085000);
  });
});
