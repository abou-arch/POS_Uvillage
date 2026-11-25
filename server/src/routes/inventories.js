// Inventaire (back-office) : une feuille de comptage par magasin, ouverte, remplie au fil du comptage (plusieurs
// personnes, plusieurs jours si besoin), puis validée : le stock de chaque article compté devient la quantité comptée.
// Les ventes faites entre le comptage d'un article et la validation sont gardées : on applique l'écart constaté au
// moment du comptage (compté − stock à cet instant), pas « stock = compté » à la validation.
// Quantités en millièmes dans la base, en unités (3 décimales) dans l'API.
import { randomUUID } from 'node:crypto';
import { moveStock, requireStore } from '../core.js';
import { all, fromMilli, get, nowIso, run, toMilli, tx } from '../db.js';
import { clean, fail, fitsUnit, isQuantity } from '../validate.js';

const stockOf = (db, productId, storeId) => get(db, 'SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?', productId, storeId)?.quantity ?? 0;

function inventoryOf(db, req, id) {
  const inv = get(db, `SELECT i.*, c.name AS category_name, u.name AS created_by_name, v.name AS closed_by_name, s.name AS store_name
    FROM inventories i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN users u ON u.id = i.created_by
    LEFT JOIN users v ON v.id = i.closed_by LEFT JOIN stores s ON s.id = i.store_id WHERE i.id = ?`, id);
  if (!inv) fail(404, 'NOT_FOUND', 'Inventaire introuvable');
  requireStore(req, inv.store_id);
  return inv;
}

/** Résumé d'un inventaire : articles comptés, écarts, valeur des écarts au prix d'achat (centimes). */
function summaryOf(db, inv) {
  const rows = all(db, `SELECT k.counted, k.expected, k.delta, p.cost_price FROM inventory_counts k JOIN products p ON p.id = k.product_id
    WHERE k.inventory_id = ?`, inv.id);
  const gapOf = (r) => (r.delta ?? r.counted - r.expected);
  const gaps = rows.filter((r) => gapOf(r) !== 0);
  return {
    counted: rows.length,
    gaps: gaps.length,
    gap_value: Math.round(gaps.reduce((n, r) => n + (gapOf(r) * (r.cost_price ?? 0)) / 1000, 0)),
    missing_cost: gaps.filter((r) => r.cost_price === null).length,
  };
}

const publicInventory = (db, inv) => ({
  id: inv.id, store_id: inv.store_id, store_name: inv.store_name, name: inv.name, category_id: inv.category_id,
  category_name: inv.category_name, status: inv.status, zero_uncounted: inv.zero_uncounted === 1,
  created_by_name: inv.created_by_name, created_at: inv.created_at, closed_by_name: inv.closed_by_name, closed_at: inv.closed_at,
  ...summaryOf(db, inv),
});

/** Articles de la feuille : ceux du périmètre (actifs, de la catégorie choisie), plus tout article déjà compté. */
function sheetRows(db, inv) {
  const rows = all(db, `SELECT p.id, p.code, p.name, p.name_ar, p.unit, p.cost_price, p.category_id, c.name AS category_name, p.active,
    COALESCE(s.quantity, 0) AS stock, k.counted, k.expected, k.delta, k.counted_at, u.name AS counted_by_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = ?
    LEFT JOIN inventory_counts k ON k.product_id = p.id AND k.inventory_id = ?
    LEFT JOIN users u ON u.id = k.counted_by
    WHERE k.product_id IS NOT NULL OR (? = 'open' AND p.active = 1 AND (? IS NULL OR p.category_id = ?))
    ORDER BY p.code`, inv.store_id, inv.id, inv.status, inv.category_id, inv.category_id);
  return rows.map((r) => ({
    product_id: r.id, code: r.code, name: r.name, name_ar: r.name_ar, unit: r.unit, cost_price: r.cost_price,
    category_name: r.category_name, active: r.active === 1, stock: fromMilli(r.stock),
    counted: r.counted === null ? null : fromMilli(r.counted), expected: r.expected === null ? null : fromMilli(r.expected),
    delta: r.delta === null ? (r.counted === null ? null : fromMilli(r.counted - r.expected)) : fromMilli(r.delta),
    counted_at: r.counted_at, counted_by_name: r.counted_by_name,
  }));
}

