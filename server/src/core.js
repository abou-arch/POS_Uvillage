// Fonctions partagées par les routes de la caisse et du back-office : magasins d'un utilisateur, stock, documents.
import { randomUUID } from 'node:crypto';
import { all, fromMilli, get, nowIso, run, stampNow } from './db.js';
import { fail } from './validate.js';

export const isResponsible = (role) => role === 'admin' || role === 'manager';

/** Magasins (actifs) d'un utilisateur : tous pour un admin, ceux auxquels il est rattaché sinon. */
export function storeIdsOf(db, user) {
  const rows = user.role === 'admin'
    ? all(db, 'SELECT id FROM stores WHERE active = 1 ORDER BY id')
    : all(db, `SELECT s.id FROM stores s JOIN user_stores us ON us.store_id = s.id
      WHERE us.user_id = ? AND s.active = 1 ORDER BY s.id`, user.id);
  return rows.map((r) => r.id);
}

/** Magasin hors de ceux de l'utilisateur → 403 (docs/SECURITE.md, proposition 1). */
export function requireStore(req, storeId) {
  if (!req.user.store_ids.includes(storeId)) fail(403, 'FORBIDDEN', 'Magasin non autorisé');
}

/** Magasin tel que la caisse le reçoit à la connexion (§2), avec ses caisses actives. */
export function publicStore(db, s) {
  return {
    id: s.id,
    name: s.name,
    closing_difference_threshold: s.closing_difference_threshold,
    cashier_max_discount_percent: s.cashier_max_discount_percent,
    cashier_max_discount: s.cashier_max_discount,
    registers: all(db, 'SELECT id, name FROM registers WHERE store_id = ? AND active = 1 ORDER BY name, id', s.id),
  };
}

let stockHook = null;
/** Fonction appelée dans la foulée de chaque mouvement de stock (même transaction) : sert à la connexion BreakLine. */
export const setStockHook = (fn) => { stockHook = fn; };

/**
 * Mouvement de stock : la quantité du magasin change de `delta` millièmes, le mouvement est tracé, et l'article est
 * marqué modifié (la caisse reçoit le nouveau stock à sa prochaine synchro, `updated_since`). Renvoie le nouveau stock.
 * `external` : le mouvement vient d'une synchro (BreakLine), il ne doit pas être renvoyé à son origine.
 */
export function moveStock(db, { productId, storeId, delta, kind, refId = null, note = null, userId = null, at = nowIso(), external = false }) {
  if (delta === 0) return null;
  const product = get(db, 'SELECT id FROM products WHERE id = ?', productId);
  if (!product) return null; // article inconnu (supprimé depuis une vente hors ligne) : rien à bouger
  const moveId = randomUUID();
  run(db, `INSERT INTO stock (product_id, store_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(product_id, store_id) DO UPDATE SET quantity = quantity + excluded.quantity`, productId, storeId, delta);
  run(db, `INSERT INTO stock_moves (id, product_id, store_id, delta, kind, ref_id, note, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, moveId, productId, storeId, delta, kind, refId, note, userId, at);
  run(db, 'UPDATE products SET updated_at = ? WHERE id = ?', stampNow(), productId);
  if (!external) stockHook?.(db, { moveId, productId, storeId, delta, kind });
  return get(db, 'SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?', productId, storeId).quantity;
}

/** Article tel que la caisse le reçoit (§3), avec le stock du magasin demandé. */
export function publicProduct(p) {
  return {
    id: p.id, code: p.code, barcode: p.barcode, name: p.name, name_ar: p.name_ar, category_id: p.category_id, brand_id: p.brand_id,
    price_ttc: p.price_ttc, tva_rate: p.tva_rate, unit: p.unit, image_url: p.image_url, stock: fromMilli(p.stock ?? 0),
    stock_alert: p.stock_alert, expiry_date: p.expiry_date, active: p.active === 1, updated_at: p.updated_at,
  };
}

export const parseDoc = (row) => (row ? JSON.parse(row.doc) : null);

/** Responsable du magasin ? Sinon l'opération est acceptée (elle a eu lieu) et signalée au back-office (§11). */
export function approvalWarning(db, approvedBy, storeId) {
  if (approvedBy === undefined || approvedBy === null) return 0;
  const user = get(db, 'SELECT id, role FROM users WHERE id = ?', approvedBy);
  if (!user || !isResponsible(user.role)) return 1;
  if (user.role === 'admin') return 0;
  return get(db, 'SELECT 1 AS ok FROM user_stores WHERE user_id = ? AND store_id = ?', approvedBy, storeId) ? 0 : 1;
}

/**
 * Reste dû d'un client : crédit des ventes encaissées − crédit rendu par les retours − règlements reçus.
 * Négatif : le client a trop payé (avoir).
 */
export function customerBalance(db, customerId) {
  const sold = get(db, `SELECT COALESCE(SUM(credit), 0) AS n FROM sales WHERE customer_id = ? AND status = 'completed'`, customerId).n;
  const refunded = get(db, 'SELECT COALESCE(SUM(credit), 0) AS n FROM refunds WHERE customer_id = ?', customerId).n;
  const paid = get(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM customer_payments WHERE customer_id = ?', customerId).n;
  return sold - refunded - paid;
}
