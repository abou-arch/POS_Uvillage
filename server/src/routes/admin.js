// Routes du back-office (/api/admin/*, contrat §12 proposé). Réservées aux responsables :
// - admin : tout, dans tous les magasins ; seul à gérer utilisateurs, magasins et réglages ;
// - manager : ses magasins (ventes, stock, sessions, clients) et le catalogue commun.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { customerBalance, isResponsible, moveStock, parseDoc, publicProduct, requireStore } from '../core.js';
import { all, fromMilli, get, getSetting, nowIso, run, setSetting, stampNow, toMilli, tx } from '../db.js';
import { buildReport, loadLookup, loadPeriod, timezoneOf } from '../reports.js';
import { hashPassword, hashPin, PIN_ITERATIONS, passwordProblem, pinProblem } from '../security.js';
import { DEFAULT_TVA_RATES } from '../seed.js';
import { clean, fail, fitsUnit, isDay, isId, isInt, isQuantity, isUuid, round3 } from '../validate.js';
import { inList, newId, pageOf, periodOf, storesOf } from './common.js';
import { customerFields, expectedByMethod, publicSession } from './pos.js';
import { overview, purchaseRoutes } from './purchases.js';

const bool = (v) => v === true || v === 1;

const adminOnly = (req) => { if (req.user.role !== 'admin') fail(403, 'FORBIDDEN', 'Réservé à l’administrateur'); };
const tvaRates = (db) => getSetting(db, 'tva_rates', DEFAULT_TVA_RATES);

