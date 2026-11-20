// Gestion du poste : tableau de bord, ventes, sessions, articles, clients et rapports, calculés à partir de ce qui
// est enregistré sur la caisse (journal des ventes, retours, sessions, mouvements, catalogue en cache). Aucun appel à
// l'API : tout marche hors ligne, et rien n'est inventé hors du contrat. Fonctions pures : tout est testé.
//
// Règles de calcul :
// - une vente annulée ne compte pas dans le chiffre d'affaires (elle est seulement dénombrée) ;
// - un retour compte le jour où il est fait, en moins (comme dans la session de caisse, §9) ;
// - le montant d'un article est la part réellement payée de sa ligne (remise globale et autres charges réparties, §7) ;
// - les espèces d'une vente sont déjà nettes du rendu de monnaie (§5).
import type { LocalCashMovement, LocalCashSession } from './cashSession';
import { expectedCash, movementTotals } from './cashSession';
import type { CustomerPayment } from '../types';
import type { ReceiptData } from './receipt';
import { paidByLine, vatBreakdownOfLines } from './totals.js';
import { lineUnit } from './units';
import type { PaymentMethod, Product, Refund, Sale, Unit } from '../types';

// --- Jours et périodes, dans le fuseau du magasin ---------------------------------------------------------

/** Jour d'un instant dans le fuseau donné : « 2026-11-18 ». */
export function dayKey(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Heure (0 à 23) d'un instant dans le fuseau donné. */
export function hourOf(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return Number(h) % 24;
}

/** Jour décalé de n jours (calcul de calendrier, sans fuseau) : addDays('2026-11-01', -1) → '2026-10-31'. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Aujourd’hui', yesterday: 'Hier', week: '7 derniers jours', month: '30 derniers jours',
};

/** Période : les jours qu'elle couvre (du plus ancien au plus récent), bornes comprises. */
export interface Period { from: string; to: string; days: string[] }

function span(to: string, length: number): Period {
  const days = Array.from({ length }, (_, i) => addDays(to, i - length + 1));
  return { from: days[0], to, days };
}

/** Jours d'une période, à partir d'aujourd'hui dans le fuseau du magasin. */
export function periodRange(key: PeriodKey, now: Date, timeZone: string): Period {
  const today = dayKey(now, timeZone);
  switch (key) {
    case 'today': return span(today, 1);
    case 'yesterday': return span(addDays(today, -1), 1);
    case 'week': return span(today, 7);
    case 'month': return span(today, 30);
  }
}

export const MAX_PERIOD_DAYS = 366;

/** Période choisie (rapports) : deux jours « AAAA-MM-JJ », du plus ancien au plus récent, 366 jours au plus. */
export function customPeriod(from: string, to: string): Period | null {
  const valid = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && addDays(k, 0) === k;
  if (!valid(from) || !valid(to) || from > to) return null;
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return length <= MAX_PERIOD_DAYS ? span(to, length) : null;
}

/** La période de même longueur juste avant (pour comparer). */
export const previousPeriod = (p: Period): Period => span(addDays(p.from, -1), p.days.length);

export const inPeriod = (iso: string, p: Period, timeZone: string) => {
  const day = dayKey(iso, timeZone);
  return day >= p.from && day <= p.to;
};

// --- Indicateurs ------------------------------------------------------------------------------------------

export interface Summary {
  tickets: number; // ventes encaissées (hors annulées)
  cancelled: number;
  gross: number; // TTC des ventes
  refunded: number; // TTC rendu par les retours
  refunds: number; // nombre de retours
  net: number; // gross − refunded
  netHt: number;
  netTva: number;
  average: number; // panier moyen TTC (arrondi au centime), 0 sans vente
  discounts: number; // remises de ligne + remises globales
  units: number; // articles vendus à la pièce
  kg: number; // poids vendu (kg, 3 décimales)
}

const completed = (sales: Sale[]) => sales.filter((s) => s.status !== 'cancelled');

export function summarize(sales: Sale[], refunds: Refund[]): Summary {
  const ok = completed(sales);
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const gross = sum(ok, (s) => s.totals.ttc);
  const refunded = sum(refunds, (r) => r.totals.ttc);
  let units = 0;
  let grams = 0;
  for (const s of ok) for (const l of s.lines) {
    if (lineUnit(l) === 'kg') grams += Math.round(l.quantity * 1000);
    else units += l.quantity;
  }
  return {
    tickets: ok.length,
    cancelled: sales.length - ok.length,
    gross,
    refunded,
    refunds: refunds.length,
    net: gross - refunded,
    netHt: sum(ok, (s) => s.totals.ht) - sum(refunds, (r) => r.totals.ht),
    netTva: sum(ok, (s) => s.totals.tva) - sum(refunds, (r) => r.totals.tva),
    average: ok.length ? Math.round(gross / ok.length) : 0,
    discounts: sum(ok, (s) => s.global_discount + sum(s.lines, (l) => l.discount)),
    units,
    kg: grams / 1000,
  };
}

/** Évolution en % arrondie à l'unité ; null si la période d'avant n'a rien (pas de comparaison possible). */
export function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 100) / Math.abs(previous));
}

