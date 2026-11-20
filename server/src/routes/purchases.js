// Achats et charges (back-office, contrat §12 proposé) : fournisseurs, factures d'achat (entrée en stock, règlements,
// reste dû) et dépenses par catégorie ; chiffres du tableau de bord qui en découlent.
// Montants en centimes ; quantités en millièmes dans la base, en unités dans l'API. Jours au format AAAA-MM-JJ, dans
// le fuseau des magasins (réglage « timezone »).
import { randomUUID } from 'node:crypto';
import { moveStock, requireStore } from '../core.js';
import { all, fromMilli, get, nowIso, run, toMilli, tx } from '../db.js';
import { localMidnight, localParts, timezoneOf } from '../reports.js';
import { clean, fail, fitsUnit, isDay, isInt, isQuantity, isUuid } from '../validate.js';
import { inList, newId, pageOf, periodOf, storesOf } from './common.js';

/** Moyens de règlement d'un fournisseur ou d'une dépense. */
export const PAY_METHODS = ['cash', 'card', 'transfer', 'cheque'];
/** Catégories de dépenses (libellés dans le back-office). */
export const EXPENSE_CATEGORIES = ['rent', 'electricity', 'water', 'salaries', 'transport', 'supplies', 'maintenance', 'taxes', 'other'];
/** 10 millions de DH : au-delà, saisie aberrante. */
export const MAX_AMOUNT = 1_000_000_000;

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const todayIn = (tz, now = new Date()) => localParts(now.toISOString(), tz).day;

/** Jours locaux [first, last] couverts par une période [from, to[. */
export function dayRange({ from, to }, tz) {
  return { first: localParts(from, tz).day, last: localParts(new Date(Date.parse(to) - 1000).toISOString(), tz).day };
}

/** Jour passé (le lendemain est toléré : horloges décalées), pas avant 2000. */
function pastDay(v, tz, label) {
  if (!isDay(v) || v < '2000-01-01' || v > addDays(todayIn(tz), 1)) fail(400, 'INVALID_DATA', `${label} invalide`);
  return v;
}

const sumOf = (db, sql, ...params) => get(db, sql, ...params).n;

// --- Fournisseurs ------------------------------------------------------------------------------------------------

function supplierFields(b) {
  const name = clean(b.name, 100);
  if (!name) fail(400, 'INVALID_DATA', 'Nom obligatoire');
  const phone = clean(b.phone, 40);
  if (phone && !/^\+?\d{6,15}$/.test(phone.replace(/[\s.-]/g, ''))) fail(400, 'INVALID_DATA', 'Téléphone invalide (6 à 15 chiffres)');
  const email = clean(b.email, 100);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'INVALID_DATA', 'E-mail invalide');
  const ice = clean(b.ice, 40);
  if (ice && !/^\d{15}$/.test(ice)) fail(400, 'INVALID_DATA', 'ICE invalide (15 chiffres)');
  return { name, phone, email, address: clean(b.address, 300), ice, note: clean(b.note), active: b.active === false ? 0 : 1 };
}

function nameFree(db, name, exceptId = '') {
  if (get(db, 'SELECT id FROM suppliers WHERE lower(name) = lower(?) AND id <> ?', name, exceptId)) {
    fail(409, 'DUPLICATE', 'Un fournisseur porte déjà ce nom');
  }
}

/** Fournisseurs avec leurs achats dans les magasins donnés : nombre, total, réglé, reste dû. */
export function supplierRows(db, storeIds, { search = '', due = false } = {}) {
  const S = inList(storeIds);
  const rows = all(db, `SELECT s.*,
    (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.store_id IN (${S})) AS purchases_count,
    (SELECT COALESCE(SUM(total), 0) FROM purchases p WHERE p.supplier_id = s.id AND p.store_id IN (${S})) AS purchases_total,
    (SELECT COALESCE(SUM(sp.amount), 0) FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id
      WHERE p.supplier_id = s.id AND p.store_id IN (${S})) AS paid,
    (SELECT MAX(invoice_date) FROM purchases p WHERE p.supplier_id = s.id AND p.store_id IN (${S})) AS last_purchase_on
    FROM suppliers s ORDER BY s.name COLLATE NOCASE`, ...storeIds, ...storeIds, ...storeIds, ...storeIds)
    .map((s) => ({ ...s, active: s.active === 1, due: s.purchases_total - s.paid }));
  const q = search.trim().toLowerCase();
  return rows.filter((s) => (!q || [s.name, s.phone, s.ice, s.email].some((v) => (v ?? '').toLowerCase().includes(q))) && (!due || s.due > 0));
}