export function adminRoutes(db, { pinIterations = PIN_ITERATIONS } = {}) {
  const r = Router();

  r.use((req, _res, next) => {
    if (!isResponsible(req.user.role)) fail(403, 'FORBIDDEN', 'Back-office réservé aux responsables');
    next();
  });

  // --- Session du back-office ----------------------------------------------------------------------------------

  r.get('/me', (req, res) => {
    res.json({
      user: { id: req.user.id, name: req.user.name, role: req.user.role, username: req.user.username },
      stores: storeList(db, req.user.store_ids),
      settings: { tva_rates: tvaRates(db), timezone: timezoneOf(db) },
    });
  });

  // --- Tableau de bord et rapports -----------------------------------------------------------------------------

  r.get('/dashboard', (req, res) => {
    const storeIds = storesOf(req);
    const { from, to } = periodOf(req);
    const lookup = loadLookup(db);
    const tz = timezoneOf(db);
    const report = buildReport(loadPeriod(db, { storeIds, from, to }), lookup, tz);
    const length = Date.parse(to) - Date.parse(from);
    const before = { from: nowIso(new Date(Date.parse(from) - length)), to: from };
    const previous = buildReport(loadPeriod(db, { storeIds, ...before }), lookup, tz).summary;
    const alerts = stockAlerts(db, storeIds);
    const flags = (table, column) => get(db, `SELECT COUNT(*) AS n FROM ${table} WHERE store_id IN (${inList(storeIds)})
      AND ${column} = 1 AND created_at >= ? AND created_at < ?`, ...storeIds, from, to).n;
    const debtors = customerRows(db, { due: true });
    res.json({
      period: { from, to },
      report,
      previous: { ...before, summary: previous },
      stock_alerts: { count: alerts.length, items: alerts.slice(0, 20) },
      open_sessions: all(db, `SELECT cs.*, u.name AS opened_by_name, rg.name AS register_name FROM cash_sessions cs
        LEFT JOIN users u ON u.id = cs.opened_by LEFT JOIN registers rg ON rg.id = cs.register_id
        WHERE cs.status = 'open' AND cs.store_id IN (${inList(storeIds)}) ORDER BY cs.opened_at`, ...storeIds)
        .map((s) => ({ ...publicSession(s), opened_by_name: s.opened_by_name, register_name: s.register_name, expected: expectedByMethod(db, s) })),
      warnings: {
        price: flags('sales', 'price_warning'),
        approval: flags('sales', 'approval_warning') + flags('refunds', 'approval_warning'),
        session_closed: flags('sales', 'session_closed') + flags('refunds', 'session_closed'),
        expected_mismatch: get(db, `SELECT COUNT(*) AS n FROM cash_sessions WHERE store_id IN (${inList(storeIds)})
          AND expected_mismatch = 1 AND closed_at >= ? AND closed_at < ?`, ...storeIds, from, to).n,
      },
      customers_due: { count: debtors.length, total: debtors.reduce((n, c) => n + c.balance, 0), top: debtors.slice(0, 5) },
      overview: overview(db, { storeIds, from, to, timeZone: tz, year: req.query.year }),
    });
  });

  r.get('/reports', (req, res) => {
    const storeIds = storesOf(req);
    const period = periodOf(req);
    res.json({ period, report: buildReport(loadPeriod(db, { storeIds, ...period }), loadLookup(db), timezoneOf(db)) });
  });

  // --- Catalogue -----------------------------------------------------------------------------------------------

  r.get('/products', (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = String(req.query.status ?? 'all');
    const rows = all(db, `SELECT p.*, c.name AS category_name, b.name AS brand_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id ORDER BY p.code`)
      .filter((p) => status === 'all' || (status === 'active' ? p.active === 1 : p.active === 0))
      .filter((p) => !req.query.category_id || p.category_id === req.query.category_id)
      .filter((p) => !search || p.code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search)
        || (p.barcode ?? '').includes(search) || (p.name_ar ?? '').includes(search));
    const stock = stockByProduct(db, req.user.store_ids);
    res.json(rows.map((p) => adminProduct(p, stock.get(p.id) ?? {})));
  });

  r.get('/products/:id', (req, res) => {
    const p = get(db, `SELECT p.*, c.name AS category_name, b.name AS brand_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ?`, req.params.id);
    if (!p) fail(404, 'NOT_FOUND', 'Article introuvable');
    const ids = req.user.store_ids;
    res.json({
      product: adminProduct(p, stockByProduct(db, ids, p.id).get(p.id) ?? {}),
      moves: moveRows(db, { storeIds: ids, productId: p.id, limit: 100, offset: 0 }),
    });
  });

  r.post('/products', (req, res) => {
    const fields = productFields(db, req.body ?? {});
    const id = newId('p');
    run(db, `INSERT INTO products (id, code, barcode, name, name_ar, category_id, brand_id, price_ttc, cost_price, tva_rate, unit, image_url,
      stock_alert, expiry_date, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, fields.code, fields.barcode, fields.name, fields.name_ar, fields.category_id, fields.brand_id, fields.price_ttc, fields.cost_price,
    fields.tva_rate, fields.unit, fields.image_url, fields.stock_alert, fields.expiry_date, fields.active ? 1 : 0, stampNow());
    run(db, 'UPDATE products SET created_at = ? WHERE id = ?', nowIso(), id);
    res.status(201).json(adminProduct(get(db, 'SELECT * FROM products WHERE id = ?', id), {}));
  });

  r.put('/products/:id', (req, res) => {
    const current = get(db, 'SELECT * FROM products WHERE id = ?', req.params.id);
    if (!current) fail(404, 'NOT_FOUND', 'Article introuvable');
    const fields = productFields(db, { ...current, active: current.active === 1, ...req.body }, current.id);
    if (fields.unit === 'unit' && current.unit === 'kg') {
      const odd = get(db, 'SELECT 1 AS x FROM stock WHERE product_id = ? AND quantity % 1000 <> 0', current.id);
      if (odd) fail(422, 'UNIT_CHANGE_REFUSED', 'Le stock de cet article n’est pas en pièces entières : corrigez-le avant de changer l’unité');
    }
    run(db, `UPDATE products SET code = ?, barcode = ?, name = ?, name_ar = ?, category_id = ?, brand_id = ?, price_ttc = ?, cost_price = ?,
      tva_rate = ?, unit = ?, image_url = ?, stock_alert = ?, expiry_date = ?, active = ?, updated_at = ? WHERE id = ?`,
    fields.code, fields.barcode, fields.name, fields.name_ar, fields.category_id, fields.brand_id, fields.price_ttc, fields.cost_price,
    fields.tva_rate, fields.unit, fields.image_url, fields.stock_alert, fields.expiry_date, fields.active ? 1 : 0, stampNow(), current.id);
    const stock = stockByProduct(db, req.user.store_ids, current.id).get(current.id) ?? {};
    res.json(adminProduct(get(db, 'SELECT * FROM products WHERE id = ?', current.id), stock));
  });

  for (const [path, table, prefix, label] of [['categories', 'categories', 'cat', 'Catégorie'], ['brands', 'brands', 'br', 'Marque']]) {
    const withAr = table === 'categories';
    const fieldsOf = (b) => {
      const name = clean(b.name, 80);
      if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
      return { name, name_ar: withAr ? clean(b.name_ar, 80) : undefined };
    };
    r.get(`/${path}`, (_req, res) => {
      const column = table === 'categories' ? 'category_id' : 'brand_id';
      res.json(all(db, `SELECT t.*, (SELECT COUNT(*) FROM products p WHERE p.${column} = t.id) AS product_count FROM ${table} t ORDER BY t.name`));
    });
    r.post(`/${path}`, (req, res) => {
      const f = fieldsOf(req.body ?? {});
      const id = newId(prefix);
      if (withAr) run(db, 'INSERT INTO categories (id, name, name_ar) VALUES (?, ?, ?)', id, f.name, f.name_ar);
      else run(db, 'INSERT INTO brands (id, name) VALUES (?, ?)', id, f.name);
      res.status(201).json(get(db, `SELECT * FROM ${table} WHERE id = ?`, id));
    });
    r.put(`/${path}/:id`, (req, res) => {
      if (!get(db, `SELECT id FROM ${table} WHERE id = ?`, req.params.id)) fail(404, 'NOT_FOUND', `${label} introuvable`);
      const f = fieldsOf(req.body ?? {});
      tx(db, () => {
        if (withAr) run(db, 'UPDATE categories SET name = ?, name_ar = ? WHERE id = ?', f.name, f.name_ar, req.params.id);
        else run(db, 'UPDATE brands SET name = ? WHERE id = ?', f.name, req.params.id);
      });
      res.json(get(db, `SELECT * FROM ${table} WHERE id = ?`, req.params.id));
    });
    r.delete(`/${path}/:id`, (req, res) => {
      const column = table === 'categories' ? 'category_id' : 'brand_id';
      if (get(db, `SELECT 1 AS x FROM products WHERE ${column} = ?`, req.params.id)) {
        fail(409, 'IN_USE', `${label} utilisée par des articles : changez-les d’abord`);
      }
      run(db, `DELETE FROM ${table} WHERE id = ?`, req.params.id);
      res.status(204).end();
    });
  }

  // --- Stock ---------------------------------------------------------------------------------------------------

  r.get('/stock-moves', (req, res) => {
    const storeIds = storesOf(req);
    const { from, to } = req.query.from || req.query.to ? periodOf(req) : { from: null, to: null };
    const kind = req.query.kind ? String(req.query.kind) : null;
    res.json(moveRows(db, { storeIds, productId: req.query.product_id ? String(req.query.product_id) : null, kind, from, to, ...pageOf(req) }));
  });

  // Réception (+), ajustement (±, motif obligatoire) ou inventaire (quantité comptée) : toutes les lignes ou aucune.
  r.post('/stock-moves', (req, res) => {
    const b = req.body ?? {};
    if (!['receipt', 'adjustment', 'inventory'].includes(b.kind)) fail(400, 'INVALID_DATA', 'Type de mouvement invalide');
    requireStore(req, b.store_id);
    const note = clean(b.note);
    if (b.kind === 'adjustment' && !note) fail(400, 'NOTE_REQUIRED', 'Motif obligatoire pour un ajustement');
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 500) fail(400, 'INVALID_DATA', 'Lignes invalides');
    if (new Set(b.lines.map((l) => l?.product_id)).size !== b.lines.length) fail(400, 'INVALID_DATA', 'Un article apparaît deux fois');
    const at = nowIso();
    const result = tx(db, () => b.lines.map((l, index) => {
      const p = l && get(db, 'SELECT id, unit FROM products WHERE id = ?', l.product_id);
      if (!p) fail(422, 'PRODUCT_UNKNOWN', 'Article inconnu', { line_index: index });
      const q = l.quantity;
      const valid = b.kind === 'inventory' ? (q === 0 || (isQuantity(q) && fitsUnit(p.unit, q)))
        : b.kind === 'receipt' ? isQuantity(q) && fitsUnit(p.unit, q)
          : typeof q === 'number' && q !== 0 && isQuantity(Math.abs(q)) && fitsUnit(p.unit, Math.abs(q));
      if (!valid) fail(400, 'INVALID_QUANTITY', p.unit === 'unit' ? 'Quantité entière attendue' : 'Quantité invalide (3 décimales au plus)', { line_index: index });
      if (l.unit_cost !== undefined && l.unit_cost !== null && !isInt(l.unit_cost, 0, 1e9)) fail(400, 'INVALID_DATA', 'Prix d’achat invalide', { line_index: index });
      const current = get(db, 'SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?', p.id, b.store_id)?.quantity ?? 0;
      const delta = b.kind === 'inventory' ? toMilli(q) - current : toMilli(q);
      const left = moveStock(db, { productId: p.id, storeId: b.store_id, delta, kind: b.kind, note, userId: req.user.id, at }) ?? current;
      if (b.kind === 'receipt' && Number.isInteger(l.unit_cost)) run(db, 'UPDATE products SET cost_price = ? WHERE id = ?', l.unit_cost, p.id);
      return { product_id: p.id, delta: fromMilli(delta), stock: fromMilli(left) };
    }));
    res.status(201).json({ kind: b.kind, store_id: b.store_id, lines: result });
  });

  // --- Ventes et retours ---------------------------------------------------------------------------------------

  r.get('/sales', (req, res) => {
    const storeIds = storesOf(req);
    const where = [`s.store_id IN (${inList(storeIds)})`];
    const params = [...storeIds];
    // Ventes d'une session : toutes, quelle que soit la date ; sinon celles de la période.
    if (req.query.session_id) {
      where.push('s.session_id = ?');
      params.push(String(req.query.session_id));
    } else {
      const { from, to } = periodOf(req);
      where.push('s.created_at >= ?', 's.created_at < ?');
      params.push(from, to);
    }
    if (req.query.status === 'completed' || req.query.status === 'cancelled') { where.push('s.status = ?'); params.push(req.query.status); }
    if (req.query.due === '1') where.push(`s.status = 'completed' AND s.credit > 0`);
    if (req.query.warning === '1') where.push('(s.price_warning = 1 OR s.approval_warning = 1 OR s.session_closed = 1)');
    if (req.query.customer_id) { where.push('s.customer_id = ?'); params.push(String(req.query.customer_id)); }
    if (req.query.cashier_id) { where.push('s.cashier_id = ?'); params.push(String(req.query.cashier_id)); }
    const search = String(req.query.search ?? '').trim().toLowerCase();
    if (search) { where.push('(lower(s.number) LIKE ? OR lower(c.name) LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const sql = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${where.join(' AND ')}`;
    const sums = get(db, `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total_ttc END), 0) AS ttc,
      COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.credit END), 0) AS due ${sql}`, ...params);
    const { limit, offset } = pageOf(req);
    const rows = all(db, `SELECT s.*, c.name AS customer_name, u.name AS cashier_name, st.name AS store_name, rg.name AS register_name,
      (SELECT COALESCE(SUM(total_ttc), 0) FROM refunds rf WHERE rf.original_sale_id = s.id) AS refunded_ttc
      ${sql.replace('WHERE', 'LEFT JOIN users u ON u.id = s.cashier_id LEFT JOIN stores st ON st.id = s.store_id LEFT JOIN registers rg ON rg.id = s.register_id WHERE')}
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    res.json({
      total: sums.count,
      sums: { ttc: sums.ttc, paid: sums.ttc - sums.due, due: sums.due },
      rows: rows.map(saleRow),
    });
  });

  r.get('/sales/:id', (req, res) => {
    const row = get(db, 'SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!row || !req.user.store_ids.includes(row.store_id)) fail(404, 'NOT_FOUND', 'Vente introuvable');
    const name = (id) => (id ? get(db, 'SELECT name FROM users WHERE id = ?', id)?.name ?? id : null);
    const sale = parseDoc(row);
    res.json({
      sale,
      store: get(db, 'SELECT id, name, address, ice FROM stores WHERE id = ?', row.store_id) ?? null,
      register: get(db, 'SELECT id, name FROM registers WHERE id = ?', row.register_id) ?? null,
      customer: row.customer_id ? get(db, 'SELECT id, name, phone, matricule FROM customers WHERE id = ?', row.customer_id) ?? null : null,
      cashier_name: name(row.cashier_id),
      approved_by_name: name(sale.approved_by),
      cancelled_at: row.cancelled_at,
      cancelled_by_name: name(row.cancelled_by),
      received_at: row.received_at,
      warnings: { price: row.price_warning === 1, approval: row.approval_warning === 1, session_closed: row.session_closed === 1 },
      refunds: all(db, 'SELECT doc FROM refunds WHERE original_sale_id = ? ORDER BY created_at', row.id).map(parseDoc),
    });
  });

  r.get('/refunds', (req, res) => {
    const storeIds = storesOf(req);
    const { from, to } = periodOf(req);
    const { limit, offset } = pageOf(req);
    const params = [...storeIds, from, to];
    const where = `r.store_id IN (${inList(storeIds)}) AND r.created_at >= ? AND r.created_at < ?`;
    const sums = get(db, `SELECT COUNT(*) AS count, COALESCE(SUM(total_ttc), 0) AS ttc FROM refunds r WHERE ${where}`, ...params);
    const rows = all(db, `SELECT r.*, s.number AS sale_number, c.name AS customer_name, st.name AS store_name FROM refunds r
      JOIN sales s ON s.id = r.original_sale_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN stores st ON st.id = r.store_id
      WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    const name = (id) => (id ? get(db, 'SELECT name FROM users WHERE id = ?', id)?.name ?? id : null);
    res.json({
      total: sums.count,
      sums: { ttc: sums.ttc },
      rows: rows.map((x) => {
        const doc = parseDoc(x);
        return {
          id: x.id, number: x.number, created_at: x.created_at, store_id: x.store_id, store_name: x.store_name, sale_id: x.original_sale_id,
          sale_number: x.sale_number, customer_name: x.customer_name, cashier_name: name(doc.cashier_id), reason: doc.reason,
          reason_text: doc.reason_text ?? null, total_ttc: x.total_ttc, payments: doc.payments, approval_warning: x.approval_warning === 1,
        };
      }),
    });
  });

  // --- Sessions de caisse --------------------------------------------------------------------------------------

  r.get('/cash-sessions', (req, res) => {
    const storeIds = storesOf(req);
    const { from, to } = periodOf(req);
    const params = [...storeIds, from, to];
    let where = `cs.store_id IN (${inList(storeIds)}) AND cs.opened_at >= ? AND cs.opened_at < ?`;
    if (req.query.status === 'open' || req.query.status === 'closed') { where += ' AND cs.status = ?'; params.push(req.query.status); }
    const { limit, offset } = pageOf(req);
    const rows = all(db, `SELECT cs.*, uo.name AS opened_by_name, uc.name AS closed_by_name, rg.name AS register_name, st.name AS store_name
      FROM cash_sessions cs LEFT JOIN users uo ON uo.id = cs.opened_by LEFT JOIN users uc ON uc.id = cs.closed_by
      LEFT JOIN registers rg ON rg.id = cs.register_id LEFT JOIN stores st ON st.id = cs.store_id
      WHERE ${where} ORDER BY cs.opened_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    res.json(rows.map((s) => sessionRow(db, s)));
  });

  r.get('/cash-sessions/:id', (req, res) => {
    const s = get(db, `SELECT cs.*, uo.name AS opened_by_name, uc.name AS closed_by_name, rg.name AS register_name, st.name AS store_name
      FROM cash_sessions cs LEFT JOIN users uo ON uo.id = cs.opened_by LEFT JOIN users uc ON uc.id = cs.closed_by
      LEFT JOIN registers rg ON rg.id = cs.register_id LEFT JOIN stores st ON st.id = cs.store_id WHERE cs.id = ?`, req.params.id);
    if (!s || !req.user.store_ids.includes(s.store_id)) fail(404, 'NOT_FOUND', 'Session introuvable');
    const sales = all(db, `SELECT status, total_ttc FROM sales WHERE session_id = ?`, s.id);
    const done = sales.filter((x) => x.status === 'completed');
    res.json({
      ...sessionRow(db, s),
      movements: all(db, `SELECT m.*, u.name AS created_by_name FROM cash_movements m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.session_id = ? ORDER BY m.created_at`, s.id).map((m) => ({ ...m, session_closed: m.session_closed === 1, approval_warning: m.approval_warning === 1 })),
      sales: { count: done.length, ttc: done.reduce((n, x) => n + x.total_ttc, 0), cancelled: sales.length - done.length },
      refunds: get(db, 'SELECT COUNT(*) AS count, COALESCE(SUM(total_ttc), 0) AS ttc FROM refunds WHERE session_id = ?', s.id),
    });
  });

  // Clôture depuis le back-office (§8 point 7) : poste en panne ou effacé. Rien n'est compté : la session est marquée forcée.
  r.post('/cash-sessions/:id/force-close', (req, res) => {
    const s = get(db, 'SELECT * FROM cash_sessions WHERE id = ?', req.params.id);
    if (!s || !req.user.store_ids.includes(s.store_id)) fail(404, 'NOT_FOUND', 'Session introuvable');
    if (s.status === 'closed') fail(409, 'SESSION_CLOSED', 'Session déjà clôturée');
    const note = clean(req.body?.note);
    if (!note) fail(400, 'NOTE_REQUIRED', 'Indiquez pourquoi la session est clôturée depuis le back-office');
    run(db, `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, closing_note = ?, forced = 1, api_expected = ? WHERE id = ?`,
      req.user.id, nowIso(), note, JSON.stringify(expectedByMethod(db, s)), s.id);
    res.json(sessionRow(db, get(db, 'SELECT * FROM cash_sessions WHERE id = ?', s.id)));
  });

  // --- Clients et règlements -----------------------------------------------------------------------------------

  r.get('/customers', (req, res) => {
    res.json(customerRows(db, { search: String(req.query.search ?? ''), due: req.query.due === '1' }));
  });

  r.get('/customers/:id', (req, res) => {
    const c = get(db, 'SELECT * FROM customers WHERE id = ?', req.params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Client introuvable');
    res.json({
      customer: c,
      balance: customerBalance(db, c.id),
      sales: all(db, `SELECT s.*, st.name AS store_name, u.name AS cashier_name,
        (SELECT COALESCE(SUM(total_ttc), 0) FROM refunds rf WHERE rf.original_sale_id = s.id) AS refunded_ttc
        FROM sales s LEFT JOIN stores st ON st.id = s.store_id LEFT JOIN users u ON u.id = s.cashier_id
        WHERE s.customer_id = ? ORDER BY s.created_at DESC LIMIT 200`, c.id).map(saleRow),
      refunds: all(db, 'SELECT id, number, created_at, total_ttc, credit, original_sale_id FROM refunds WHERE customer_id = ? ORDER BY created_at DESC', c.id),
      payments: all(db, `SELECT p.*, u.name AS user_name, st.name AS store_name FROM customer_payments p LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN stores st ON st.id = p.store_id WHERE p.customer_id = ? ORDER BY p.created_at DESC`, c.id),
    });
  });

  r.post('/customers', (req, res) => {
    const f = customerFields(req.body ?? {});
    matriculeFree(db, f.matricule);
    const id = randomUUID();
    const now = nowIso();
    run(db, 'INSERT INTO customers (id, name, phone, matricule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, f.name, f.phone, f.matricule, now, now);
    res.status(201).json(get(db, 'SELECT * FROM customers WHERE id = ?', id));
  });

  r.put('/customers/:id', (req, res) => {
    if (!get(db, 'SELECT id FROM customers WHERE id = ?', req.params.id)) fail(404, 'NOT_FOUND', 'Client introuvable');
    const f = customerFields(req.body ?? {});
    matriculeFree(db, f.matricule, req.params.id);
    run(db, 'UPDATE customers SET name = ?, phone = ?, matricule = ?, updated_at = ? WHERE id = ?', f.name, f.phone, f.matricule, nowIso(), req.params.id);
    res.json(get(db, 'SELECT * FROM customers WHERE id = ?', req.params.id));
  });

  // Règlement d'une dette (ventes à crédit) : idempotent par id, jamais plus que le reste dû.
  r.post('/customers/:id/payments', (req, res) => {
    const c = get(db, 'SELECT id FROM customers WHERE id = ?', req.params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Client introuvable');
    const b = req.body ?? {};
    const id = b.id ?? randomUUID();
    if (!isUuid(id)) fail(400, 'INVALID_DATA', 'id invalide');
    const known = get(db, 'SELECT * FROM customer_payments WHERE id = ?', id);
    if (known) return res.json({ payment: known, balance: customerBalance(db, c.id), status: 'duplicate' });
    if (!['cash', 'card', 'mobile'].includes(b.method) || !isInt(b.amount, 1, 1e10)) fail(400, 'INVALID_DATA', 'Moyen de paiement ou montant invalide');
    requireStore(req, b.store_id);
    const balance = customerBalance(db, c.id);
    if (b.amount > balance) fail(422, 'PAYMENT_EXCEEDS_BALANCE', 'Le règlement dépasse le reste dû', { balance });
    run(db, 'INSERT INTO customer_payments (id, customer_id, store_id, method, amount, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, c.id, b.store_id, b.method, b.amount, clean(b.note), req.user.id, nowIso());
    res.status(201).json({ payment: get(db, 'SELECT * FROM customer_payments WHERE id = ?', id), balance: customerBalance(db, c.id), status: 'created' });
  });

  // --- Fournisseurs, factures d'achat, dépenses (routes/purchases.js) -------------------------------------------

  purchaseRoutes(r, db);

  // --- Utilisateurs (administrateur) ---------------------------------------------------------------------------

  r.get('/users', (req, res) => {
    adminOnly(req);
    res.json(all(db, 'SELECT * FROM users ORDER BY active DESC, name').map((u) => userRow(db, u)));
  });

  r.post('/users', (req, res) => {
    adminOnly(req);
    const b = req.body ?? {};
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) fail(400, 'INVALID_USERNAME', 'Identifiant : 3 à 40 lettres, chiffres, point, tiret');
    if (get(db, 'SELECT id FROM users WHERE username = ?', username)) fail(409, 'USERNAME_TAKEN', 'Identifiant déjà utilisé');
    const fields = userFields(db, b, null, pinIterations);
    const problem = passwordProblem(b.password);
    if (problem) fail(400, 'WEAK_PASSWORD', problem);
    const id = newId('u');
    tx(db, () => {
      run(db, 'INSERT INTO users (id, username, name, role, password_hash, pin_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, username, fields.name, fields.role, hashPassword(b.password), fields.pin_hash ?? null, fields.active ? 1 : 0, nowIso());
      for (const st of fields.store_ids) run(db, 'INSERT INTO user_stores (user_id, store_id) VALUES (?, ?)', id, st);
    });
    res.status(201).json(userRow(db, get(db, 'SELECT * FROM users WHERE id = ?', id)));
  });

  r.put('/users/:id', (req, res) => {
    adminOnly(req);
    const u = get(db, 'SELECT * FROM users WHERE id = ?', req.params.id);
    if (!u) fail(404, 'NOT_FOUND', 'Utilisateur introuvable');
    const b = req.body ?? {};
    if (u.id === req.user.id && ((b.role !== undefined && b.role !== 'admin') || (b.active !== undefined && !bool(b.active)))) {
      fail(422, 'SELF_LOCKOUT', 'Vous ne pouvez pas retirer vos propres droits');
    }
    const currentStores = all(db, 'SELECT store_id FROM user_stores WHERE user_id = ?', u.id).map((x) => x.store_id);
    const fields = userFields(db, { name: u.name, role: u.role, active: u.active === 1, store_ids: currentStores, ...b }, u, pinIterations);
    let passwordHash = null;
    if (b.password !== undefined) {
      const problem = passwordProblem(b.password);
      if (problem) fail(400, 'WEAK_PASSWORD', problem);
      passwordHash = hashPassword(b.password);
    }
    tx(db, () => {
      run(db, 'UPDATE users SET name = ?, role = ?, active = ?, pin_hash = ? WHERE id = ?', fields.name, fields.role, fields.active ? 1 : 0,
        fields.pin_hash === undefined ? u.pin_hash : fields.pin_hash, u.id);
      if (passwordHash) run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, u.id);
      run(db, 'DELETE FROM user_stores WHERE user_id = ?', u.id);
      for (const st of fields.store_ids) run(db, 'INSERT INTO user_stores (user_id, store_id) VALUES (?, ?)', u.id, st);
      // Mot de passe changé ou compte désactivé : ses connexions en cours sont coupées (sauf la sienne).
      if (passwordHash || !fields.active) run(db, 'DELETE FROM auth_tokens WHERE user_id = ? AND token_hash <> ?', u.id, req.user.token_hash);
    });
    res.json(userRow(db, get(db, 'SELECT * FROM users WHERE id = ?', u.id)));
  });

  // --- Magasins, caisses, balance (administrateur pour les modifications) --------------------------------------

  r.get('/stores', (req, res) => {
    const ids = req.user.role === 'admin' ? all(db, 'SELECT id FROM stores').map((s) => s.id) : req.user.store_ids;
    res.json(storeList(db, ids, true));
  });

  r.post('/stores', (req, res) => {
    adminOnly(req);
    const f = storeFields(req.body ?? {});
    const id = newId('st');
    tx(db, () => {
      run(db, `INSERT INTO stores (id, name, closing_difference_threshold, cashier_max_discount_percent, cashier_max_discount, address, ice, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, f.name, f.closing_difference_threshold, f.cashier_max_discount_percent, f.cashier_max_discount,
      f.address, f.ice, f.active ? 1 : 0);
      run(db, 'INSERT INTO registers (id, store_id, name) VALUES (?, ?, ?)', newId('reg'), id, 'Caisse 1');
    });
    res.status(201).json(storeList(db, [id], true)[0]);
  });

  r.put('/stores/:id', (req, res) => {
    adminOnly(req);
    const s = get(db, 'SELECT * FROM stores WHERE id = ?', req.params.id);
    if (!s) fail(404, 'NOT_FOUND', 'Magasin introuvable');
    const f = storeFields({ ...s, active: s.active === 1, ...req.body });
    run(db, `UPDATE stores SET name = ?, closing_difference_threshold = ?, cashier_max_discount_percent = ?, cashier_max_discount = ?, address = ?,
      ice = ?, active = ? WHERE id = ?`, f.name, f.closing_difference_threshold, f.cashier_max_discount_percent, f.cashier_max_discount, f.address,
    f.ice, f.active ? 1 : 0, s.id);
    res.json(storeList(db, [s.id], true)[0]);
  });

  r.post('/stores/:id/registers', (req, res) => {
    adminOnly(req);
    if (!get(db, 'SELECT id FROM stores WHERE id = ?', req.params.id)) fail(404, 'NOT_FOUND', 'Magasin introuvable');
    const name = clean(req.body?.name, 60);
    if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
    const id = newId('reg');
    run(db, 'INSERT INTO registers (id, store_id, name) VALUES (?, ?, ?)', id, req.params.id, name);
    res.status(201).json(get(db, 'SELECT * FROM registers WHERE id = ?', id));
  });

  r.put('/registers/:id', (req, res) => {
    adminOnly(req);
    const reg = get(db, 'SELECT * FROM registers WHERE id = ?', req.params.id);
    if (!reg) fail(404, 'NOT_FOUND', 'Caisse introuvable');
    const name = req.body?.name === undefined ? reg.name : clean(req.body.name, 60);
    if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
    const active = req.body?.active === undefined ? reg.active === 1 : bool(req.body.active);
    if (!active && get(db, `SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'open'`, reg.id)) {
      fail(422, 'SESSION_OPEN', 'Une session est ouverte sur cette caisse : clôturez-la d’abord');
    }
    run(db, 'UPDATE registers SET name = ?, active = ? WHERE id = ?', name, active ? 1 : 0, reg.id);
    res.json(get(db, 'SELECT * FROM registers WHERE id = ?', reg.id));
  });

  r.put('/stores/:id/barcode-rules', (req, res) => {
    adminOnly(req);
    if (!get(db, 'SELECT id FROM stores WHERE id = ?', req.params.id)) fail(404, 'NOT_FOUND', 'Magasin introuvable');
    const rules = barcodeRules(req.body?.rules);
    tx(db, () => {
      run(db, 'DELETE FROM barcode_rules WHERE store_id = ?', req.params.id);
      for (const x of rules) {
        run(db, 'INSERT INTO barcode_rules (store_id, prefix, type, integer_digits, decimal_digits) VALUES (?, ?, ?, ?, ?)',
          req.params.id, x.prefix, x.type, x.integer_digits, x.decimal_digits);
      }
    });
    res.json({ rules });
  });

  // --- Réglages ------------------------------------------------------------------------------------------------

  r.get('/settings', (_req, res) => res.json({ tva_rates: tvaRates(db), timezone: timezoneOf(db) }));

  r.put('/settings', (req, res) => {
    adminOnly(req);
    const b = req.body ?? {};
    if (b.tva_rates !== undefined) {
      const rates = b.tva_rates;
      if (!Array.isArray(rates) || rates.length === 0 || rates.length > 10 || !rates.every((x) => isInt(x, 0, 100)) || new Set(rates).size !== rates.length) {
        fail(400, 'INVALID_DATA', 'Taux de TVA invalides (entiers de 0 à 100, sans doublon)');
      }
      const used = all(db, 'SELECT DISTINCT tva_rate FROM products').map((x) => x.tva_rate).filter((x) => !rates.includes(x));
      if (used.length) fail(422, 'RATE_IN_USE', `Taux encore utilisé par des articles : ${used.join(', ')} %`, { rates: used });
      setSetting(db, 'tva_rates', [...rates].sort((a, c) => c - a));
    }
    if (b.timezone !== undefined) {
      try { new Intl.DateTimeFormat('fr', { timeZone: String(b.timezone) }); } catch { fail(400, 'INVALID_DATA', 'Fuseau horaire inconnu'); }
      setSetting(db, 'timezone', String(b.timezone));
    }
    res.json({ tva_rates: tvaRates(db), timezone: timezoneOf(db) });
  });

  return r;
}