/** Chiffre d'affaires TTC et tickets par heure (0 à 23) : ventes seulement, à l'heure où elles ont été faites. */
export function byHour(sales: Sale[], timeZone: string): { hour: number; ttc: number; tickets: number }[] {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, ttc: 0, tickets: 0 }));
  for (const s of completed(sales)) {
    const row = rows[hourOf(s.created_at, timeZone)];
    row.ttc += s.totals.ttc;
    row.tickets += 1;
  }
  return rows;
}

/** Chiffre d'affaires net (ventes − retours) et tickets de chaque jour de la période. */
export function byDay(sales: Sale[], refunds: Refund[], period: Period, timeZone: string) {
  const rows = new Map(period.days.map((day) => [day, { day, net: 0, tickets: 0 }]));
  for (const s of completed(sales)) {
    const row = rows.get(dayKey(s.created_at, timeZone));
    if (row) { row.net += s.totals.ttc; row.tickets += 1; }
  }
  for (const r of refunds) {
    const row = rows.get(dayKey(r.created_at, timeZone));
    if (row) row.net -= r.totals.ttc;
  }
  return [...rows.values()];
}

export const PAYMENT_ORDER: PaymentMethod[] = ['cash', 'card', 'mobile', 'credit'];

/** Encaissé par moyen de paiement : paiements des ventes − remboursements des retours (espèces nettes du rendu). */
export function byMethod(sales: Sale[], refunds: Refund[]): { method: PaymentMethod; amount: number }[] {
  const totals = new Map<PaymentMethod, number>(PAYMENT_ORDER.map((m) => [m, 0]));
  for (const s of completed(sales)) for (const p of s.payments) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount);
  for (const r of refunds) for (const p of r.payments) totals.set(p.method, (totals.get(p.method) ?? 0) - p.amount);
  return PAYMENT_ORDER.map((method) => ({ method, amount: totals.get(method) ?? 0 }));
}

export interface ProductSales {
  product_id: string;
  name: string;
  unit: Unit;
  quantity: number; // vendue − retournée (kg au gramme près)
  ttc: number; // payé − remboursé
}

/** Ventes par article, le plus gros chiffre d'abord (à égalité : par nom). */
export function byProduct(sales: Sale[], refunds: Refund[]): ProductSales[] {
  const rows = new Map<string, ProductSales & { thousandths: number }>();
  const row = (id: string, name: string, unit: Unit) => {
    let r = rows.get(id);
    if (!r) { r = { product_id: id, name, unit, quantity: 0, ttc: 0, thousandths: 0 }; rows.set(id, r); }
    return r;
  };
  for (const s of completed(sales)) {
    const paid = paidByLine(s.lines, s.other_charges, s.global_discount);
    s.lines.forEach((l, i) => {
      const r = row(l.product_id, l.name, lineUnit(l));
      r.thousandths += Math.round(l.quantity * 1000);
      r.ttc += paid[i];
    });
  }
  for (const rf of refunds) for (const l of rf.lines) {
    const r = row(l.product_id, l.name, lineUnit(l));
    r.thousandths -= Math.round(l.quantity * 1000);
    r.ttc -= l.total_ttc;
  }
  return [...rows.values()]
    .map(({ thousandths, ...r }) => ({ ...r, quantity: thousandths / 1000 }))
    .sort((a, b) => b.ttc - a.ttc || a.name.localeCompare(b.name, 'fr'));
}

