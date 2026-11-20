// Base de données du serveur : SQLite, intégré à Node 24 (node:sqlite), un seul fichier (data/pos.db par défaut).
// Montants en centimes (entiers). Quantités de stock en millièmes (entiers) : 1 pièce = 1000, 0,750 kg = 750.
// Ventes et retours sont gardés tels que la caisse les envoie (colonne doc, JSON, format du contrat §5 et §10), avec
// à côté les colonnes qui servent aux recherches et aux rapports.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  closing_difference_threshold INTEGER NOT NULL DEFAULT 2000,
  cashier_max_discount_percent INTEGER,
  cashier_max_discount INTEGER,
  address TEXT NOT NULL DEFAULT '',
  ice TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_stores (
  user_id TEXT NOT NULL REFERENCES users(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  PRIMARY KEY (user_id, store_id)
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_failures (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  failures INTEGER NOT NULL,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT
);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  barcode TEXT,
  name TEXT NOT NULL,
  name_ar TEXT,
  category_id TEXT REFERENCES categories(id),
  brand_id TEXT REFERENCES brands(id),
  price_ttc INTEGER NOT NULL,
  cost_price INTEGER,
  tva_rate INTEGER NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('unit', 'kg')),
  image_url TEXT,
  stock_alert INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS products_barcode ON products(barcode);
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT NOT NULL REFERENCES products(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, store_id)
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'refund', 'cancel', 'receipt', 'adjustment', 'inventory')),
  ref_id TEXT,
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_moves_product ON stock_moves(product_id, store_id, created_at);
CREATE TABLE IF NOT EXISTS barcode_rules (
  store_id TEXT NOT NULL REFERENCES stores(id),
  prefix TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weight', 'price')),
  integer_digits INTEGER NOT NULL,
  decimal_digits INTEGER NOT NULL,
  PRIMARY KEY (store_id, prefix)
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  matricule TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  store_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'mobile')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_cash INTEGER NOT NULL,
  opening_note TEXT,
  closed_by TEXT,
  approved_by TEXT,
  closed_at TEXT,
  counts TEXT,
  cash_count TEXT,
  closing_note TEXT,
  expected_mismatch INTEGER NOT NULL DEFAULT 0,
  api_expected TEXT,
  approval_warning INTEGER NOT NULL DEFAULT 0,
  forced INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_sessions_register ON cash_sessions(register_id, status);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  session_closed INTEGER NOT NULL DEFAULT 0,
  approval_warning INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_session ON cash_movements(session_id);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  store_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  customer_id TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')),
  total_ttc INTEGER NOT NULL,
  credit INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL,
  session_closed INTEGER NOT NULL DEFAULT 0,
  approval_warning INTEGER NOT NULL DEFAULT 0,
  price_warning INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancelled_by TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_number ON sales(number);
CREATE INDEX IF NOT EXISTS sales_created ON sales(store_id, created_at);
CREATE INDEX IF NOT EXISTS sales_session ON sales(session_id);
CREATE INDEX IF NOT EXISTS sales_customer ON sales(customer_id);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  original_sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  customer_id TEXT,
  created_at TEXT NOT NULL,
  total_ttc INTEGER NOT NULL,
  credit INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL,
  session_closed INTEGER NOT NULL DEFAULT 0,
  approval_warning INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_sale ON refunds(original_sale_id);
CREATE INDEX IF NOT EXISTS refunds_created ON refunds(store_id, created_at);
CREATE INDEX IF NOT EXISTS refunds_session ON refunds(session_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Ouvre (ou crée) la base. ':memory:' pour les tests. */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Colonnes ajoutées après la création d'une base : ajoutées aussi aux bases existantes (data/pos.db). */
function migrate(db) {
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const add = (table, column, type) => { if (!columns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); };
  // Contrat 0.8 : règlement d'une dette fait à la caisse, compté dans les attendus de sa session (§4, §9).
  add('customer_payments', 'register_id', 'TEXT');
  add('customer_payments', 'session_id', 'TEXT');
  add('customer_payments', 'session_closed', 'INTEGER NOT NULL DEFAULT 0');
  add('customer_payments', 'balance_exceeded', 'INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS customer_payments_session ON customer_payments(session_id)');
  // Contrat 0.8 : annulation demandée par un caissier, autorisée par un responsable (§5, §11).
  add('sales', 'cancel_approved_by', 'TEXT');
}

/** Exécute fn dans une transaction : tout ou rien. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const all = (db, sql, ...params) => db.prepare(sql).all(...params);
export const get = (db, sql, ...params) => db.prepare(sql).get(...params);
export const run = (db, sql, ...params) => db.prepare(sql).run(...params);

/** Date au format du contrat, à la seconde : « 2026-11-12T08:02:00Z ». */
export const nowIso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Horodatage des articles (`updated_at`, §3), à la milliseconde : la caisse redemande les articles modifiés après le
 * plus récent qu'elle a reçu ; à la seconde, un article modifié dans la même seconde que sa synchro serait manqué.
 */
export const stampNow = () => new Date().toISOString();

/** Millièmes ↔ quantité affichée (3 décimales). */
export const toMilli = (q) => Math.round(q * 1000);
export const fromMilli = (m) => m / 1000;

export function getSetting(db, key, fallback) {
  const row = get(db, 'SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}
export const setSetting = (db, key, value) =>
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
