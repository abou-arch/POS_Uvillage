// Fausse API conforme à docs/API_CONTRACT.md — à remplacer par la vraie API de l'équipe web.
// Lancement : npm run mock  (http://localhost:4000/api)
import express from 'express';
import cors from 'cors';
import { users, stores, categories, brands, products, customers, sales, cashSessions, cashMovements, refunds } from './data.js';
import { loadState, saveState } from './state.js';
import { paidByLine, refundLine, saleTotals } from '../src/lib/totals.js';

// Ventes, retours, sessions et stocks sont gardés dans mock-api/state.json : relancer la fausse API ne perd rien.
const state = { sales, cashSessions, cashMovements, refunds, customers, products };
loadState(state);
const save = () => saveState(state);

const app = express();
app.use(cors());
app.use(express.json());

// Tokens « tok.<id utilisateur>.<aléatoire> » : ils restent valables quand on relance la fausse API,
// pratique pour tester les ventes faites pendant une coupure. Une vraie API signerait ses tokens.
const userFromToken = (token) => (token?.startsWith('tok.') ? users.find((u) => u.id === token.split('.')[1]) : undefined);
const err =(res, status, code, message, details = {}) => res.status(status).json({ error: { code, message, details } });
const error = (code, message, details = {}) => ({ error: { code, message, details } });

// Contrôles de format (§9) : UUID, entiers en centimes, dates ISO, textes de 200 caractères au plus.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isInt = (v, min) => Number.isInteger(v) && v >= min;
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isId = (v) => typeof v === 'string' && v.length > 0;
const isText = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200;
const isNote = (v) => v === null || v === undefined || isText(v);

// Latence simulée pour tester les états de chargement.
app.use((_req, _res, next) => setTimeout(next, 150));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = users.find((u) => u.username === username && u.password === password);
  if (!user) return err(res, 401, 'BAD_CREDENTIALS', 'Identifiants incorrects');
  const token = `tok.${user.id}.${crypto.randomUUID()}`;
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
    stores: stores.filter((s) => user.store_ids.includes(s.id)),
  });
});

app.use('/api', (req, res, next) => {
  const user = userFromToken(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return err(res, 401, 'UNAUTHENTICATED', 'Connexion requise');
  req.user = user;
  next();
});

app.get('/api/categories', (_req, res) => res.json(categories));
app.get('/api/brands', (_req, res) => res.json(brands));

app.get('/api/products', (req, res) => {
  const { store_id, updated_since } = req.query;
  if (!store_id) return err(res, 400, 'STORE_REQUIRED', 'store_id est obligatoire');
  const list = products
    .filter((p) => !updated_since || p.updated_at > updated_since)
    .map(({ stock_by_store, ...p }) => ({ ...p, stock: stock_by_store[store_id] ?? 0 }));
  res.json(list);
});

app.get('/api/customers', (req, res) => {
  const q = String(req.query.search ?? '').toLowerCase();
  res.json(customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone?.includes(q) || c.matricule?.includes(q)));
});