// --- Formes renvoyées et contrôles ---------------------------------------------------------------------------------

function storeList(db, ids, withDetails = false) {
  if (!ids.length) return [];
  return all(db, `SELECT * FROM stores WHERE id IN (${inList(ids)}) ORDER BY name`, ...ids).map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    ice: s.ice,
    active: s.active === 1,
    closing_difference_threshold: s.closing_difference_threshold,
    cashier_max_discount_percent: s.cashier_max_discount_percent,
    cashier_max_discount: s.cashier_max_discount,
    registers: all(db, `SELECT id, name, active FROM registers WHERE store_id = ? ${withDetails ? '' : 'AND active = 1'} ORDER BY name, id`, s.id)
      .map((x) => ({ ...x, active: x.active === 1 })),
    ...(withDetails ? { barcode_rules: all(db, 'SELECT prefix, type, integer_digits, decimal_digits FROM barcode_rules WHERE store_id = ? ORDER BY prefix', s.id) } : {}),
  }));
}

function userRow(db, u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role, active: u.active === 1, has_pin: Boolean(u.pin_hash), created_at: u.created_at,
    store_ids: all(db, 'SELECT store_id FROM user_stores WHERE user_id = ? ORDER BY store_id', u.id).map((x) => x.store_id),
  };
}

