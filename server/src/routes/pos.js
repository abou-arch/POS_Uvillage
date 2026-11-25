// Routes de la caisse, conformes à pos-caisse/docs/API_CONTRACT.md (contrat 0.7, plus 0.8 proposé) : catalogue, clients,
// règlements, ventes, retours, sessions de caisse, responsables, règles de la balance. Toutes demandent un token (voir app.js).
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { paidByLine, refundLine, saleTotals } from '../../../pos-caisse/src/lib/totals.js';
import {
  approvalWarning, customerBalance, isResponsible, moveStock, parseDoc, publicProduct, requireStore,
} from '../core.js';
import { all, get, nowIso, run, stampNow, toMilli, tx } from '../db.js';
import { nextProductCode, productFields } from './admin.js';
import { newId } from './common.js';
import {
  body, clean, creditOf, fail, fitsUnit, isDate, isId, isInt, isNote, isOptId, isQuantity, isText, isUuid, METHODS, REASONS,
  round3, sumOf,
} from '../validate.js';

const COUNTED_METHODS = ['cash', 'card', 'mobile', 'qr'];
// Une caisse pas encore mise à jour (ou une clôture en attente hors ligne) n'envoie pas de comptage QR.
const REQUIRED_COUNTS = ['cash', 'card', 'mobile']; // le crédit n'est pas de l'argent reçu (§9)