app.post('/api/customers', (req, res) => {
  const { id, name, phone = null, matricule = null } = req.body ?? {};
  if (!name) return err(res, 400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  const existing = customers.find((c) => c.id === id);
  if (existing) return res.status(200).json(existing);
  const customer = { id: id ?? `c_${crypto.randomUUID()}`, name, phone, matricule };
  customers.push(customer);
  save();
  res.status(201).json(customer);
});

/** §5 et §10 : une vente ou un retour porte la session ouverte de sa caisse. Renvoie l'erreur, ou la session. */
function sessionOf(doc) {
  const session = cashSessions.get(doc.session_id);
  if (!session) return { status: 422, body: error('SESSION_UNKNOWN', 'Session de caisse inconnue') };
  if (session.store_id !== doc.store_id || session.register_id !== doc.register_id) {
    return { status: 422, body: error('SESSION_MISMATCH', 'Session d’un autre magasin ou d’une autre caisse') };
  }
  return { session };
}

function createSale(sale) {
  const known = sales.get(sale.id);
  if (known) return { status: 200, body: { id: sale.id, status: 'duplicate', stock_warning: false, session_closed: known.session_closed ?? false } };
  // §5 : une session déjà clôturée n'empêche pas d'enregistrer la vente : elle a eu lieu.
  const { session, ...refused } = sessionOf(sale);
  if (!session) return refused;
  const session_closed = session.status === 'closed';
  const expected = saleTotals(sale.lines ?? [], sale.other_charges, sale.global_discount);
  if (!['ht', 'tva', 'ttc'].every((k) => Math.abs(expected[k] - sale.totals?.[k]) <= 1)) {
    return { status: 422, body: error('TOTALS_MISMATCH', 'Totaux incohérents', { expected }) };
  }
  // §5 : la somme des paiements ne dépasse pas le total ; moins que le total, ou du crédit, seulement pour un client.
  const payments = sale.payments ?? [];
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const credit = paid < sale.totals.ttc || payments.some((p) => p.method === 'credit');
  if (paid > sale.totals.ttc || (credit && !sale.customer_id)) {
    return { status: 422, body: error('PAYMENTS_MISMATCH', 'Paiements incohérents', { paid }) };
  }
  let stock_warning = false;
  for (const line of sale.lines) {
    const product = products.find((p) => p.id === line.product_id);
    if (!product) continue;
    product.stock_by_store[sale.store_id] = (product.stock_by_store[sale.store_id] ?? 0) - line.quantity;
    product.updated_at = new Date().toISOString();
    if (product.stock_by_store[sale.store_id] < 0) stock_warning = true;
  }
  sales.set(sale.id, { ...sale, session_closed, received_at: new Date().toISOString() });
  return { status: 201, body: { id: sale.id, status: 'created', stock_warning, session_closed } };
}

app.post('/api/sales', (req, res) => {
  const { status, body } = createSale(req.body ?? {});
  if (status === 201) save();
  res.status(status).json(body);
});

app.post('/api/sales/batch', (req, res) => {
  const results = (req.body?.sales ?? []).map((s) => {
    const { status, body } = createSale(s ?? {});
    return status >= 400 ? { id: s?.id, status: 'error', error: body.error } : body;
  });
  if (results.some((r) => r.status === 'created')) save();
  res.json({ results });
});

app.post('/api/sales/:id/cancel', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return err(res, 403, 'FORBIDDEN', 'Réservé au gérant');
  const sale = sales.get(req.params.id);
  if (!sale) return err(res, 404, 'NOT_FOUND', 'Vente introuvable');
  if (sale.status === 'cancelled') return res.json({ id: sale.id, status: 'cancelled' });
  if ([...refunds.values()].some((r) => r.original_sale_id === sale.id)) {
    return err(res, 422, 'SALE_REFUNDED', 'Cette vente a déjà des retours : elle ne peut plus être annulée');
  }
  for (const line of sale.lines) {
    const product = products.find((p) => p.id === line.product_id);
    if (product) product.stock_by_store[sale.store_id] += line.quantity;
  }
  sale.status = 'cancelled';
  save();
  res.json({ id: sale.id, status: 'cancelled' });
});

app.get('/api/sales', (_req, res) => res.json([...sales.values()])); // pratique pour vérifier pendant le dev

// --- Retours (§5, §10) ------------------------------------------------------------------------------------

const withoutMeta = ({ session_closed: _c, received_at: _r, ...doc }) => doc; // champs internes de la fausse API
const refundsOf = (saleId) => [...refunds.values()].filter((r) => r.original_sale_id === saleId);

app.get('/api/sales/by-number/:number', (req, res) => {
  const sale = [...sales.values()].find((s) => s.number === req.params.number);
  if (!sale || !req.user.store_ids.includes(sale.store_id)) return err(res, 404, 'NOT_FOUND', 'Vente introuvable');
  const customer = customers.find((c) => c.id === sale.customer_id);
  res.json({
    sale: withoutMeta(sale),
    customer: customer ? { id: customer.id, name: customer.name } : null,
    refunds: refundsOf(sale.id).map(withoutMeta),
  });
});

const REASONS = ['defective', 'cashier_error', 'changed_mind', 'other'];
const METHODS = ['cash', 'card', 'mobile', 'credit'];
const round3 = (n) => Math.round(n * 1000) / 1000;
const isQuantity = (v) => typeof v === 'number' && v > 0 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6; // 3 décimales
const sumOf = (list, fn) => list.reduce((n, x) => n + fn(x), 0);
const creditOf = (payments) => sumOf(payments.filter((p) => p.method === 'credit'), (p) => p.amount);