function stockByProduct(db, storeIds, productId = null) {
  const map = new Map();
  const rows = all(db, `SELECT product_id, store_id, quantity FROM stock WHERE store_id IN (${inList(storeIds)})
    ${productId ? 'AND product_id = ?' : ''}`, ...storeIds, ...(productId ? [productId] : []));
  for (const x of rows) {
    if (!map.has(x.product_id)) map.set(x.product_id, {});
    map.get(x.product_id)[x.store_id] = fromMilli(x.quantity);
  }
  return map;
}

function adminProduct(p, stockByStore) {
  const { stock: _ignored, ...base } = publicProduct({ ...p, stock: 0 }); // eslint-disable-line no-unused-vars
  return {
    ...base,
    cost_price: p.cost_price,
    category_name: p.category_name ?? null,
    brand_name: p.brand_name ?? null,
    stock_by_store: stockByStore,
    stock_total: round3(Object.values(stockByStore).reduce((n, q) => n + q, 0)),
  };
}

/** Articles actifs sous leur seuil d'alerte, dans les magasins donnés (le plus bas d'abord). */
export function stockAlerts(db, storeIds) {
  return all(db, `SELECT p.id AS product_id, p.code, p.name, p.unit, p.stock_alert, st.id AS store_id, st.name AS store_name,
    COALESCE(s.quantity, 0) AS quantity FROM products p CROSS JOIN stores st
    LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = st.id
    WHERE p.active = 1 AND st.id IN (${inList(storeIds)}) AND COALESCE(s.quantity, 0) <= p.stock_alert * 1000
    ORDER BY COALESCE(s.quantity, 0) - p.stock_alert * 1000, p.code`, ...storeIds)
    .map(({ quantity, ...x }) => ({ ...x, stock: fromMilli(quantity) }));
}