/** Ventes par catégorie (catégorie lue dans le catalogue ; un article inconnu va dans « Sans catégorie »). */
export function byCategory(
  products: ProductSales[], categoryOf: Map<string, string | null>, names: Map<string, string>,
): { category_id: string | null; name: string; ttc: number }[] {
  const rows = new Map<string | null, number>();
  for (const p of products) {
    const id = categoryOf.get(p.product_id) ?? null;
    rows.set(id, (rows.get(id) ?? 0) + p.ttc);
  }
  return [...rows.entries()]
    .map(([category_id, ttc]) => ({ category_id, name: (category_id && names.get(category_id)) || 'Sans catégorie', ttc }))
    .sort((a, b) => b.ttc - a.ttc || a.name.localeCompare(b.name, 'fr'));
}

/** Récapitulatif TVA par taux (le plus élevé d'abord) : ventes − retours, HT + TVA = TTC sur chaque taux. */
export function vatSummary(sales: Sale[], refunds: Refund[]): { rate: number; ht: number; tva: number; ttc: number }[] {
  const rows = new Map<number, { rate: number; ht: number; tva: number; ttc: number }>();
  const add = (rate: number, ht: number, tva: number, ttc: number, sign: 1 | -1) => {
    const r = rows.get(rate) ?? { rate, ht: 0, tva: 0, ttc: 0 };
    r.ht += sign * ht; r.tva += sign * tva; r.ttc += sign * ttc;
    rows.set(rate, r);
  };
  for (const s of completed(sales)) {
    for (const g of vatBreakdownOfLines(s.lines, s.other_charges, s.global_discount)) add(g.rate, g.ht, g.tva, g.ttc, 1);
  }
  for (const r of refunds) for (const l of r.lines) add(l.tva_rate, l.total_ht, l.total_tva, l.total_ttc, -1);
  return [...rows.values()].sort((a, b) => b.rate - a.rate);
}

// --- Ventes ------------------------------------------------------------------------------------------------

export type SaleFilter = 'all' | 'cancelled' | 'refunded' | PaymentMethod;

export const SALE_FILTER_LABELS: Record<SaleFilter, string> = {
  all: 'Toutes', cash: 'Espèces', card: 'Carte', mobile: 'Mobile', credit: 'Crédit', refunded: 'Avec retour', cancelled: 'Annulées',
};

/** Ventes qui correspondent au filtre. refundedIds : ventes qui ont au moins un retour. */
export function filterSales(rows: ReceiptData[], filter: SaleFilter, refundedIds: Set<string>): ReceiptData[] {
  switch (filter) {
    case 'all': return rows;
    case 'cancelled': return rows.filter((r) => r.sale.status === 'cancelled');
    case 'refunded': return rows.filter((r) => refundedIds.has(r.sale.id));
    default: return rows.filter((r) => r.sale.status !== 'cancelled' && r.sale.payments.some((p) => p.method === filter));
  }
}

// --- Sessions ----------------------------------------------------------------------------------------------

export interface SessionRow {
  session: LocalCashSession;
  tickets: number;
  net: number; // TTC des ventes − retours de la session
  cashIn: number; // entrées d'espèces
  cashOut: number; // sorties d'espèces
  expectedCash: number; // fond + espèces des ventes − espèces rendues + règlements en espèces + entrées − sorties
  difference: number | null; // somme des écarts de clôture ; null tant qu'elle est ouverte
}