function validRefund(b) {
  return UUID.test(b.id ?? '') && isId(b.number) && isId(b.store_id) && isId(b.register_id) && isId(b.session_id)
    && isId(b.original_sale_id) && isId(b.cashier_id) && (b.customer_id === null || isId(b.customer_id)) && isDate(b.created_at)
    && REASONS.includes(b.reason) && isNote(b.reason_text) && (b.reason !== 'other' || isText(b.reason_text))
    && Array.isArray(b.lines) && b.lines.length > 0
    && b.lines.every((l) => l && Number.isInteger(l.line_index) && l.line_index >= 0 && isQuantity(l.quantity)
      && ['total_ht', 'total_tva', 'total_ttc'].every((k) => isInt(l[k], 0)))
    && new Set(b.lines.map((l) => l.line_index)).size === b.lines.length
    && b.totals && ['ht', 'tva', 'ttc'].every((k) => isInt(b.totals[k], 0))
    && Array.isArray(b.payments) && b.payments.length > 0 && b.payments.every((p) => p && METHODS.includes(p.method) && isInt(p.amount, 1))
    && sumOf(b.payments, (p) => p.amount) === b.totals.ttc;
}

app.post('/api/refunds', (req, res) => {
  const b = req.body ?? {};
  const known = refunds.get(b.id);
  if (known) return res.json({ id: b.id, status: 'duplicate', session_closed: known.session_closed });
  if (!validRefund(b)) return err(res, 400, 'INVALID_DATA', 'Retour invalide');
  const sale = sales.get(b.original_sale_id);
  if (!sale) return err(res, 422, 'SALE_UNKNOWN', 'Vente d’origine inconnue');
  if (sale.status === 'cancelled') return err(res, 422, 'SALE_CANCELLED', 'Vente d’origine annulée');
  if (sale.store_id !== b.store_id) return err(res, 422, 'STORE_MISMATCH', 'Le retour se fait dans le magasin de la vente');
  const { session, ...refused } = sessionOf(b);
  if (!session) return res.status(refused.status).json(refused.body);
  if (b.customer_id !== (sale.customer_id ?? null)) return err(res, 422, 'CUSTOMER_MISMATCH', 'Le client n’est pas celui de la vente');

  // §7 : chaque ligne est recalculée à partir des retours déjà reçus, à 1 centime près ; jamais plus que son payé.
  const previous = refundsOf(sale.id);
  const paid = paidByLine(sale.lines, sale.other_charges, sale.global_discount);
  for (const l of b.lines) {
    const original = sale.lines[l.line_index];
    if (!original || (original.id ?? null) !== (l.original_line_id ?? null)) {
      return err(res, 422, 'LINE_MISMATCH', 'Ligne de vente introuvable', { line_index: l.line_index });
    }
    const before = previous.flatMap((r) => r.lines).filter((x) => x.line_index === l.line_index);
    const returned = round3(sumOf(before, (x) => x.quantity));
    const remaining = round3(original.quantity - returned);
    if (l.quantity > remaining) return err(res, 422, 'RETURN_EXCEEDS', 'Plus que ce qui reste à retourner', { line_index: l.line_index, remaining });
    const expected = refundLine(paid[l.line_index], original.tva_rate, original.quantity, returned, l.quantity);
    const off = ['ht', 'tva', 'ttc'].some((k) => Math.abs(expected[k] - l[`total_${k}`]) > 1);
    if (off || sumOf(before, (x) => x.total_ttc) + l.total_ttc > paid[l.line_index]) {
      return err(res, 422, 'TOTALS_MISMATCH', 'Montant remboursé incohérent', { line_index: l.line_index, expected });
    }
  }
  const lineSum = (k) => sumOf(b.lines, (l) => l[`total_${k}`]);
  if (['ht', 'tva', 'ttc'].some((k) => Math.abs(lineSum(k) - b.totals[k]) > 1)) return err(res, 422, 'TOTALS_MISMATCH', 'Totaux incohérents');
  // Le crédit réduit la dette du client : pas plus que le crédit de la vente pas encore remboursé.
  const creditLeft = creditOf(sale.payments ?? []) - sumOf(previous, (r) => creditOf(r.payments));
  if (creditOf(b.payments) > creditLeft) return err(res, 422, 'CREDIT_EXCEEDED', 'Crédit remboursé supérieur au crédit de la vente', { available: creditLeft });

  for (const l of b.lines) { // les articles reviennent en stock dans le magasin
    const product = products.find((p) => p.id === sale.lines[l.line_index].product_id);
    if (!product) continue;
    product.stock_by_store[b.store_id] = round3((product.stock_by_store[b.store_id] ?? 0) + l.quantity);
    product.updated_at = new Date().toISOString();
  }
  const session_closed = session.status === 'closed';
  refunds.set(b.id, { ...b, session_closed, received_at: new Date().toISOString() });
  save();
  res.status(201).json({ id: b.id, status: 'created', session_closed });
});

