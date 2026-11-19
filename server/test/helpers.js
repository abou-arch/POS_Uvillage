// Serveur de test : base en mémoire avec les données de démonstration, sur un port libre.
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
import { lineTotals, saleTotals } from '../../pos-caisse/src/lib/totals.js';

const PIN_ITERATIONS = 1000; // 600 000 en vrai : trop lent pour les tests

export async function startServer() {
  const db = openDb(':memory:');
  await seedDemo(db, { pinIterations: PIN_ITERATIONS });
  const server = createApp({ db, pinIterations: PIN_ITERATIONS }).listen(0, '127.0.0.1');
  await new Promise((ok) => server.once('listening', ok));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function login(username) {
    const res = await call('POST', '/auth/login', { body: { username, password: username } });
    if (res.status !== 200) throw new Error(`login ${username} : ${res.status}`);
    const token = res.body.token;
    const as = (method) => (path, body) => call(method, path, { token, body });
    return { token, user: res.body.user, stores: res.body.stores, get: as('GET'), post: as('POST'), put: as('PUT'), del: as('DELETE') };
  }

  return { db, base, call, login, close: () => new Promise((ok) => server.close(ok)) };
}

/** Ligne de vente au format du contrat, totaux calculés comme la caisse. */
export function line(product, quantity, { discount = 0, unit = 'unit' } = {}) {
  const t = lineTotals(quantity, product.price_ttc, discount, product.tva_rate);
  return {
    id: randomUUID(), product_id: product.id, name: product.name, quantity, unit, unit_price_ttc: product.price_ttc, discount,
    tva_rate: product.tva_rate, total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc,
  };
}

let counter = 0;
/** Vente complète ; payée en espèces par défaut. */
export function sale({ session, lines, payments, customer_id = null, cashier_id = 'u_1', other_charges = 0, global_discount = 0, created_at }) {
  const totals = saleTotals(lines, other_charges, global_discount);
  const pay = payments ?? [{ method: 'cash', amount: totals.ttc }];
  counter += 1;
  return {
    id: randomUUID(), number: `ST1-REG1-${String(counter).padStart(6, '0')}`, store_id: session.store_id, register_id: session.register_id,
    session_id: session.id, cashier_id, approved_by: null, customer_id, created_at: created_at ?? new Date().toISOString(),
    lines, other_charges, global_discount, totals, payments: pay,
    amount_received: pay.filter((p) => p.method === 'cash').reduce((n, p) => n + p.amount, 0), change_given: 0, send_sms: false, status: 'completed',
  };
}

export function sessionBody(store_id = 'st_1', register_id = 'reg_1', opened_by = 'u_1', opening_cash = 50000) {
  return { id: randomUUID(), store_id, register_id, opened_by, opened_at: new Date().toISOString(), opening_cash, opening_note: null };
}

export const P1 = { id: 'p_1', name: 'PAIN NORMAL', price_ttc: 150, tva_rate: 0 };
export const P6 = { id: 'p_6', name: 'MILLE FEUILLE', price_ttc: 100, tva_rate: 20 };
export const OLIVES = { id: 'p_20', name: 'OLIVES NOIRES', price_ttc: 2500, tva_rate: 20 };