/** Une ligne par session, la plus récente d'abord. Les ventes, retours et mouvements sont rattachés par session_id. */
export function sessionRows(
  sessions: LocalCashSession[], sales: Sale[], refunds: Refund[], movements: LocalCashMovement[],
  payments: Pick<CustomerPayment, 'session_id' | 'method' | 'amount'>[] = [],
): SessionRow[] {
  const group = <T extends { session_id: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const x of list) map.set(x.session_id, [...(map.get(x.session_id) ?? []), x]);
    return map;
  };
  const salesOf = group(sales);
  const refundsOf = group(refunds);
  const movesOf = group(movements);
  const paymentsOf = group(payments);
  return sessions
    .map((session): SessionRow => {
      const ok = completed(salesOf.get(session.id) ?? []);
      const rf = refundsOf.get(session.id) ?? [];
      const moveList = movesOf.get(session.id) ?? [];
      const moves = movementTotals(moveList);
      return {
        session,
        tickets: ok.length,
        net: ok.reduce((s, x) => s + x.totals.ttc, 0) - rf.reduce((s, x) => s + x.totals.ttc, 0),
        cashIn: moves.in,
        cashOut: moves.out,
        expectedCash: expectedCash(session.opening_cash, ok, moveList, rf, paymentsOf.get(session.id) ?? []),
        difference: session.status === 'closed' && session.counts ? session.counts.reduce((s, c) => s + c.difference, 0) : null,
      };
    })
    .sort((a, b) => b.session.opened_at.localeCompare(a.session.opened_at));
}

// --- Clients -----------------------------------------------------------------------------------------------

export interface CustomerRow {
  customer_id: string;
  name: string;
  purchases: number;
  net: number; // TTC acheté − rendu
  credit: number; // reste dû sur ce poste : paiements à crédit − crédit rendu par les retours − règlements reçus ici
  last: string; // date du dernier achat
}

/** Clients qui ont acheté sur ce poste (le client de passage n'en fait pas partie), le plus gros acheteur d'abord. */
export function customerRows(
  receipts: ReceiptData[], refunds: Refund[], payments: Pick<CustomerPayment, 'customer_id' | 'amount'>[] = [],
): CustomerRow[] {
  const rows = new Map<string, CustomerRow>();
  for (const { sale, customer } of receipts) {
    if (!sale.customer_id || sale.status === 'cancelled') continue;
    const r = rows.get(sale.customer_id)
      ?? { customer_id: sale.customer_id, name: customer ?? 'Client', purchases: 0, net: 0, credit: 0, last: sale.created_at };
    r.purchases += 1;
    r.net += sale.totals.ttc;
    r.credit += sale.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0);
    if (sale.created_at > r.last) r.last = sale.created_at;
    if (customer) r.name = customer;
    rows.set(sale.customer_id, r);
  }
  for (const rf of refunds) {
    const r = rf.customer_id ? rows.get(rf.customer_id) : undefined;
    if (!r) continue;
    r.net -= rf.totals.ttc;
    r.credit -= rf.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0);
  }
  for (const p of payments) {
    const r = rows.get(p.customer_id);
    if (r) r.credit -= p.amount;
  }
  return [...rows.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'fr'));
}

// --- Articles et stock -------------------------------------------------------------------------------------

export type StockStatus = 'out' | 'low' | 'ok';

export const STOCK_LABELS: Record<StockStatus, string> = { out: 'Rupture', low: 'Stock bas', ok: 'En stock' };

/** Rupture : plus rien ; stock bas : au seuil d'alerte ou en dessous. */
export function stockStatus(p: Pick<Product, 'stock' | 'stock_alert'>): StockStatus {
  if (p.stock <= 0) return 'out';
  return p.stock <= p.stock_alert ? 'low' : 'ok';
}

/** Nombre d'articles et valeur du stock au prix de vente TTC (stock négatif compté à 0). */
export function stockSummary(products: Pick<Product, 'stock' | 'stock_alert' | 'price_ttc' | 'unit'>[]) {
  const out = { count: products.length, out: 0, low: 0, value: 0 };
  for (const p of products) {
    const status = stockStatus(p);
    if (status === 'out') out.out += 1;
    if (status === 'low') out.low += 1;
    out.value += Math.round(Math.max(0, p.stock) * p.price_ttc);
  }
  return out;
}

// --- Export CSV --------------------------------------------------------------------------------------------

/** Montant pour un tableur français : « 1234,50 » (sans espace ni « DH »). */
export const csvMad = (cents: number) => `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`;

/**
 * CSV au format d'Excel en français : séparateur « ; », guillemets autour des cellules qui en ont besoin,
 * fins de ligne CRLF. Une cellule qui commence par = + - @ est préfixée d'une apostrophe (injection de formule).
 */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-\d/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