export function posRoutes(db) {
  const r = Router();

  // --- Catalogue (§3) ----------------------------------------------------------------------------------------

  r.get('/categories', (_req, res) => res.json(all(db, 'SELECT id, name, name_ar FROM categories ORDER BY name')));
  r.get('/brands', (_req, res) => res.json(all(db, 'SELECT id, name FROM brands ORDER BY name')));

  r.get('/products', (req, res) => {
    const storeId = String(req.query.store_id ?? '');
    if (!storeId) fail(400, 'STORE_REQUIRED', 'store_id est obligatoire');
    requireStore(req, storeId);
    const raw = req.query.updated_since ? String(req.query.updated_since) : null;
    if (raw && !isDate(raw)) fail(400, 'INVALID_DATA', 'updated_since invalide');
    const since = raw ? new Date(raw).toISOString() : null; // même format que updated_at : comparaison de textes juste
    const rows = all(db, `SELECT p.*, s.quantity AS stock FROM products p
      LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = ?
      WHERE (? IS NULL OR p.updated_at > ?) ORDER BY p.code`, storeId, since, since);
    res.json(rows.map(publicProduct));
  });

  // Nouvel article créé à la caisse (caissier compris) : même contrôle que le back-office, code IT suivant si absent.
  r.post('/products', (req, res) => {
    const b = req.body ?? {};
    const storeId = String(b.store_id ?? '');
    if (!storeId) fail(400, 'STORE_REQUIRED', 'store_id est obligatoire');
    requireStore(req, storeId);
    const fields = productFields(db, { ...b, code: b.code || nextProductCode(db) });
    const id = newId('p');
    run(db, `INSERT INTO products (id, code, barcode, name, name_ar, category_id, brand_id, price_ttc, cost_price, tva_rate, unit, image_url,
      stock_alert, expiry_date, active, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, fields.code, fields.barcode, fields.name, fields.name_ar, fields.category_id, fields.brand_id, fields.price_ttc, fields.cost_price,
    fields.tva_rate, fields.unit, fields.image_url, fields.stock_alert, fields.expiry_date, 1, stampNow(), nowIso());
    res.status(201).json(publicProduct({ ...get(db, 'SELECT * FROM products WHERE id = ?', id), stock: 0 }));
  });

  r.get('/stores/:id/approvers', (req, res) => {
    requireStore(req, req.params.id);
    const rows = all(db, `SELECT u.id, u.name, u.role, u.pin_hash FROM users u
      WHERE u.active = 1 AND u.pin_hash IS NOT NULL AND u.role IN ('admin', 'manager')
      AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM user_stores us WHERE us.user_id = u.id AND us.store_id = ?))
      ORDER BY u.name`, req.params.id);
    res.json({ approvers: rows.map((u) => ({ user_id: u.id, name: u.name, pin: JSON.parse(u.pin_hash) })) });
  });

  r.get('/stores/:id/barcode-rules', (req, res) => {
    requireStore(req, req.params.id);
    res.json({ rules: all(db, 'SELECT prefix, type, integer_digits, decimal_digits FROM barcode_rules WHERE store_id = ? ORDER BY prefix', req.params.id) });
  });

  // --- Clients (§4) ------------------------------------------------------------------------------------------

  // Recherche bornée (docs/SECURITE.md, proposition 7) : 2 caractères au moins, 20 résultats au plus.
  r.get('/customers', (req, res) => {
    const q = String(req.query.search ?? '').trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/\D/g, '');
    const local = /^0[5-7]/.test(digits) ? `212${digits.slice(1)}` : digits; // 06… retrouve +2126…
    const rows = all(db, `SELECT id, name, phone, matricule, discount_percent FROM customers
      WHERE lower(name) LIKE ? OR (? <> '' AND (replace(phone, '+', '') LIKE ? OR replace(phone, '+', '') LIKE ? OR matricule LIKE ?))
      ORDER BY name LIMIT 20`, like, digits, `%${digits}%`, `%${local}%`, `%${digits}%`);
    res.json(rows.map((c) => ({ ...c, balance: customerBalance(db, c.id) }))); // 0.8 : reste dû (§4)
  });

  r.post('/customers', (req, res) => {
    const b = req.body ?? {};
    if (b.id !== undefined && !isUuid(b.id)) fail(400, 'INVALID_DATA', 'id invalide');
    const known = b.id ? get(db, 'SELECT id, name, phone, matricule, discount_percent FROM customers WHERE id = ?', b.id) : null;
    if (known) return res.status(200).json({ ...known, balance: customerBalance(db, known.id) });
    const customer = customerFields(b);
    // Client spécial : seul un responsable (le propriétaire) fixe une remise.
    if (customer.discount_percent !== null && !isResponsible(req.user.role)) fail(403, 'FORBIDDEN', 'Seul un responsable crée un client spécial');
    const id = b.id ?? randomUUID();
    const now = nowIso();
    run(db, 'INSERT INTO customers (id, name, phone, matricule, discount_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, customer.name, customer.phone, customer.matricule, customer.discount_percent, now, now);
    res.status(201).json({ id, ...customer, balance: 0 });
  });

  // Règlement d'une dette à la caisse (0.8, §4) : idempotent par id ; compté dans les attendus de sa session (§9). Fait
  // hors ligne, il est accepté même si la session est clôturée ou s'il dépasse le reste dû : signalé au back-office.
  r.post('/customer-payments', (req, res) => {
    const b = req.body ?? {};
    const known = get(db, 'SELECT * FROM customer_payments WHERE id = ?', typeof b.id === 'string' ? b.id : '');
    if (known) {
      return res.json({ id: known.id, status: 'duplicate', balance: customerBalance(db, known.customer_id),
        session_closed: known.session_closed === 1, balance_exceeded: known.balance_exceeded === 1 });
    }
    if (!isUuid(b.id) || !isId(b.store_id) || !isId(b.register_id) || !isId(b.session_id) || !isId(b.customer_id)
      || !COUNTED_METHODS.includes(b.method) || !isInt(b.amount, 1, 1e10) || !isNote(b.note) || !isId(b.created_by) || !isDate(b.created_at)) {
      fail(400, 'INVALID_DATA', 'Règlement invalide');
    }
    requireStore(req, b.store_id);
    if (!get(db, 'SELECT 1 AS x FROM customers WHERE id = ?', b.customer_id)) fail(404, 'NOT_FOUND', 'Client introuvable');
    const { session, refused } = sessionOf(b);
    if (!session) return res.status(refused.status).json(refused.body);
    const sessionClosed = session.status === 'closed' ? 1 : 0;
    const exceeded = b.amount > customerBalance(db, b.customer_id) ? 1 : 0;
    run(db, `INSERT INTO customer_payments (id, customer_id, store_id, register_id, session_id, method, amount, note, user_id, created_at,
      session_closed, balance_exceeded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.id, b.customer_id, b.store_id, b.register_id, b.session_id, b.method, b.amount, clean(b.note), b.created_by, b.created_at,
    sessionClosed, exceeded);
    res.status(201).json({ id: b.id, status: 'created', balance: customerBalance(db, b.customer_id),
      session_closed: sessionClosed === 1, balance_exceeded: exceeded === 1 });
  });

  // --- Ventes (§5) -------------------------------------------------------------------------------------------

  /** §5 et §10 : la session ouverte de sa caisse. Une session clôturée n'empêche pas l'enregistrement. */
  function sessionOf(doc) {
    const session = get(db, 'SELECT * FROM cash_sessions WHERE id = ?', doc.session_id);
    if (!session) return { refused: body(422, 'SESSION_UNKNOWN', 'Session de caisse inconnue') };
    if (session.store_id !== doc.store_id || session.register_id !== doc.register_id) {
      return { refused: body(422, 'SESSION_MISMATCH', 'Session d’un autre magasin ou d’une autre caisse') };
    }
    return { session };
  }

  const validLine = (l) => l && isId(l.product_id) && isText(l.name) && isQuantity(l.quantity) && fitsUnit(l.unit, l.quantity)
    && isInt(l.unit_price_ttc, 0, 1e9) && isInt(l.discount, 0) && isInt(l.tva_rate, 0, 100)
    && ['total_ht', 'total_tva', 'total_ttc'].every((k) => isInt(l[k], 0)) && (l.id === undefined || isUuid(l.id));

  function validSale(s) {
    return isUuid(s.id) && isId(s.number) && isId(s.store_id) && isId(s.register_id) && isId(s.session_id) && isId(s.cashier_id)
      && isOptId(s.approved_by) && (s.customer_id === null || isId(s.customer_id)) && isDate(s.created_at)
      && Array.isArray(s.lines) && s.lines.length > 0 && s.lines.length <= 500 && s.lines.every(validLine)
      && isInt(s.other_charges, 0) && isInt(s.global_discount, 0)
      && s.totals && ['ht', 'tva', 'ttc'].every((k) => isInt(s.totals[k], 0))
      && Array.isArray(s.payments) && s.payments.every((p) => p && METHODS.includes(p.method) && isInt(p.amount, 1))
      && isInt(s.amount_received, 0) && isInt(s.change_given, 0) && typeof s.send_sms === 'boolean'
      && (s.status === undefined || s.status === 'completed');
  }

  /** Une vente (création idempotente). Renvoie { status, body } au format du contrat. */
  function createSale(req, s) {
    const known = get(db, 'SELECT session_closed FROM sales WHERE id = ?', s?.id ?? '');
    if (known) return { status: 200, body: { id: s.id, status: 'duplicate', stock_warning: false, session_closed: known.session_closed === 1 } };
    if (!validSale(s)) {
      const badLine = Array.isArray(s?.lines) ? s.lines.findIndex((l) => !validLine(l)) : -1;
      return body(400, 'INVALID_DATA', badLine >= 0 ? 'Ligne de vente invalide' : 'Vente invalide', badLine >= 0 ? { line_index: badLine } : {});
    }
    if (!req.user.store_ids.includes(s.store_id)) return body(403, 'FORBIDDEN', 'Magasin non autorisé');
    const { session, refused } = sessionOf(s);
    if (!session) return refused;
    const expected = saleTotals(s.lines, s.other_charges, s.global_discount);
    if (!['ht', 'tva', 'ttc'].every((k) => Math.abs(expected[k] - s.totals[k]) <= 1)) {
      return body(422, 'TOTALS_MISMATCH', 'Totaux incohérents', { expected });
    }
    const paid = sumOf(s.payments, (p) => p.amount);
    const credit = paid < s.totals.ttc || s.payments.some((p) => p.method === 'credit');
    if (paid > s.totals.ttc || (credit && !s.customer_id)) return body(422, 'PAYMENTS_MISMATCH', 'Paiements incohérents', { paid });
    // Prix contrôlés (proposition 2) : un prix différent du catalogue est accepté (prix changé pendant une coupure,
    // vente en attente) mais signalé au back-office.
    const priceWarning = s.lines.some((l) => {
      const p = get(db, 'SELECT price_ttc FROM products WHERE id = ?', l.product_id);
      return !p || p.price_ttc !== l.unit_price_ttc;
    }) ? 1 : 0;
    const sessionClosed = session.status === 'closed' ? 1 : 0;
    let stockWarning = false;
    tx(db, () => {
      // Le reste dû du client = paiements à crédit + ce qui n'est pas payé.
      const due = creditOf(s.payments) + (s.totals.ttc - paid);
      run(db, `INSERT INTO sales (id, number, store_id, register_id, session_id, cashier_id, customer_id, created_at, status,
        total_ttc, credit, doc, session_closed, approval_warning, price_warning, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.number, s.store_id, s.register_id, s.session_id, s.cashier_id, s.customer_id, s.created_at, s.totals.ttc, due,
      JSON.stringify({ ...s, status: 'completed' }), sessionClosed, approvalWarning(db, s.approved_by, s.store_id), priceWarning, nowIso());
      for (const l of s.lines) {
        const left = moveStock(db, { productId: l.product_id, storeId: s.store_id, delta: -toMilli(l.quantity), kind: 'sale', refId: s.id, userId: s.cashier_id });
        if (left !== null && left < 0) stockWarning = true;
      }
    });
    return { status: 201, body: { id: s.id, status: 'created', stock_warning: stockWarning, session_closed: sessionClosed === 1 } };
  }

  r.post('/sales', (req, res) => {
    const { status, body: b } = createSale(req, req.body);
    res.status(status).json(b);
  });

  r.post('/sales/batch', (req, res) => {
    const list = req.body?.sales;
    if (!Array.isArray(list) || list.length > 200) fail(400, 'INVALID_DATA', 'Lot de ventes invalide (200 au plus)');
    const results = list.map((s) => {
      const { status, body: b } = createSale(req, s ?? {});
      return status >= 400 ? { id: s?.id, status: 'error', error: b.error } : b;
    });
    res.json({ results });
  });

  // Annulation (§5) : un responsable, ou un caissier avec l'accord d'un responsable du magasin (approved_by, 0.8, §11).
  r.post('/sales/:id/cancel', (req, res) => {
    const approvedBy = req.body?.approved_by ?? null;
    if (!isOptId(approvedBy)) fail(400, 'INVALID_DATA', 'approved_by invalide');
    const row = get(db, 'SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!row || !req.user.store_ids.includes(row.store_id)) fail(404, 'NOT_FOUND', 'Vente introuvable');
    if (!isResponsible(req.user.role) && (approvedBy === null || approvalWarning(db, approvedBy, row.store_id) !== 0)) {
      fail(403, 'FORBIDDEN', 'Annulation réservée à un responsable du magasin');
    }
    if (row.status === 'cancelled') return res.json({ id: row.id, status: 'cancelled' });
    if (get(db, 'SELECT 1 AS x FROM refunds WHERE original_sale_id = ?', row.id)) {
      fail(422, 'SALE_REFUNDED', 'Cette vente a déjà des retours : elle ne peut plus être annulée');
    }
    const sale = parseDoc(row);
    tx(db, () => {
      run(db, `UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_approved_by = ?, doc = ? WHERE id = ?`,
        nowIso(), req.user.id, approvedBy, JSON.stringify({ ...sale, status: 'cancelled' }), row.id);
      for (const l of sale.lines) moveStock(db, { productId: l.product_id, storeId: row.store_id, delta: toMilli(l.quantity), kind: 'cancel', refId: row.id, userId: req.user.id });
    });
    res.json({ id: row.id, status: 'cancelled' });
  });

  r.get('/sales/by-number/:number', (req, res) => {
    const row = all(db, 'SELECT * FROM sales WHERE number = ? ORDER BY received_at', req.params.number)
      .find((s) => req.user.store_ids.includes(s.store_id));
    if (!row) fail(404, 'NOT_FOUND', 'Vente introuvable');
    const customer = row.customer_id ? get(db, 'SELECT id, name FROM customers WHERE id = ?', row.customer_id) : null;
    res.json({
      sale: parseDoc(row),
      customer: customer ?? null,
      refunds: all(db, 'SELECT doc FROM refunds WHERE original_sale_id = ? ORDER BY created_at', row.id).map(parseDoc),
    });
  });

  // --- Retours (§10) -----------------------------------------------------------------------------------------

  const validRefund = (b) => isUuid(b.id) && isId(b.number) && isId(b.store_id) && isId(b.register_id) && isId(b.session_id)
    && isId(b.original_sale_id) && isId(b.cashier_id) && isOptId(b.approved_by)
    && (b.customer_id === null || isId(b.customer_id)) && isDate(b.created_at)
    && REASONS.includes(b.reason) && isNote(b.reason_text) && (b.reason !== 'other' || isText(b.reason_text))
    && Array.isArray(b.lines) && b.lines.length > 0
    && b.lines.every((l) => l && isInt(l.line_index, 0) && isQuantity(l.quantity) && fitsUnit(l.unit, l.quantity)
      && ['total_ht', 'total_tva', 'total_ttc'].every((k) => isInt(l[k], 0)))
    && new Set(b.lines.map((l) => l.line_index)).size === b.lines.length
    && b.totals && ['ht', 'tva', 'ttc'].every((k) => isInt(b.totals[k], 0))
    && Array.isArray(b.payments) && b.payments.length > 0 && b.payments.every((p) => p && METHODS.includes(p.method) && isInt(p.amount, 1))
    && sumOf(b.payments, (p) => p.amount) === b.totals.ttc;

  r.post('/refunds', (req, res) => {
    const b = req.body ?? {};
    const known = get(db, 'SELECT session_closed FROM refunds WHERE id = ?', b.id ?? '');
    if (known) return res.json({ id: b.id, status: 'duplicate', session_closed: known.session_closed === 1 });
    if (!validRefund(b)) fail(400, 'INVALID_DATA', 'Retour invalide');
    requireStore(req, b.store_id);
    const row = get(db, 'SELECT * FROM sales WHERE id = ?', b.original_sale_id);
    if (!row) fail(422, 'SALE_UNKNOWN', 'Vente d’origine inconnue');
    const sale = parseDoc(row);
    if (row.status === 'cancelled') fail(422, 'SALE_CANCELLED', 'Vente d’origine annulée');
    if (row.store_id !== b.store_id) fail(422, 'STORE_MISMATCH', 'Le retour se fait dans le magasin de la vente');
    const { session, refused } = sessionOf(b);
    if (!session) fail(refused.status, refused.body.error.code, refused.body.error.message);
    if (b.customer_id !== (sale.customer_id ?? null)) fail(422, 'CUSTOMER_MISMATCH', 'Le client n’est pas celui de la vente');

    // §7 : chaque ligne est recalculée à partir des retours déjà reçus, à 1 centime près ; jamais plus que son payé.
    const previous = all(db, 'SELECT doc FROM refunds WHERE original_sale_id = ?', sale.id).map(parseDoc);
    const paid = paidByLine(sale.lines, sale.other_charges, sale.global_discount);
    for (const l of b.lines) {
      const original = sale.lines[l.line_index];
      if (!original || (original.id ?? null) !== (l.original_line_id ?? null) || (original.unit ?? null) !== (l.unit ?? null)) {
        fail(422, 'LINE_MISMATCH', 'Ligne de vente introuvable', { line_index: l.line_index });
      }
      const before = previous.flatMap((x) => x.lines).filter((x) => x.line_index === l.line_index);
      const returned = round3(sumOf(before, (x) => x.quantity));
      const remaining = round3(original.quantity - returned);
      if (l.quantity > remaining) fail(422, 'RETURN_EXCEEDS', 'Plus que ce qui reste à retourner', { line_index: l.line_index, remaining });
      const expected = refundLine(paid[l.line_index], original.tva_rate, original.quantity, returned, l.quantity);
      const off = ['ht', 'tva', 'ttc'].some((k) => Math.abs(expected[k] - l[`total_${k}`]) > 1);
      if (off || sumOf(before, (x) => x.total_ttc) + l.total_ttc > paid[l.line_index]) {
        fail(422, 'TOTALS_MISMATCH', 'Montant remboursé incohérent', { line_index: l.line_index, expected });
      }
    }
    const lineSum = (k) => sumOf(b.lines, (l) => l[`total_${k}`]);
    if (['ht', 'tva', 'ttc'].some((k) => Math.abs(lineSum(k) - b.totals[k]) > 1)) fail(422, 'TOTALS_MISMATCH', 'Totaux incohérents');
    const creditLeft = creditOf(sale.payments) - sumOf(previous, (x) => creditOf(x.payments));
    if (creditOf(b.payments) > creditLeft) fail(422, 'CREDIT_EXCEEDED', 'Crédit remboursé supérieur au crédit de la vente', { available: creditLeft });

    const sessionClosed = session.status === 'closed' ? 1 : 0;
    tx(db, () => {
      run(db, `INSERT INTO refunds (id, number, original_sale_id, store_id, register_id, session_id, customer_id, created_at, total_ttc,
        credit, doc, session_closed, approval_warning, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id, b.number, b.original_sale_id, b.store_id, b.register_id, b.session_id, b.customer_id, b.created_at, b.totals.ttc,
      creditOf(b.payments), JSON.stringify(b), sessionClosed, approvalWarning(db, b.approved_by, b.store_id), nowIso());
      // §8 point 8 (à trancher) : tout article retourné revient en stock, même défectueux.
      for (const l of b.lines) {
        moveStock(db, { productId: sale.lines[l.line_index].product_id, storeId: b.store_id, delta: toMilli(l.quantity), kind: 'refund', refId: b.id, userId: b.cashier_id });
      }
    });
    res.status(201).json({ id: b.id, status: 'created', session_closed: sessionClosed === 1 });
  });

  // --- Sessions de caisse (§9) -------------------------------------------------------------------------------

  r.get('/cash-sessions/current', (req, res) => {
    const registerId = String(req.query.register_id ?? '');
    if (!registerId) fail(400, 'REGISTER_REQUIRED', 'register_id est obligatoire');
    const register = get(db, 'SELECT store_id FROM registers WHERE id = ?', registerId);
    if (register) requireStore(req, register.store_id);
    const open = get(db, `SELECT * FROM cash_sessions WHERE register_id = ? AND status = 'open'`, registerId);
    res.json({ session: open ? publicSession(open) : null });
  });

  r.post('/cash-sessions', (req, res) => {
    const b = req.body ?? {};
    if (get(db, 'SELECT id FROM cash_sessions WHERE id = ?', b.id ?? '')) return res.json({ id: b.id, status: 'duplicate' });
    if (!isUuid(b.id) || !isId(b.store_id) || !isId(b.register_id) || !isId(b.opened_by) || !isDate(b.opened_at)
      || !isInt(b.opening_cash, 0) || !isNote(b.opening_note)) fail(400, 'INVALID_DATA', 'Ouverture de caisse invalide');
    requireStore(req, b.store_id);
    if (!get(db, 'SELECT id FROM registers WHERE id = ? AND store_id = ?', b.register_id, b.store_id)) {
      fail(422, 'REGISTER_MISMATCH', 'Cette caisse n’appartient pas à ce magasin');
    }
    const open = get(db, `SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'open'`, b.register_id);
    if (open) fail(409, 'SESSION_ALREADY_OPEN', 'Une autre session est déjà ouverte sur cette caisse', { session_id: open.id });
    run(db, `INSERT INTO cash_sessions (id, store_id, register_id, status, opened_by, opened_at, opening_cash, opening_note, received_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`, b.id, b.store_id, b.register_id, b.opened_by, b.opened_at, b.opening_cash,
    clean(b.opening_note), nowIso());
    res.status(201).json({ id: b.id, status: 'created' });
  });

  r.post('/cash-movements', (req, res) => {
    const b = req.body ?? {};
    const known = get(db, 'SELECT session_closed FROM cash_movements WHERE id = ?', b.id ?? '');
    if (known) return res.json({ id: b.id, status: 'duplicate', session_closed: known.session_closed === 1 });
    if (!isUuid(b.id) || !isId(b.session_id) || !['in', 'out'].includes(b.type) || !isInt(b.amount, 1) || !isText(b.reason)
      || !isId(b.created_by) || !isOptId(b.approved_by) || !isDate(b.created_at)) fail(400, 'INVALID_DATA', 'Mouvement d’espèces invalide');
    const session = get(db, 'SELECT * FROM cash_sessions WHERE id = ?', b.session_id);
    if (!session) fail(422, 'SESSION_UNKNOWN', 'Session de caisse inconnue');
    requireStore(req, session.store_id);
    const sessionClosed = session.status === 'closed' ? 1 : 0;
    run(db, `INSERT INTO cash_movements (id, session_id, type, amount, reason, created_by, approved_by, created_at, session_closed,
      approval_warning, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.id, b.session_id, b.type, b.amount, clean(b.reason),
    b.created_by, b.approved_by ?? null, b.created_at, sessionClosed, approvalWarning(db, b.approved_by, session.store_id), nowIso());
    res.status(201).json({ id: b.id, status: 'created', session_closed: sessionClosed === 1 });
  });

  const isAmount = (method, v) => (method === 'cash' ? isInt(v, 0) : Number.isSafeInteger(v));
  const validCounts = (counts) => Array.isArray(counts) && new Set(counts.map((c) => c?.method)).size === counts.length
    && counts.every((c) => c && COUNTED_METHODS.includes(c.method) && isAmount(c.method, c.expected) && isAmount(c.method, c.counted)
      && Number.isInteger(c.difference))
    && REQUIRED_COUNTS.every((m) => counts.some((c) => c.method === m));
  const validCashCount = (lines) => lines === null || lines === undefined || (Array.isArray(lines)
    && lines.every((l) => l && isInt(l.value, 1) && isInt(l.quantity, 0)) && new Set(lines.map((l) => l.value)).size === lines.length);

  r.post('/cash-sessions/:id/close', (req, res) => {
    const session = get(db, 'SELECT * FROM cash_sessions WHERE id = ?', req.params.id);
    if (!session) fail(404, 'NOT_FOUND', 'Session de caisse introuvable');
    requireStore(req, session.store_id);
    if (session.status === 'closed') return res.json({ id: session.id, status: 'duplicate', expected_mismatch: session.expected_mismatch === 1 });
    const b = req.body ?? {};
    if (!isId(b.closed_by) || !isOptId(b.approved_by) || !isDate(b.closed_at) || !validCounts(b.counts) || !validCashCount(b.cash_count)
      || !isNote(b.closing_note)) fail(400, 'INVALID_DATA', 'Clôture invalide');
    if (b.counts.some((c) => c.difference !== c.counted - c.expected)) fail(422, 'DIFFERENCE_MISMATCH', 'Écart incohérent');
    const cash = b.counts.find((c) => c.method === 'cash');
    if (b.cash_count && b.cash_count.reduce((n, l) => n + l.value * l.quantity, 0) !== cash.counted) {
      fail(422, 'CASH_COUNT_MISMATCH', 'Le détail du comptage ne donne pas les espèces comptées');
    }
    if (b.counts.some((c) => c.difference !== 0) && !b.closing_note) fail(422, 'CLOSING_NOTE_REQUIRED', 'Note obligatoire quand il y a un écart');
    // Acceptée même si le serveur n'arrive pas aux mêmes attendus (ventes encore en route) : signalée au back-office.
    const recomputed = expectedByMethod(db, session);
    const mismatch = b.counts.some((c) => c.expected !== recomputed[c.method]) ? 1 : 0;
    run(db, `UPDATE cash_sessions SET status = 'closed', closed_by = ?, approved_by = ?, closed_at = ?, counts = ?, cash_count = ?,
      closing_note = ?, expected_mismatch = ?, api_expected = ?, approval_warning = ? WHERE id = ?`,
    b.closed_by, b.approved_by ?? null, b.closed_at, JSON.stringify(b.counts), b.cash_count ? JSON.stringify(b.cash_count) : null,
    clean(b.closing_note), mismatch, JSON.stringify(recomputed), approvalWarning(db, b.approved_by, session.store_id), session.id);
    res.json({ id: session.id, status: 'closed', expected_mismatch: mismatch === 1 });
  });

  return r;
}

/** Champs d'un client saisis (caisse ou back-office), contrôlés (§4). */
export function customerFields(b) {
  const name = clean(b.name, 100);
  if (!name) fail(400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  const phone = b.phone === null || b.phone === undefined || b.phone === '' ? null : String(b.phone).replace(/[\s.-]/g, '');
  if (phone !== null && !/^\+?\d{6,15}$/.test(phone)) fail(400, 'INVALID_DATA', 'Téléphone invalide');
  const matricule = b.matricule === null || b.matricule === undefined || b.matricule === '' ? null : String(b.matricule).trim();
  if (matricule !== null && !/^\d{1,15}$/.test(matricule)) fail(400, 'INVALID_DATA', 'Matricule invalide : chiffres seulement, 15 au plus');
  const d = b.discount_percent;
  const discount_percent = d === null || d === undefined || d === '' || d === 0 ? null : d;
  if (discount_percent !== null && !isInt(discount_percent, 1, 100)) fail(400, 'INVALID_DATA', 'Remise du client : 1 à 100 %');
  return { name, phone, matricule, discount_percent };
}

const SESSION_FIELDS = ['id', 'store_id', 'register_id', 'status', 'opened_by', 'opened_at', 'opening_cash', 'opening_note',
  'closed_by', 'approved_by', 'closed_at', 'counts', 'cash_count', 'closing_note'];
const JSON_FIELDS = new Set(['counts', 'cash_count']);

export function publicSession(s) {
  return Object.fromEntries(SESSION_FIELDS.map((k) => [k, JSON_FIELDS.has(k) && s[k] ? JSON.parse(s[k]) : s[k] ?? null]));
}

/**
 * Attendus d'après ce que le serveur a reçu (§9) : espèces = fond + ventes non annulées − remboursements
 * + règlements de dettes + entrées − sorties ; carte et mobile de même, sans les mouvements.
 */
export function expectedByMethod(db, session) {
  const expected = { cash: session.opening_cash, card: 0, mobile: 0, qr: 0 };
  for (const row of all(db, `SELECT doc FROM sales WHERE session_id = ? AND status = 'completed'`, session.id)) {
    for (const p of parseDoc(row).payments) if (p.method in expected) expected[p.method] += p.amount;
  }
  for (const row of all(db, 'SELECT doc FROM refunds WHERE session_id = ?', session.id)) {
    for (const p of parseDoc(row).payments) if (p.method in expected) expected[p.method] -= p.amount;
  }
  for (const p of all(db, 'SELECT method, amount FROM customer_payments WHERE session_id = ?', session.id)) {
    if (p.method in expected) expected[p.method] += p.amount;
  }
  for (const m of all(db, 'SELECT type, amount FROM cash_movements WHERE session_id = ?', session.id)) {
    expected.cash += m.type === 'in' ? m.amount : -m.amount;
  }
  return expected;
}
