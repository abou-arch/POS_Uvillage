// Rapports du back-office, calculés à partir des ventes et retours reçus (documents du contrat §5 et §10).
// Montants en centimes. Les ventes annulées sont comptées à part et n'entrent pas dans le chiffre d'affaires.
import { paidByLine, vatBreakdownOfLines } from '../../pos-caisse/src/lib/totals.js';
import { all, getSetting } from './db.js';
import { creditOf, sumOf } from './validate.js';

export const DEFAULT_TIMEZONE = 'Africa/Casablanca';

/** Jour (AAAA-MM-JJ) et heure (0-23) locaux d'une date ISO, dans le fuseau du magasin. */
export function localParts(iso, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Instant (ISO, UTC) du début d'un jour local AAAA-MM-JJ dans le fuseau donné : bornes des jours et des mois. */
export function localMidnight(day, timeZone) {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const offsetAt = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - t;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t); // changement d'heure entre les deux estimations
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const inList = (ids) => ids.map(() => '?').join(',') || 'NULL';

/** Ventes et retours d'une période [from, to[ dans les magasins donnés. */
export function loadPeriod(db, { storeIds, from, to }) {
  const sales = all(db, `SELECT doc, status, cashier_id, store_id FROM sales WHERE store_id IN (${inList(storeIds)})
    AND created_at >= ? AND created_at < ? ORDER BY created_at`, ...storeIds, from, to);
  const refunds = all(db, `SELECT r.doc, s.doc AS sale_doc FROM refunds r JOIN sales s ON s.id = r.original_sale_id
    WHERE r.store_id IN (${inList(storeIds)}) AND r.created_at >= ? AND r.created_at < ? ORDER BY r.created_at`, ...storeIds, from, to);
  return {
    sales: sales.map((r) => JSON.parse(r.doc)),
    refunds: refunds.map((r) => ({ refund: JSON.parse(r.doc), sale: JSON.parse(r.sale_doc) })),
  };
}

function bump(map, key, init, fn) {
  if (!map.has(key)) map.set(key, init());
  fn(map.get(key));
}

/**
 * Rapport complet d'une période. `lookup` donne les noms : { products: Map(id → {code, name, category_id, cost_price}),
 * categories: Map(id → name), users: Map(id → name), stores: Map(id → name) }.
 */
export function buildReport({ sales, refunds }, lookup, timeZone = DEFAULT_TIMEZONE) {
  const done = sales.filter((s) => s.status !== 'cancelled');
  const cancelled = sales.filter((s) => s.status === 'cancelled');
  const days = new Map();
  const hours = new Map();
  const methods = new Map();
  const products = new Map();
  const categories = new Map();
  const cashiers = new Map();
  const stores = new Map();
  const vat = new Map();
  let discounts = 0;
  let cost = 0;
  let costKnown = true;

  const productRow = (id, line) => {
    const p = lookup.products.get(id);
    return { product_id: id, code: p?.code ?? '', name: p?.name ?? line.name, category_id: p?.category_id ?? null, quantity: 0, ttc: 0, cost: 0 };
  };

  for (const s of done) {
    const { day, hour } = localParts(s.created_at, timeZone);
    bump(days, day, () => ({ day, sales_count: 0, sales_ttc: 0, refunds_ttc: 0 }), (d) => { d.sales_count += 1; d.sales_ttc += s.totals.ttc; });
    bump(hours, hour, () => ({ hour, sales_count: 0, sales_ttc: 0 }), (h) => { h.sales_count += 1; h.sales_ttc += s.totals.ttc; });
    for (const p of s.payments) bump(methods, p.method, () => ({ method: p.method, sales: 0, refunds: 0 }), (m) => { m.sales += p.amount; });
    const due = s.totals.ttc - sumOf(s.payments, (p) => p.amount);
    if (due > 0) bump(methods, 'credit', () => ({ method: 'credit', sales: 0, refunds: 0 }), (m) => { m.sales += due; });
    bump(cashiers, s.cashier_id, () => ({ user_id: s.cashier_id, name: lookup.users.get(s.cashier_id) ?? s.cashier_id, sales_count: 0, sales_ttc: 0 }),
      (c) => { c.sales_count += 1; c.sales_ttc += s.totals.ttc; });
    bump(stores, s.store_id, () => ({ store_id: s.store_id, name: lookup.stores.get(s.store_id) ?? s.store_id, sales_count: 0, sales_ttc: 0, refunds_ttc: 0 }),
      (st) => { st.sales_count += 1; st.sales_ttc += s.totals.ttc; });
    for (const g of vatBreakdownOfLines(s.lines, s.other_charges, s.global_discount)) {
      bump(vat, g.rate, () => ({ rate: g.rate, ht: 0, tva: 0, ttc: 0 }), (v) => { v.ht += g.ht; v.tva += g.tva; v.ttc += g.ttc; });
    }
    discounts += s.global_discount + sumOf(s.lines, (l) => l.discount);
    const paid = paidByLine(s.lines, s.other_charges, s.global_discount);
    s.lines.forEach((l, i) => {
      const unitCost = lookup.products.get(l.product_id)?.cost_price;
      const lineCost = unitCost === null || unitCost === undefined ? null : Math.round(unitCost * l.quantity);
      if (lineCost === null) costKnown = false; else cost += lineCost;
      bump(products, l.product_id, () => productRow(l.product_id, l), (p) => { p.quantity += l.quantity; p.ttc += paid[i]; p.cost += lineCost ?? 0; });
    });
  }

  for (const { refund: r, sale } of refunds) {
    const { day } = localParts(r.created_at, timeZone);
    bump(days, day, () => ({ day, sales_count: 0, sales_ttc: 0, refunds_ttc: 0 }), (d) => { d.refunds_ttc += r.totals.ttc; });
    for (const p of r.payments) bump(methods, p.method, () => ({ method: p.method, sales: 0, refunds: 0 }), (m) => { m.refunds += p.amount; });
    bump(stores, r.store_id, () => ({ store_id: r.store_id, name: lookup.stores.get(r.store_id) ?? r.store_id, sales_count: 0, sales_ttc: 0, refunds_ttc: 0 }),
      (st) => { st.refunds_ttc += r.totals.ttc; });
    for (const l of r.lines) {
      const original = sale.lines[l.line_index];
      if (!original) continue;
      bump(vat, original.tva_rate, () => ({ rate: original.tva_rate, ht: 0, tva: 0, ttc: 0 }), (v) => { v.ht -= l.total_ht; v.tva -= l.total_tva; v.ttc -= l.total_ttc; });
      const unitCost = lookup.products.get(original.product_id)?.cost_price;
      const lineCost = unitCost === null || unitCost === undefined ? 0 : Math.round(unitCost * l.quantity);
      cost -= lineCost;
      bump(products, original.product_id, () => productRow(original.product_id, original), (p) => {
        p.quantity = Math.round((p.quantity - l.quantity) * 1000) / 1000; p.ttc -= l.total_ttc; p.cost -= lineCost;
      });
    }
  }

  for (const p of products.values()) {
    p.quantity = Math.round(p.quantity * 1000) / 1000;
    const name = p.category_id ? lookup.categories.get(p.category_id) ?? p.category_id : 'Sans catégorie';
    bump(categories, p.category_id ?? '', () => ({ category_id: p.category_id, name, quantity: 0, ttc: 0 }), (c) => { c.ttc += p.ttc; c.quantity += p.quantity; });
  }

  const salesTtc = sumOf(done, (s) => s.totals.ttc);
  const refundsTtc = sumOf(refunds, ({ refund }) => refund.totals.ttc);
  const vatRows = [...vat.values()].sort((a, b) => b.rate - a.rate);
  const byTtc = (a, b) => b.ttc - a.ttc;
  return {
    summary: {
      sales_count: done.length,
      sales_ttc: salesTtc,
      sales_ht: sumOf(done, (s) => s.totals.ht),
      sales_tva: sumOf(done, (s) => s.totals.tva),
      refunds_count: refunds.length,
      refunds_ttc: refundsTtc,
      net_ttc: salesTtc - refundsTtc,
      net_ht: sumOf(vatRows, (v) => v.ht),
      net_tva: sumOf(vatRows, (v) => v.tva),
      average_basket: done.length ? Math.round(salesTtc / done.length) : 0,
      cancelled_count: cancelled.length,
      cancelled_ttc: sumOf(cancelled, (s) => s.totals.ttc),
      discounts,
      credit_given: sumOf(done, (s) => creditOf(s.payments) + s.totals.ttc - sumOf(s.payments, (p) => p.amount)),
      // Marge brute : connue seulement si chaque article vendu a un prix d'achat.
      margin: costKnown ? salesTtc - refundsTtc - cost : null,
    },
    by_day: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    by_hour: [...hours.values()].sort((a, b) => a.hour - b.hour),
    by_method: [...methods.values()].map((m) => ({ ...m, net: m.sales - m.refunds })),
    by_product: [...products.values()].map((p) => ({ ...p, margin: p.ttc - p.cost })).sort(byTtc),
    by_category: [...categories.values()].sort(byTtc),
    by_cashier: [...cashiers.values()].sort((a, b) => b.sales_ttc - a.sales_ttc),
    by_store: [...stores.values()].sort((a, b) => b.sales_ttc - a.sales_ttc),
    vat: vatRows,
  };
}

/** Noms des articles, catégories, utilisateurs et magasins, pour les rapports et les listes. */
export function loadLookup(db) {
  return {
    products: new Map(all(db, 'SELECT id, code, name, category_id, cost_price FROM products').map((p) => [p.id, p])),
    categories: new Map(all(db, 'SELECT id, name FROM categories').map((c) => [c.id, c.name])),
    users: new Map(all(db, 'SELECT id, name FROM users').map((u) => [u.id, u.name])),
    stores: new Map(all(db, 'SELECT id, name FROM stores').map((s) => [s.id, s.name])),
  };
}

export const timezoneOf = (db) => getSetting(db, 'timezone', DEFAULT_TIMEZONE);
