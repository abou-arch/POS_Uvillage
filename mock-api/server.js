// Fausse API conforme à docs/API_CONTRACT.md — à remplacer par la vraie API de l'équipe web.
// Lancement : npm run mock  (http://localhost:4000/api)
import express from 'express';
import cors from 'cors';
import { users, stores, categories, brands, products, customers, sales } from './data.js';
import { saleTotals } from '../src/lib/totals.js';

const app = express();
app.use(cors());
app.use(express.json());

const tokens = new Map(); // token -> user
const err = (res, status, code, message, details = {}) => res.status(status).json({ error: { code, message, details } });

// Latence simulée pour tester les états de chargement.
app.use((_req, _res, next) => setTimeout(next, 150));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = users.find((u) => u.username === username && u.password === password);
  if (!user) return err(res, 401, 'BAD_CREDENTIALS', 'Identifiants incorrects');
  const token = `tok_${crypto.randomUUID()}`;
  tokens.set(token, user);
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
    stores: stores.filter((s) => user.store_ids.includes(s.id)),
  });
});

app.use('/api', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = token && tokens.get(token);
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
  res.json(customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone?.includes(q)));
});

app.post('/api/customers', (req, res) => {
  const { id, name, phone = null, ice = null } = req.body ?? {};
  if (!name) return err(res, 400, 'NAME_REQUIRED', 'Le nom est obligatoire');
  const existing = customers.find((c) => c.id === id);
  if (existing) return res.status(200).json(existing);
  const customer = { id: id ?? `c_${crypto.randomUUID()}`, name, phone, ice };
  customers.push(customer);
  res.status(201).json(customer);
});

function createSale(sale) {
  if (sales.has(sale.id)) return { status: 200, body: { id: sale.id, status: 'duplicate', stock_warning: false } };
  const expected = saleTotals(sale.lines, sale.other_charges, sale.global_discount);
  if (Math.abs(expected.ttc - sale.totals?.ttc) > 1) {
    return { status: 422, body: { error: { code: 'TOTALS_MISMATCH', message: 'Totaux incohérents', details: { expected } } } };
  }
  let stock_warning = false;
  for (const line of sale.lines) {
    const product = products.find((p) => p.id === line.product_id);
    if (!product) continue;
    product.stock_by_store[sale.store_id] = (product.stock_by_store[sale.store_id] ?? 0) - line.quantity;
    product.updated_at = new Date().toISOString();
    if (product.stock_by_store[sale.store_id] < 0) stock_warning = true;
  }
  sales.set(sale.id, { ...sale, received_at: new Date().toISOString() });
  return { status: 201, body: { id: sale.id, status: 'created', stock_warning } };
}

app.post('/api/sales', (req, res) => {
  const { status, body } = createSale(req.body);
  res.status(status).json(body);
});

app.post('/api/sales/batch', (req, res) => {
  const results = (req.body?.sales ?? []).map((s) => {
    const { status, body } = createSale(s);
    return status >= 400 ? { id: s.id, status: 'error', error: body.error } : { id: s.id, status: body.status, stock_warning: body.stock_warning };
  });
  res.json({ results });
});

app.post('/api/sales/:id/cancel', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return err(res, 403, 'FORBIDDEN', 'Réservé au gérant');
  const sale = sales.get(req.params.id);
  if (!sale) return err(res, 404, 'NOT_FOUND', 'Vente introuvable');
  if (sale.status === 'cancelled') return res.json({ id: sale.id, status: 'cancelled' });
  for (const line of sale.lines) {
    const product = products.find((p) => p.id === line.product_id);
    if (product) product.stock_by_store[sale.store_id] += line.quantity;
  }
  sale.status = 'cancelled';
  res.json({ id: sale.id, status: 'cancelled' });
});

app.get('/api/sales', (_req, res) => res.json([...sales.values()])); // pratique pour vérifier pendant le dev

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => console.log(`Fausse API sur http://localhost:${PORT}/api`));
