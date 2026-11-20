// Données de départ.
// - Démonstration (--demo) : les données de la fausse API, tirées des captures de Falcon POS (le POS du client).
//   VALEURS PROVISOIRES, à remplacer par celles que livrera le client : taux de TVA, articles, stocks, format de la
//   balance, mentions du ticket. Comptes de démonstration : admin/admin, responsable/responsable, caissier/caissier.
// - Installation réelle : base vide et un administrateur créé avec ADMIN_USERNAME / ADMIN_PASSWORD.
import { randomUUID } from 'node:crypto';
import { all, nowIso, run, setSetting, stampNow, toMilli, tx } from './db.js';
import { hashPassword, hashPin, PIN_ITERATIONS } from './security.js';

/** Taux de TVA proposés dans le back-office. À CONFIRMER avec le comptable (§1 du contrat). */
export const DEFAULT_TVA_RATES = [20, 14, 10, 7, 0];

export const isEmpty = (db) => all(db, 'SELECT id FROM users LIMIT 1').length === 0;

export function seedAdmin(db, { username, password, name = 'Administrateur' }) {
  tx(db, () => {
    run(db, 'INSERT INTO users (id, username, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      `u_${randomUUID()}`, username, name, 'admin', hashPassword(password), nowIso());
    run(db, 'UPDATE products SET created_at = updated_at WHERE created_at IS NULL');
    setSetting(db, 'tva_rates', DEFAULT_TVA_RATES);
  });
}

// Mentions du ticket par magasin : valeurs FICTIVES (comme pos-caisse/src/config/store.ts), à confirmer.
const STORE_INFO = {
  st_1: { address: '12, avenue Mohammed V\n20000 Casablanca', ice: '000000000000001' },
  st_2: { address: 'Résidence Al Amal, bloc B\n20250 Casablanca', ice: '000000000000002' },
};

export async function seedDemo(db, { pinIterations = PIN_ITERATIONS } = {}) {
  const data = await import('../../pos-caisse/mock-api/data.js');
  const now = nowIso();
  const stamp = stampNow();
  tx(db, () => {
    for (const s of data.stores) {
      const info = STORE_INFO[s.id] ?? { address: '', ice: '' };
      run(db, `INSERT INTO stores (id, name, closing_difference_threshold, cashier_max_discount_percent, cashier_max_discount, address, ice)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, s.id, s.name, s.closing_difference_threshold, s.cashier_max_discount_percent,
      s.cashier_max_discount, info.address, info.ice);
      for (const r of s.registers) run(db, 'INSERT INTO registers (id, store_id, name) VALUES (?, ?, ?)', r.id, s.id, r.name);
    }
    for (const u of data.users) {
      const pin = u.pin && ['admin', 'manager'].includes(u.role) ? JSON.stringify(hashPin(u.pin, pinIterations)) : null;
      run(db, 'INSERT INTO users (id, username, name, role, password_hash, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        u.id, u.username, u.name, u.role, hashPassword(u.password), pin, now);
      for (const st of u.store_ids) run(db, 'INSERT INTO user_stores (user_id, store_id) VALUES (?, ?)', u.id, st);
    }
    for (const c of data.categories) run(db, 'INSERT INTO categories (id, name, name_ar) VALUES (?, ?, ?)', c.id, c.name, c.name_ar);
    for (const b of data.brands) run(db, 'INSERT INTO brands (id, name) VALUES (?, ?)', b.id, b.name);
    for (const p of data.products) {
      // Prix d'achat inconnu dans les données de démonstration : 70 % du prix de vente, pour illustrer la marge.
      run(db, `INSERT INTO products (id, code, barcode, name, name_ar, category_id, brand_id, price_ttc, cost_price, tva_rate, unit,
        image_url, stock_alert, expiry_date, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      p.id, p.code, p.barcode, p.name, p.name_ar, p.category_id, p.brand_id, p.price_ttc, Math.round(p.price_ttc * 0.7), p.tva_rate,
      p.unit, p.image_url, p.stock_alert, p.expiry_date, stamp);
      for (const [store, qty] of Object.entries(p.stock_by_store)) {
        run(db, 'INSERT INTO stock (product_id, store_id, quantity) VALUES (?, ?, ?)', p.id, store, toMilli(qty));
        run(db, `INSERT INTO stock_moves (id, product_id, store_id, delta, kind, note, created_at) VALUES (?, ?, ?, ?, 'inventory', ?, ?)`,
          randomUUID(), p.id, store, toMilli(qty), 'Stock de départ (démonstration)', now);
      }
    }
    for (const [store, rules] of Object.entries(data.barcodeRules)) {
      for (const r of rules) {
        run(db, 'INSERT INTO barcode_rules (store_id, prefix, type, integer_digits, decimal_digits) VALUES (?, ?, ?, ?, ?)',
          store, r.prefix, r.type, r.integer_digits, r.decimal_digits);
      }
    }
    for (const c of data.customers) {
      run(db, 'INSERT INTO customers (id, name, phone, matricule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        c.id, c.name, c.phone, c.matricule, now, now);
    }
    setSetting(db, 'tva_rates', DEFAULT_TVA_RATES);
  });
}