function moveRows(db, { storeIds, productId = null, kind = null, from = null, to = null, limit, offset }) {
  const where = [`m.store_id IN (${inList(storeIds)})`];
  const params = [...storeIds];
  if (productId) { where.push('m.product_id = ?'); params.push(productId); }
  if (kind) { where.push('m.kind = ?'); params.push(kind); }
  if (from) { where.push('m.created_at >= ? AND m.created_at < ?'); params.push(from, to); }
  return all(db, `SELECT m.*, p.code, p.name, p.unit, u.name AS user_name, st.name AS store_name FROM stock_moves m
    LEFT JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN stores st ON st.id = m.store_id
    WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
    .map((m) => ({ ...m, delta: fromMilli(m.delta) }));
}

function saleRow(s) {
  const doc = parseDoc(s);
  return {
    id: s.id, number: s.number, created_at: s.created_at, store_id: s.store_id, store_name: s.store_name ?? null,
    register_id: s.register_id, register_name: s.register_name ?? null, session_id: s.session_id, cashier_id: s.cashier_id,
    cashier_name: s.cashier_name ?? null, customer_id: s.customer_id, customer_name: s.customer_name ?? null, status: s.status,
    items: doc.lines.length, total_ttc: s.total_ttc, paid: s.total_ttc - s.credit, due: s.status === 'completed' ? s.credit : 0,
    refunded_ttc: s.refunded_ttc ?? 0, methods: [...new Set(doc.payments.map((p) => p.method))],
    warnings: { price: s.price_warning === 1, approval: s.approval_warning === 1, session_closed: s.session_closed === 1 },
  };
}

function sessionRow(db, s) {
  const counts = s.counts ? JSON.parse(s.counts) : null;
  return {
    ...publicSession(s),
    store_name: s.store_name ?? null,
    register_name: s.register_name ?? null,
    opened_by_name: s.opened_by_name ?? null,
    closed_by_name: s.closed_by_name ?? null,
    forced: s.forced === 1,
    expected_mismatch: s.expected_mismatch === 1,
    approval_warning: s.approval_warning === 1,
    api_expected: s.status === 'open' ? expectedByMethod(db, s) : s.api_expected ? JSON.parse(s.api_expected) : null,
    difference: counts ? counts.reduce((n, c) => n + c.difference, 0) : null,
  };
}

/** Clients avec leur reste dû, leurs achats et leur dernier passage. */
export function customerRows(db, { search = '', due = false } = {}) {
  const q = search.trim().toLowerCase();
  const rows = all(db, `SELECT c.*,
    (SELECT COALESCE(SUM(credit), 0) FROM sales WHERE customer_id = c.id AND status = 'completed') AS sold_credit,
    (SELECT COALESCE(SUM(credit), 0) FROM refunds WHERE customer_id = c.id) AS refunded_credit,
    (SELECT COALESCE(SUM(amount), 0) FROM customer_payments WHERE customer_id = c.id) AS paid,
    (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed') AS sales_count,
    (SELECT COALESCE(SUM(total_ttc), 0) FROM sales WHERE customer_id = c.id AND status = 'completed') AS sales_ttc,
    (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_sale_at
    FROM customers c ORDER BY c.name`);
  return rows
    .map(({ sold_credit: sold, refunded_credit: refunded, paid, ...c }) => ({ ...c, balance: sold - refunded - paid }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.matricule ?? '').includes(q))
    .filter((c) => !due || c.balance > 0)
    .sort((a, b) => (due ? b.balance - a.balance : 0));
}

function matriculeFree(db, matricule, exceptId = '') {
  if (matricule && get(db, 'SELECT id FROM customers WHERE matricule = ? AND id <> ?', matricule, exceptId)) {
    fail(409, 'MATRICULE_TAKEN', 'Ce matricule est déjà celui d’un autre client');
  }
}

function productFields(db, b, exceptId = '') {
  const code = clean(b.code, 30);
  if (!code) fail(400, 'CODE_REQUIRED', 'Le code article est obligatoire');
  if (get(db, 'SELECT id FROM products WHERE code = ? AND id <> ?', code, exceptId)) fail(409, 'CODE_TAKEN', 'Code article déjà utilisé');
  const barcode = b.barcode === null || b.barcode === undefined || b.barcode === '' ? null : String(b.barcode).trim();
  if (barcode !== null && !/^\d{4,20}$/.test(barcode)) fail(400, 'INVALID_BARCODE', 'Code-barres : 4 à 20 chiffres');
  if (barcode && get(db, 'SELECT id FROM products WHERE barcode = ? AND id <> ?', barcode, exceptId)) fail(409, 'BARCODE_TAKEN', 'Code-barres déjà utilisé');
  const name = clean(b.name, 120);
  if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  const optRef = (v, table, label) => {
    if (v === null || v === undefined || v === '') return null;
    if (!isId(v) || !get(db, `SELECT id FROM ${table} WHERE id = ?`, v)) fail(422, 'UNKNOWN_REFERENCE', `${label} inconnue`);
    return v;
  };
  if (!isInt(b.price_ttc, 0, 1e9)) fail(400, 'INVALID_PRICE', 'Prix de vente invalide (centimes)');
  const cost = b.cost_price === null || b.cost_price === undefined || b.cost_price === '' ? null : b.cost_price;
  if (cost !== null && !isInt(cost, 0, 1e9)) fail(400, 'INVALID_PRICE', 'Prix d’achat invalide (centimes)');
  if (!tvaRates(db).includes(b.tva_rate)) fail(400, 'INVALID_TVA', 'Taux de TVA hors de la liste des réglages');
  if (!['unit', 'kg'].includes(b.unit)) fail(400, 'INVALID_UNIT', 'Unité : pièce ou kg');
  if (!isInt(b.stock_alert ?? 0, 0, 1e7)) fail(400, 'INVALID_DATA', 'Seuil d’alerte invalide');
  const expiry = b.expiry_date === null || b.expiry_date === undefined || b.expiry_date === '' ? null : b.expiry_date;
  if (expiry !== null && !isDay(expiry)) fail(400, 'INVALID_DATA', 'Date de péremption invalide');
  const image = b.image_url === null || b.image_url === undefined || b.image_url === '' ? null : String(b.image_url).trim();
  if (image !== null && (!/^https?:\/\/\S+$/.test(image) || image.length > 500)) fail(400, 'INVALID_DATA', 'Adresse d’image invalide');
  return {
    code, barcode, name, name_ar: clean(b.name_ar, 120), category_id: optRef(b.category_id, 'categories', 'Catégorie'),
    brand_id: optRef(b.brand_id, 'brands', 'Marque'), price_ttc: b.price_ttc, cost_price: cost, tva_rate: b.tva_rate, unit: b.unit,
    image_url: image, stock_alert: b.stock_alert ?? 0, expiry_date: expiry, active: b.active === undefined ? true : bool(b.active),
  };
}

function userFields(db, b, current, pinIterations) {
  const name = clean(b.name, 80);
  if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  if (!['admin', 'manager', 'cashier'].includes(b.role)) fail(400, 'INVALID_ROLE', 'Rôle invalide');
  const storeIds = Array.isArray(b.store_ids) ? [...new Set(b.store_ids)] : null;
  if (!storeIds || !storeIds.every((id) => get(db, 'SELECT id FROM stores WHERE id = ?', id))) fail(422, 'UNKNOWN_REFERENCE', 'Magasin inconnu');
  if (b.role !== 'admin' && storeIds.length === 0) fail(422, 'STORE_REQUIRED', 'Rattachez cet utilisateur à au moins un magasin');
  const active = b.active === undefined ? true : bool(b.active);
  // Il reste toujours un administrateur actif.
  if (current?.id && current.role === 'admin' && current.active === 1 && (b.role !== 'admin' || !active)) {
    const others = get(db, `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?`, current.id).n;
    if (others === 0) fail(422, 'LAST_ADMIN', 'Il faut garder au moins un administrateur actif');
  }
  // PIN (§11) : 6 chiffres, seulement pour un responsable ; null le retire ; absent = inchangé.
  let pinHash;
  if (b.pin === null) pinHash = null;
  else if (b.pin !== undefined) {
    const problem = pinProblem(b.pin);
    if (problem) fail(400, 'INVALID_PIN', problem);
    pinHash = JSON.stringify(hashPin(String(b.pin), pinIterations));
  }
  if (b.role === 'cashier') pinHash = null; // un caissier n'autorise rien
  return { name, role: b.role, store_ids: storeIds, active, pin_hash: pinHash };
}

function storeFields(b) {
  const name = clean(b.name, 80);
  if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  if (!isInt(b.closing_difference_threshold ?? 2000, 0, 1e8)) fail(400, 'INVALID_DATA', 'Seuil d’écart invalide (centimes)');
  const pct = b.cashier_max_discount_percent ?? null;
  const max = b.cashier_max_discount ?? null;
  if (pct !== null && !isInt(pct, 0, 100)) fail(400, 'INVALID_DATA', 'Remise maximale en % invalide');
  if (max !== null && !isInt(max, 0, 1e9)) fail(400, 'INVALID_DATA', 'Remise maximale en DH invalide (centimes)');
  const address = typeof b.address === 'string' ? b.address.trim().slice(0, 300) : '';
  const ice = typeof b.ice === 'string' ? b.ice.trim() : '';
  if (ice && !/^\d{15}$/.test(ice)) fail(400, 'INVALID_ICE', 'L’ICE compte 15 chiffres');
  return {
    name, closing_difference_threshold: b.closing_difference_threshold ?? 2000, cashier_max_discount_percent: pct, cashier_max_discount: max,
    address, ice, active: b.active === undefined ? true : bool(b.active),
  };
}

/** Règles de la balance (§3) : EAN-13, code article d'au moins 1 chiffre, aucun préfixe début d'un autre. */
export function barcodeRules(rules) {
  if (!Array.isArray(rules) || rules.length > 10) fail(400, 'INVALID_DATA', 'Règles invalides');
  const out = rules.map((x, i) => {
    const ok = x && /^\d{1,5}$/.test(x.prefix) && ['weight', 'price'].includes(x.type) && isInt(x.integer_digits, 0, 6)
      && isInt(x.decimal_digits, 0, x.type === 'weight' ? 3 : 2) && x.integer_digits + x.decimal_digits >= 1
      && 12 - x.prefix.length - x.integer_digits - x.decimal_digits >= 1;
    if (!ok) fail(400, 'INVALID_RULE', 'Règle de balance invalide', { index: i });
    return { prefix: x.prefix, type: x.type, integer_digits: x.integer_digits, decimal_digits: x.decimal_digits };
  });
  for (const a of out) {
    for (const b of out) {
      if (a !== b && b.prefix.startsWith(a.prefix)) fail(400, 'INVALID_RULE', `Le préfixe ${a.prefix} est le début de ${b.prefix}`);
    }
  }
  return out;
}