/** Ajoute les routes de l'inventaire au routeur du back-office (déjà réservé aux responsables). */
export function inventoryRoutes(r, db) {
  r.get('/inventories', (req, res) => {
    const ids = req.user.store_ids;
    const rows = all(db, `SELECT i.*, c.name AS category_name, u.name AS created_by_name, v.name AS closed_by_name, s.name AS store_name
      FROM inventories i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN users v ON v.id = i.closed_by LEFT JOIN stores s ON s.id = i.store_id
      WHERE i.store_id IN (${ids.map(() => '?').join(', ') || "''"}) ORDER BY i.created_at DESC LIMIT 100`, ...ids);
    res.json(rows.map((inv) => publicInventory(db, inv)));
  });

  // Un seul inventaire ouvert par magasin : deux feuilles en même temps se contrediraient.
  r.post('/inventories', (req, res) => {
    const b = req.body ?? {};
    requireStore(req, b.store_id);
    const name = clean(b.name, 80);
    if (!name) fail(400, 'NAME_REQUIRED', 'Donnez un nom à l’inventaire (ex. « Inventaire de novembre »)');
    const categoryId = b.category_id || null;
    if (categoryId && !get(db, 'SELECT id FROM categories WHERE id = ?', categoryId)) fail(422, 'UNKNOWN_REFERENCE', 'Catégorie inconnue');
    if (get(db, "SELECT id FROM inventories WHERE store_id = ? AND status = 'open'", b.store_id)) {
      fail(409, 'INVENTORY_OPEN', 'Un inventaire est déjà en cours dans ce magasin : terminez-le ou annulez-le d’abord');
    }
    const id = randomUUID();
    run(db, `INSERT INTO inventories (id, store_id, name, category_id, status, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      id, b.store_id, name, categoryId, req.user.id, nowIso());
    res.status(201).json(publicInventory(db, inventoryOf(db, req, id)));
  });

  r.get('/inventories/:id', (req, res) => {
    const inv = inventoryOf(db, req, req.params.id);
    res.json({ inventory: publicInventory(db, inv), rows: sheetRows(db, inv) });
  });

  // Quantité comptée d'un article (enregistrée tout de suite) ; null efface le comptage. Recompter remplace.
  r.put('/inventories/:id/counts/:productId', (req, res) => {
    const inv = inventoryOf(db, req, req.params.id);
    if (inv.status !== 'open') fail(409, 'INVENTORY_CLOSED', 'Cet inventaire est terminé');
    const p = get(db, 'SELECT id, unit FROM products WHERE id = ?', req.params.productId);
    if (!p) fail(404, 'NOT_FOUND', 'Article introuvable');
    const q = req.body?.counted;
    if (q === null) {
      run(db, 'DELETE FROM inventory_counts WHERE inventory_id = ? AND product_id = ?', inv.id, p.id);
      return res.json({ product_id: p.id, counted: null });
    }
    if (!(q === 0 || (isQuantity(q) && fitsUnit(p.unit, q)))) {
      fail(400, 'INVALID_QUANTITY', p.unit === 'unit' ? 'Quantité entière attendue (0 ou plus)' : 'Poids invalide (kg, 3 décimales au plus)');
    }
    const expected = stockOf(db, p.id, inv.store_id);
    const at = nowIso();
    run(db, `INSERT INTO inventory_counts (inventory_id, product_id, counted, expected, counted_by, counted_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(inventory_id, product_id) DO UPDATE SET counted = excluded.counted, expected = excluded.expected,
      counted_by = excluded.counted_by, counted_at = excluded.counted_at`, inv.id, p.id, toMilli(q), expected, req.user.id, at);
    res.json({ product_id: p.id, counted: q, expected: fromMilli(expected), delta: fromMilli(toMilli(q) - expected), counted_at: at });
  });

  // Validation : chaque écart devient un mouvement « inventaire ». zero_uncounted : les articles du périmètre qui
  // n'ont pas été comptés sont mis à 0 (inventaire complet du rayon) ; sinon leur stock ne change pas.
  r.post('/inventories/:id/validate', (req, res) => {
    const inv = inventoryOf(db, req, req.params.id);
    if (inv.status !== 'open') fail(409, 'INVENTORY_CLOSED', 'Cet inventaire est déjà terminé');
    const zero = req.body?.zero_uncounted === true;
    const at = nowIso();
    const note = `Inventaire « ${inv.name} »`;
    tx(db, () => {
      if (zero) {
        const missing = all(db, `SELECT p.id FROM products p WHERE p.active = 1 AND (? IS NULL OR p.category_id = ?)
          AND p.id NOT IN (SELECT product_id FROM inventory_counts WHERE inventory_id = ?)`, inv.category_id, inv.category_id, inv.id);
        for (const m of missing) {
          run(db, `INSERT INTO inventory_counts (inventory_id, product_id, counted, expected, counted_by, counted_at) VALUES (?, ?, 0, ?, ?, ?)`,
            inv.id, m.id, stockOf(db, m.id, inv.store_id), req.user.id, at);
        }
      }
      for (const k of all(db, 'SELECT product_id, counted, expected FROM inventory_counts WHERE inventory_id = ?', inv.id)) {
        // Écart constaté au comptage, appliqué au stock d'aujourd'hui ; jamais en dessous de 0.
        const current = stockOf(db, k.product_id, inv.store_id);
        const delta = Math.max(k.counted - k.expected, -Math.max(current, 0));
        moveStock(db, { productId: k.product_id, storeId: inv.store_id, delta, kind: 'inventory', refId: inv.id, note, userId: req.user.id, at });
        run(db, 'UPDATE inventory_counts SET delta = ? WHERE inventory_id = ? AND product_id = ?', delta, inv.id, k.product_id);
      }
      run(db, "UPDATE inventories SET status = 'validated', zero_uncounted = ?, closed_by = ?, closed_at = ? WHERE id = ?",
        zero ? 1 : 0, req.user.id, at, inv.id);
    });
    res.json(publicInventory(db, inventoryOf(db, req, inv.id)));
  });

  // Annulation d'un inventaire en cours : les comptages sont abandonnés, le stock ne change pas.
  r.post('/inventories/:id/cancel', (req, res) => {
    const inv = inventoryOf(db, req, req.params.id);
    if (inv.status !== 'open') fail(409, 'INVENTORY_CLOSED', 'Cet inventaire est déjà terminé');
    run(db, "UPDATE inventories SET status = 'cancelled', closed_by = ?, closed_at = ? WHERE id = ?", req.user.id, nowIso(), inv.id);
    res.json(publicInventory(db, inventoryOf(db, req, inv.id)));
  });
}