// --- Sessions de caisse (§9) ------------------------------------------------------------------------------

const SESSION_FIELDS = ['id', 'store_id', 'register_id', 'status', 'opened_by', 'opened_at', 'opening_cash', 'opening_note',
  'closed_by', 'closed_at', 'counts', 'cash_count', 'closing_note'];
const publicSession = (s) => Object.fromEntries(SESSION_FIELDS.map((k) => [k, s[k]]));

const COUNTED_METHODS = ['cash', 'card', 'mobile']; // le crédit n'est pas de l'argent reçu

/**
 * Montants attendus d'après ce que l'API a reçu (§9) : espèces = fond + ventes − remboursements + entrées − sorties ;
 * carte, mobile = ventes − remboursements de la session.
 */
function expectedByMethod(session) {
  const expected = { cash: session.opening_cash, card: 0, mobile: 0 };
  for (const sale of sales.values()) {
    if (sale.session_id !== session.id) continue;
    for (const p of sale.payments ?? []) if (p.method in expected) expected[p.method] += p.amount;
  }
  for (const refund of refunds.values()) {
    if (refund.session_id !== session.id) continue;
    for (const p of refund.payments) if (p.method in expected) expected[p.method] -= p.amount;
  }
  for (const m of cashMovements.values()) if (m.session_id === session.id) expected.cash += m.type === 'in' ? m.amount : -m.amount;
  return expected;
}

// Espèces ≥ 0 ; carte et mobile peuvent être négatifs quand les retours de la session dépassent les ventes (§9).
const isAmount = (method, v) => (method === 'cash' ? isInt(v, 0) : Number.isSafeInteger(v));
const isCount = (c) => c && COUNTED_METHODS.includes(c.method) && isAmount(c.method, c.expected) && isAmount(c.method, c.counted)
  && Number.isInteger(c.difference);
const validCounts = (counts) => Array.isArray(counts) && counts.length === COUNTED_METHODS.length && counts.every(isCount)
  && COUNTED_METHODS.every((m) => counts.some((c) => c.method === m));
const validCashCount = (lines) => lines === null || lines === undefined || (Array.isArray(lines)
  && lines.every((l) => l && isInt(l.value, 1) && isInt(l.quantity, 0))
  && new Set(lines.map((l) => l.value)).size === lines.length);

app.get('/api/cash-sessions/current', (req, res) => {
  const registerId = req.query.register_id;
  if (!registerId) return err(res, 400, 'REGISTER_REQUIRED', 'register_id est obligatoire');
  const open = [...cashSessions.values()].find((s) => s.register_id === registerId && s.status === 'open');
  res.json({ session: open ? publicSession(open) : null });
});

app.post('/api/cash-sessions', (req, res) => {
  const b = req.body ?? {};
  if (cashSessions.has(b.id)) return res.json({ id: b.id, status: 'duplicate' });
  if (!UUID.test(b.id ?? '') || !isId(b.store_id) || !isId(b.register_id) || !isId(b.opened_by) || !isDate(b.opened_at)
    || !isInt(b.opening_cash, 0) || !isNote(b.opening_note)) {
    return err(res, 400, 'INVALID_DATA', 'Ouverture de caisse invalide');
  }
  const store = stores.find((s) => s.id === b.store_id);
  if (!store?.registers.some((r) => r.id === b.register_id)) return err(res, 422, 'REGISTER_MISMATCH', 'Cette caisse n’appartient pas à ce magasin');
  const open = [...cashSessions.values()].find((s) => s.register_id === b.register_id && s.status === 'open');
  if (open) return err(res, 409, 'SESSION_ALREADY_OPEN', 'Une autre session est déjà ouverte sur cette caisse', { session_id: open.id });
  cashSessions.set(b.id, {
    id: b.id, store_id: b.store_id, register_id: b.register_id, status: 'open',
    opened_by: b.opened_by, opened_at: b.opened_at, opening_cash: b.opening_cash, opening_note: b.opening_note ?? null,
    closed_by: null, closed_at: null, counts: null, cash_count: null, closing_note: null,
    received_at: new Date().toISOString(),
  });
  save();
  res.status(201).json({ id: b.id, status: 'created' });
});