// --- Factures d'achat --------------------------------------------------------------------------------------------

const PURCHASE_SELECT = `SELECT p.*, s.name AS supplier_name, st.name AS store_name, u.name AS created_by_name,
  (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments sp WHERE sp.purchase_id = p.id) AS paid,
  (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id = p.id) AS lines_count
  FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN stores st ON st.id = p.store_id
  LEFT JOIN users u ON u.id = p.created_by`;
const purchaseRow = (p) => ({ ...p, due: p.total - p.paid });

function purchaseDetail(db, id) {
  const p = get(db, `${PURCHASE_SELECT} WHERE p.id = ?`, id);
  if (!p) return null;
  return {
    purchase: purchaseRow(p),
    lines: all(db, `SELECT pl.*, pr.code, pr.name, pr.unit FROM purchase_lines pl LEFT JOIN products pr ON pr.id = pl.product_id
      WHERE pl.purchase_id = ? ORDER BY pl.line`, id).map((l) => ({ ...l, quantity: fromMilli(l.quantity) })),
    payments: all(db, `SELECT sp.*, u.name AS user_name FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.user_id
      WHERE sp.purchase_id = ? ORDER BY sp.paid_on, sp.created_at`, id),
  };
}

/** Lignes d'une facture : article connu, quantité conforme à l'unité, prix d'achat unitaire en centimes. */
function purchaseLines(db, lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 500) fail(400, 'INVALID_DATA', 'Lignes invalides');
  if (new Set(lines.map((l) => l?.product_id)).size !== lines.length) fail(400, 'INVALID_DATA', 'Un article apparaît deux fois');
  return lines.map((l, index) => {
    const p = l && get(db, 'SELECT id, unit FROM products WHERE id = ?', l.product_id);
    if (!p) fail(422, 'PRODUCT_UNKNOWN', 'Article inconnu', { line_index: index });
    if (!isQuantity(l.quantity) || !fitsUnit(p.unit, l.quantity)) {
      fail(400, 'INVALID_QUANTITY', p.unit === 'unit' ? 'Quantité entière attendue' : 'Quantité invalide (3 décimales au plus)', { line_index: index });
    }
    if (!isInt(l.unit_cost, 0, 100_000_000)) fail(400, 'INVALID_DATA', 'Prix d’achat invalide', { line_index: index });
    return { product_id: p.id, quantity: l.quantity, unit_cost: l.unit_cost, total: Math.round(l.quantity * l.unit_cost) };
  });
}

function paymentFields(b, tz, due) {
  if (!PAY_METHODS.includes(b.method)) fail(400, 'INVALID_DATA', 'Moyen de paiement invalide');
  if (!isInt(b.amount, 1, MAX_AMOUNT)) fail(400, 'INVALID_DATA', 'Montant invalide');
  if (b.amount > due) fail(422, 'PAYMENT_EXCEEDS_DUE', 'Le règlement dépasse le reste dû', { due });
  return { method: b.method, amount: b.amount, paid_on: b.paid_on === undefined ? todayIn(tz) : pastDay(b.paid_on, tz, 'Date du règlement'), note: clean(b.note) };
}

function insertPayment(db, { id, purchaseId, storeId, userId, p }) {
  run(db, `INSERT INTO supplier_payments (id, purchase_id, store_id, method, amount, paid_on, note, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, purchaseId, storeId, p.method, p.amount, p.paid_on, p.note, userId, nowIso());
}

// --- Dépenses ----------------------------------------------------------------------------------------------------

function expenseFields(b, tz) {
  if (!EXPENSE_CATEGORIES.includes(b.category)) fail(400, 'INVALID_DATA', 'Catégorie invalide');
  if (!isInt(b.amount, 1, MAX_AMOUNT)) fail(400, 'INVALID_DATA', 'Montant invalide');
  if (!PAY_METHODS.includes(b.method)) fail(400, 'INVALID_DATA', 'Moyen de paiement invalide');
  const note = clean(b.note);
  if (b.category === 'other' && !note) fail(400, 'NOTE_REQUIRED', 'Précisez la dépense « Autre »');
  return { category: b.category, amount: b.amount, method: b.method, spent_on: pastDay(b.spent_on, tz, 'Date de la dépense'), note };
}

// --- Routes ------------------------------------------------------------------------------------------------------

/** Ajoute les routes des achats et dépenses au routeur du back-office (déjà réservé aux responsables). */
export function purchaseRoutes(r, db) {
  r.get('/suppliers', (req, res) => {
    res.json(supplierRows(db, req.user.store_ids, { search: String(req.query.search ?? ''), due: req.query.due === '1' }));
  });

  r.get('/suppliers/:id', (req, res) => {
    const supplier = supplierRows(db, req.user.store_ids).find((s) => s.id === req.params.id);
    if (!supplier) fail(404, 'NOT_FOUND', 'Fournisseur introuvable');
    const ids = req.user.store_ids;
    res.json({
      supplier,
      purchases: all(db, `${PURCHASE_SELECT} WHERE p.supplier_id = ? AND p.store_id IN (${inList(ids)})
        ORDER BY p.invoice_date DESC, p.number DESC LIMIT 500`, supplier.id, ...ids).map(purchaseRow),
    });
  });

  r.post('/suppliers', (req, res) => {
    const f = supplierFields(req.body ?? {});
    nameFree(db, f.name);
    const id = newId('sup');
    const now = nowIso();
    run(db, `INSERT INTO suppliers (id, name, phone, email, address, ice, note, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, f.name, f.phone, f.email, f.address, f.ice, f.note, f.active, now, now);
    res.status(201).json(supplierRows(db, req.user.store_ids).find((s) => s.id === id));
  });

  r.put('/suppliers/:id', (req, res) => {
    if (!get(db, 'SELECT id FROM suppliers WHERE id = ?', req.params.id)) fail(404, 'NOT_FOUND', 'Fournisseur introuvable');
    const f = supplierFields(req.body ?? {});
    nameFree(db, f.name, req.params.id);
    run(db, `UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, ice = ?, note = ?, active = ?, updated_at = ? WHERE id = ?`,
      f.name, f.phone, f.email, f.address, f.ice, f.note, f.active, nowIso(), req.params.id);
    res.json(supplierRows(db, req.user.store_ids).find((s) => s.id === req.params.id));
  });

  r.get('/purchases', (req, res) => {
    const storeIds = storesOf(req);
    const tz = timezoneOf(db);
    const { first, last } = dayRange(periodOf(req), tz);
    const where = [`p.store_id IN (${inList(storeIds)})`, 'p.invoice_date >= ?', 'p.invoice_date <= ?'];
    const params = [...storeIds, first, last];
    if (req.query.supplier_id) { where.push('p.supplier_id = ?'); params.push(String(req.query.supplier_id)); }
    const search = String(req.query.search ?? '').trim().toLowerCase();
    if (search) {
      where.push('(lower(p.number) LIKE ? OR lower(COALESCE(p.invoice_ref, \'\')) LIKE ? OR lower(s.name) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    let rows = all(db, `${PURCHASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.invoice_date DESC, p.number DESC`, ...params).map(purchaseRow);
    if (req.query.due === '1') rows = rows.filter((p) => p.due > 0);
    const { limit, offset } = pageOf(req);
    res.json({
      count: rows.length,
      total: rows.reduce((n, p) => n + p.total, 0),
      paid: rows.reduce((n, p) => n + p.paid, 0),
      due: rows.reduce((n, p) => n + p.due, 0),
      items: rows.slice(offset, offset + limit),
    });
  });

  r.get('/purchases/:id', (req, res) => {
    const detail = purchaseDetail(db, req.params.id);
    if (!detail) fail(404, 'NOT_FOUND', 'Facture introuvable');
    requireStore(req, detail.purchase.store_id);
    res.json(detail);
  });

  // Facture d'achat : la marchandise entre en stock (réception), le prix d'achat des articles est mis à jour, un
  // premier règlement peut être saisi. Idempotente par id (double clic, réseau coupé).
  r.post('/purchases', (req, res) => {
    const b = req.body ?? {};
    const tz = timezoneOf(db);
    const id = b.id ?? randomUUID();
    if (!isUuid(id)) fail(400, 'INVALID_DATA', 'id invalide');
    const known = purchaseDetail(db, id);
    if (known) {
      requireStore(req, known.purchase.store_id);
      return res.json({ ...known, status: 'duplicate' });
    }
    requireStore(req, b.store_id);
    if (!get(db, 'SELECT id FROM suppliers WHERE id = ?', b.supplier_id)) fail(422, 'SUPPLIER_UNKNOWN', 'Fournisseur inconnu');
    const invoiceDate = pastDay(b.invoice_date, tz, 'Date de facture');
    const lines = purchaseLines(db, b.lines);
    const total = lines.reduce((n, l) => n + l.total, 0);
    if (total > MAX_AMOUNT) fail(400, 'INVALID_DATA', 'Total aberrant : vérifiez les quantités et les prix');
    const payment = b.payment ? paymentFields({ paid_on: invoiceDate, ...b.payment }, tz, total) : null;
    tx(db, () => {
      const seq = get(db, 'SELECT COALESCE(MAX(CAST(substr(number, 5) AS INTEGER)), 0) + 1 AS n FROM purchases').n;
      const number = `ACH-${String(seq).padStart(6, '0')}`;
      const at = nowIso();
      run(db, `INSERT INTO purchases (id, number, supplier_id, store_id, invoice_ref, invoice_date, total, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, number, b.supplier_id, b.store_id, clean(b.invoice_ref, 60), invoiceDate, total, clean(b.note),
      req.user.id, at);
      lines.forEach((l, i) => {
        run(db, 'INSERT INTO purchase_lines (purchase_id, line, product_id, quantity, unit_cost, total) VALUES (?, ?, ?, ?, ?, ?)',
          id, i + 1, l.product_id, toMilli(l.quantity), l.unit_cost, l.total);
        moveStock(db, { productId: l.product_id, storeId: b.store_id, delta: toMilli(l.quantity), kind: 'receipt', refId: id,
          note: `Facture d’achat ${number}`, userId: req.user.id, at });
        if (l.unit_cost > 0) run(db, 'UPDATE products SET cost_price = ? WHERE id = ?', l.unit_cost, l.product_id);
      });
      if (payment) insertPayment(db, { id: randomUUID(), purchaseId: id, storeId: b.store_id, userId: req.user.id, p: payment });
    });
    res.status(201).json({ ...purchaseDetail(db, id), status: 'created' });
  });

  // Règlement d'une facture d'achat : idempotent par id, jamais plus que le reste dû.
  r.post('/purchases/:id/payments', (req, res) => {
    const detail = purchaseDetail(db, req.params.id);
    if (!detail) fail(404, 'NOT_FOUND', 'Facture introuvable');
    requireStore(req, detail.purchase.store_id);
    const b = req.body ?? {};
    const id = b.id ?? randomUUID();
    if (!isUuid(id)) fail(400, 'INVALID_DATA', 'id invalide');
    if (detail.payments.some((p) => p.id === id)) return res.json({ ...detail, status: 'duplicate' });
    if (get(db, 'SELECT id FROM supplier_payments WHERE id = ?', id)) fail(409, 'DUPLICATE', 'Règlement déjà enregistré sur une autre facture');
    const p = paymentFields(b, timezoneOf(db), detail.purchase.due);
    insertPayment(db, { id, purchaseId: detail.purchase.id, storeId: detail.purchase.store_id, userId: req.user.id, p });
    res.status(201).json({ ...purchaseDetail(db, detail.purchase.id), status: 'created' });
  });

  r.get('/expenses', (req, res) => {
    const storeIds = storesOf(req);
    const { first, last } = dayRange(periodOf(req), timezoneOf(db));
    const where = [`e.store_id IN (${inList(storeIds)})`, 'e.spent_on >= ?', 'e.spent_on <= ?'];
    const params = [...storeIds, first, last];
    if (req.query.category) { where.push('e.category = ?'); params.push(String(req.query.category)); }
    const items = all(db, `SELECT e.*, st.name AS store_name, u.name AS user_name FROM expenses e LEFT JOIN stores st ON st.id = e.store_id
      LEFT JOIN users u ON u.id = e.user_id WHERE ${where.join(' AND ')} ORDER BY e.spent_on DESC, e.created_at DESC`, ...params);
    const byCategory = new Map();
    for (const e of items) {
      const c = byCategory.get(e.category) ?? { category: e.category, amount: 0, count: 0 };
      c.amount += e.amount;
      c.count += 1;
      byCategory.set(e.category, c);
    }
    res.json({
      total: items.reduce((n, e) => n + e.amount, 0),
      by_category: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
      items,
    });
  });

  r.post('/expenses', (req, res) => {
    const b = req.body ?? {};
    const id = b.id ?? randomUUID();
    if (!isUuid(id)) fail(400, 'INVALID_DATA', 'id invalide');
    const known = get(db, 'SELECT * FROM expenses WHERE id = ?', id);
    if (known) {
      requireStore(req, known.store_id);
      return res.json({ expense: known, status: 'duplicate' });
    }
    requireStore(req, b.store_id);
    const f = expenseFields(b, timezoneOf(db));
    run(db, `INSERT INTO expenses (id, store_id, category, amount, method, spent_on, note, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, b.store_id, f.category, f.amount, f.method, f.spent_on, f.note, req.user.id, nowIso());
    res.status(201).json({ expense: get(db, 'SELECT * FROM expenses WHERE id = ?', id), status: 'created' });
  });

  // Dépense saisie par erreur : supprimée (la caisse n'en dépend pas).
  r.delete('/expenses/:id', (req, res) => {
    const e = get(db, 'SELECT id, store_id FROM expenses WHERE id = ?', req.params.id);
    if (!e) fail(404, 'NOT_FOUND', 'Dépense introuvable');
    requireStore(req, e.store_id);
    run(db, 'DELETE FROM expenses WHERE id = ?', e.id);
    res.status(204).end();
  });
}

// --- Tableau de bord ---------------------------------------------------------------------------------------------

/**
 * Chiffres du tableau de bord (magasins donnés) : totaux depuis le début, journée en cours, effectifs, achats, ventes
 * et dépenses mois par mois sur une année, dépenses de la période par catégorie, articles ajoutés récemment.
 * Ventes nettes = ventes encaissées − retours ; reçu = payé à la caisse (hors crédit) − rendu + règlements de dettes.
 */
export function overview(db, { storeIds, from, to, timeZone, year, now = new Date() }) {
  const S = inList(storeIds);
  const ids = storeIds;
  const salesNet = (start, end) =>
    sumOf(db, `SELECT COALESCE(SUM(total_ttc), 0) AS n FROM sales WHERE store_id IN (${S}) AND status = 'completed'
      AND created_at >= ? AND created_at < ?`, ...ids, start, end)
    - sumOf(db, `SELECT COALESCE(SUM(total_ttc), 0) AS n FROM refunds WHERE store_id IN (${S}) AND created_at >= ? AND created_at < ?`, ...ids, start, end);
  const received = (start, end) =>
    sumOf(db, `SELECT COALESCE(SUM(total_ttc - credit), 0) AS n FROM sales WHERE store_id IN (${S}) AND status = 'completed'
      AND created_at >= ? AND created_at < ?`, ...ids, start, end)
    - sumOf(db, `SELECT COALESCE(SUM(total_ttc - credit), 0) AS n FROM refunds WHERE store_id IN (${S}) AND created_at >= ? AND created_at < ?`, ...ids, start, end)
    + sumOf(db, `SELECT COALESCE(SUM(amount), 0) AS n FROM customer_payments WHERE store_id IN (${S}) AND created_at >= ? AND created_at < ?`, ...ids, start, end);
  const purchases = (first, last) => sumOf(db, `SELECT COALESCE(SUM(total), 0) AS n FROM purchases WHERE store_id IN (${S})
    AND invoice_date >= ? AND invoice_date <= ?`, ...ids, first, last);
  const expenses = (first, last) => sumOf(db, `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses WHERE store_id IN (${S})
    AND spent_on >= ? AND spent_on <= ?`, ...ids, first, last);
  const EVER = ['0000-01-01', '9999-12-31'];

  const today = todayIn(timeZone, now);
  const todayFrom = localMidnight(today, timeZone);
  const todayTo = localMidnight(addDays(today, 1), timeZone);
  const purchasesTotal = purchases(...EVER);
  const supplierPaid = sumOf(db, `SELECT COALESCE(SUM(amount), 0) AS n FROM supplier_payments WHERE store_id IN (${S})`, ...ids);
  const creditLeft = sumOf(db, `SELECT COALESCE(SUM(credit), 0) AS n FROM sales WHERE store_id IN (${S}) AND status = 'completed'`, ...ids)
    - sumOf(db, `SELECT COALESCE(SUM(credit), 0) AS n FROM refunds WHERE store_id IN (${S})`, ...ids)
    - sumOf(db, `SELECT COALESCE(SUM(amount), 0) AS n FROM customer_payments WHERE store_id IN (${S})`, ...ids);

  const y = /^\d{4}$/.test(String(year ?? '')) && Number(year) >= 2000 && Number(year) <= 2100 ? String(year) : today.slice(0, 4);
  const monthOf = (m) => `${y}-${String(m).padStart(2, '0')}`;
  const grouped = (table, column, amount) => new Map(all(db, `SELECT substr(${column}, 1, 7) AS m, SUM(${amount}) AS n FROM ${table}
    WHERE store_id IN (${S}) AND ${column} >= ? AND ${column} <= ? GROUP BY m`, ...ids, `${y}-01-01`, `${y}-12-31`).map((r) => [r.m, r.n]));
  const monthPurchases = grouped('purchases', 'invoice_date', 'total');
  const monthExpenses = grouped('expenses', 'spent_on', 'amount');
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = monthOf(i + 1);
    const next = i === 11 ? `${Number(y) + 1}-01` : monthOf(i + 2);
    return {
      month,
      sales: salesNet(localMidnight(`${month}-01`, timeZone), localMidnight(`${next}-01`, timeZone)),
      purchases: monthPurchases.get(month) ?? 0,
      expenses: monthExpenses.get(month) ?? 0,
    };
  });

  const { first, last } = dayRange({ from, to }, timeZone);
  return {
    today,
    totals: {
      purchases_due: purchasesTotal - supplierPaid,
      sales_due: Math.max(0, creditLeft),
      sales: salesNet('0000', '9999'),
      expenses: expenses(...EVER),
    },
    today_totals: {
      purchases: purchases(today, today),
      received: received(todayFrom, todayTo),
      sales: salesNet(todayFrom, todayTo),
      expenses: expenses(today, today),
    },
    counts: {
      customers: sumOf(db, 'SELECT COUNT(*) AS n FROM customers'),
      suppliers: sumOf(db, 'SELECT COUNT(*) AS n FROM suppliers WHERE active = 1'),
      purchases: sumOf(db, `SELECT COUNT(*) AS n FROM purchases WHERE store_id IN (${S})`, ...ids),
      sales: sumOf(db, `SELECT COUNT(*) AS n FROM sales WHERE store_id IN (${S}) AND status = 'completed'`, ...ids),
    },
    monthly: { year: Number(y), months },
    period: {
      purchases: purchases(first, last),
      expenses: expenses(first, last),
      expenses_by_category: all(db, `SELECT category, SUM(amount) AS amount, COUNT(*) AS count FROM expenses WHERE store_id IN (${S})
        AND spent_on >= ? AND spent_on <= ? GROUP BY category ORDER BY amount DESC`, ...ids, first, last),
    },
    recent_products: all(db, `SELECT id, code, name, price_ttc, unit, COALESCE(created_at, updated_at) AS added_at FROM products
      ORDER BY COALESCE(created_at, updated_at) DESC, code DESC LIMIT 8`),
  };
}