app.post('/api/cash-movements', (req, res) => {
  const b = req.body ?? {};
  const known = cashMovements.get(b.id);
  if (known) return res.json({ id: b.id, status: 'duplicate', session_closed: known.session_closed });
  if (!UUID.test(b.id ?? '') || !isId(b.session_id) || !['in', 'out'].includes(b.type) || !isInt(b.amount, 1) || !isText(b.reason)
    || !isId(b.created_by) || !isDate(b.created_at)) {
    return err(res, 400, 'INVALID_DATA', 'Mouvement d’espèces invalide');
  }
  const session = cashSessions.get(b.session_id);
  if (!session) return err(res, 422, 'SESSION_UNKNOWN', 'Session de caisse inconnue');
  const session_closed = session.status === 'closed';
  cashMovements.set(b.id, {
    id: b.id, session_id: b.session_id, type: b.type, amount: b.amount, reason: b.reason, created_by: b.created_by,
    created_at: b.created_at, session_closed, received_at: new Date().toISOString(),
  });
  save();
  res.status(201).json({ id: b.id, status: 'created', session_closed });
});

app.post('/api/cash-sessions/:id/close', (req, res) => {
  const session = cashSessions.get(req.params.id);
  if (!session) return err(res, 404, 'NOT_FOUND', 'Session de caisse introuvable');
  if (session.status === 'closed') return res.json({ id: session.id, status: 'duplicate', expected_mismatch: session.expected_mismatch });
  const b = req.body ?? {};
  if (!isId(b.closed_by) || !isDate(b.closed_at) || !validCounts(b.counts) || !validCashCount(b.cash_count) || !isNote(b.closing_note)) {
    return err(res, 400, 'INVALID_DATA', 'Clôture invalide');
  }
  if (b.counts.some((c) => c.difference !== c.counted - c.expected)) return err(res, 422, 'DIFFERENCE_MISMATCH', 'Écart incohérent');
  const cash = b.counts.find((c) => c.method === 'cash');
  if (b.cash_count && b.cash_count.reduce((n, l) => n + l.value * l.quantity, 0) !== cash.counted) {
    return err(res, 422, 'CASH_COUNT_MISMATCH', 'Le détail du comptage ne donne pas les espèces comptées');
  }
  if (b.counts.some((c) => c.difference !== 0) && !b.closing_note) {
    return err(res, 422, 'CLOSING_NOTE_REQUIRED', 'Note obligatoire quand il y a un écart');
  }
  // La clôture a eu lieu : elle est acceptée même si l'API n'arrive pas aux mêmes attendus, et signalée.
  // Le seuil d'écart n'est pas recontrôlé ici : la caisse l'a appliqué au moment de la clôture (§9).
  const recomputed = expectedByMethod(session);
  const expected_mismatch = b.counts.some((c) => c.expected !== recomputed[c.method]);
  Object.assign(session, {
    status: 'closed', closed_by: b.closed_by, closed_at: b.closed_at, counts: b.counts, cash_count: b.cash_count ?? null,
    closing_note: b.closing_note ?? null, expected_mismatch, api_expected: recomputed,
  });
  save();
  res.json({ id: session.id, status: 'closed', expected_mismatch });
});

// Pratique pour vérifier pendant le dev, hors contrat (comme GET /api/sales).
app.get('/api/cash-sessions', (_req, res) => res.json([...cashSessions.values()]));
app.get('/api/cash-movements', (_req, res) => res.json([...cashMovements.values()]));
app.get('/api/refunds', (_req, res) => res.json([...refunds.values()]));

// Sur ce poste seulement : ses tokens se fabriquent à la main (tok.u_1.x = administrateur) et elle sert les clients
// en clair. Ouverte au réseau (HOST=0.0.0.0, pour un essai sur tablette), n'importe qui sur le Wi-Fi y aurait accès.
// Ne jamais la déployer.
const PORT = process.env.PORT ?? 4000;
const HOST = process.env.HOST ?? '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Fausse API sur http://${HOST}:${PORT}/api`));
