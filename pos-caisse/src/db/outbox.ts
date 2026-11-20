// File d'envoi (outbox) dans IndexedDB : ventes, annulations, retours, règlements, ouvertures, mouvements d'espèces et
// clôtures, dans l'ordre.
import { isRefund } from '../lib/buildRefund';
import { decrementStock } from '../lib/buildSale';
import { buildCancel, cancelKey, CancelError } from '../lib/cancelSale';
import type { LocalCustomerPayment } from '../lib/customerPayment';
import { isSale } from '../state/sales';
import type { CustomerPayment, Refund, Sale } from '../types';
import { isOutboxItem, type OutboxItem, type OutboxOperation, type OutboxStore } from '../sync/sync';
import { counterKey, db, refundCounterKey, type JournalRow, type OutboxEntry } from './db';
import { ensureMigrated } from './migrate';

/** Une ligne écrite par une autre version de la caisse (ou abîmée) n'est ni envoyée ni effacée. */
export const isOutboxEntry = (e: unknown): e is OutboxEntry =>
  isOutboxItem(e) && typeof (e as { queued_at?: unknown }).queued_at === 'string';

export const dexieOutbox: OutboxStore = {
  list: async (): Promise<OutboxItem[]> => (await db.outbox.orderBy('queued_at').toArray()).filter(isOutboxEntry),
  remove: async (ids) => { await db.outbox.bulkDelete(ids); },
  markError: async (errors) => {
    if (errors.length === 0) return;
    await db.transaction('rw', db.outbox, async () => {
      for (const e of errors) await db.outbox.update(e.id, { error: e.error });
    });
  },
};

/**
 * Met une opération en file, toujours APRÈS la dernière, même si l'horloge du poste recule ou si deux opérations
 * tombent dans la même milliseconde : l'API doit recevoir l'ouverture avant les ventes, la clôture en dernier (§9).
 * À appeler dans une transaction qui comprend db.outbox.
 */
export async function enqueue(operation: OutboxOperation & { id: string }, now = Date.now()): Promise<void> {
  const last = await db.outbox.orderBy('queued_at').last();
  const after = last ? Date.parse(last.queued_at) + 1 : 0;
  const time = Number.isNaN(after) ? now : Math.max(now, after);
  await db.outbox.add({ ...operation, error: null, queued_at: new Date(time).toISOString() } as OutboxEntry);
}

const nextCounter = (saved: unknown) => (typeof saved === 'number' && Number.isInteger(saved) && saved > 0 ? saved : 0) + 1;

/** La session n'est plus ouverte (clôturée dans un autre onglet) : rien n'est enregistré. */
export class SessionNotOpenError extends Error {
  constructor() {
    super('La session de caisse n’est plus ouverte : rien n’est enregistré.');
  }
}

/**
 * Enregistre une vente sur la caisse, en une seule transaction : numéro de ticket suivant, vente dans l'outbox et
 * dans le journal de la session, stock du cache diminué. Tout est écrit, ou rien. L'envoi à l'API vient ensuite.
 */
export async function recordSale(
  build: (counter: number) => Sale,
  registerId: string,
  names: { cashier: string; customer: string | null },
): Promise<Sale> {
  await ensureMigrated(); // le compteur repris de localStorage doit être en place avant le premier ticket
  return db.transaction('rw', [db.meta, db.outbox, db.products, db.journal, db.cash_sessions], async () => {
    const counter = nextCounter((await db.meta.get(counterKey(registerId)))?.value);
    const sale = build(counter);
    const session = await db.cash_sessions.get(sale.session_id);
    if (session?.status !== 'open' || session.register_id !== registerId) throw new SessionNotOpenError();
    await enqueue({ kind: 'sale', id: sale.id, sale });
    await db.journal.add({ id: sale.id, session_id: sale.session_id, register_id: registerId, sale, ...names });
    await db.meta.put({ key: counterKey(registerId), value: counter });
    const cached = await db.products.bulkGet(sale.lines.map((l): [string, string] => [sale.store_id, l.product_id]));
    await db.products.bulkPut(decrementStock(cached.filter((p) => p !== undefined), sale.lines));
    return sale;
  });
}

/**
 * Enregistre un retour (§10), en une seule transaction : numéro de retour suivant, retour dans l'outbox et dans la base
 * de la caisse, stock du cache remonté. `build` reçoit les retours de cette vente déjà faits sur la caisse (relus dans la
 * transaction) : deux validations rapprochées ne retournent pas deux fois le même article.
 */
export async function recordRefund(
  saleId: string,
  build: (counter: number, local: Refund[]) => Refund,
  registerId: string,
  names: { saleNumber: string; cashier: string; customer: string | null; approver?: string | null },
): Promise<Refund> {
  await ensureMigrated();
  return db.transaction('rw', [db.meta, db.outbox, db.products, db.refunds, db.cash_sessions], async () => {
    const counter = nextCounter((await db.meta.get(refundCounterKey(registerId)))?.value);
    const local = (await db.refunds.where('original_sale_id').equals(saleId).toArray()).map((r) => r.refund).filter(isRefund);
    const refund = build(counter, local);
    const session = await db.cash_sessions.get(refund.session_id);
    if (session?.status !== 'open' || session.register_id !== registerId) throw new SessionNotOpenError();
    await enqueue({ kind: 'refund', id: refund.id, refund });
    await db.refunds.add({
      id: refund.id, session_id: refund.session_id, register_id: registerId, original_sale_id: saleId, refund,
      sale_number: names.saleNumber, cashier: names.cashier, customer: names.customer, approver: names.approver ?? null,
    });
    await db.meta.put({ key: refundCounterKey(registerId), value: counter });
    const cached = await db.products.bulkGet(refund.lines.map((l): [string, string] => [refund.store_id, l.product_id]));
    const back = refund.lines.map((l) => ({ product_id: l.product_id, quantity: -l.quantity })); // les articles reviennent en stock
    await db.products.bulkPut(decrementStock(cached.filter((p) => p !== undefined), back));
    return refund;
  });
}

/**
 * Annule une vente de la session ouverte (§5, contrat 0.8), en une seule transaction : la vente est marquée annulée dans
 * le journal, l'annulation part dans l'outbox (après la vente), les articles reviennent dans le stock du cache. Les retours
 * de la vente sont relus dans la transaction : un retour fait entre-temps bloque l'annulation.
 * Lève CancelError (message pour le caissier) ou SessionNotOpenError.
 */
export async function recordCancel(
  saleId: string,
  registerId: string,
  approvedBy: string | null,
  cashAvailable: number,
): Promise<JournalRow> {
  return db.transaction('rw', [db.outbox, db.products, db.journal, db.cash_sessions, db.refunds], async () => {
    const row = await db.journal.get(saleId);
    if (!row || !isSale(row.sale)) throw new CancelError('Vente introuvable sur cette caisse.');
    const session = await db.cash_sessions.get(row.sale.session_id);
    if (session?.status !== 'open' || session.register_id !== registerId) {
      throw new CancelError('Seules les ventes de la session en cours s’annulent : pour une vente plus ancienne, faites un retour.');
    }
    const refunds = (await db.refunds.where('original_sale_id').equals(saleId).toArray()).map((r) => r.refund).filter(isRefund);
    const cancel = buildCancel({ sale: row.sale, openSessionId: session.id, refunds, cashAvailable, approvedBy });
    await enqueue({ kind: 'sale_cancel', id: cancelKey(saleId), cancel });
    const updated: JournalRow = { ...row, sale: { ...row.sale, status: 'cancelled' } };
    await db.journal.put(updated);
    const cached = await db.products.bulkGet(cancel.lines.map((l): [string, string] => [cancel.store_id, l.product_id]));
    const back = cancel.lines.map((l) => ({ product_id: l.product_id, quantity: -l.quantity })); // les articles reviennent en stock
    await db.products.bulkPut(decrementStock(cached.filter((p) => p !== undefined), back));
    return updated;
  });
}

/**
 * Règlement d'une dette (§4, contrat 0.8), en une seule transaction : gardé sur la caisse (attendus et rapport de la
 * session) et mis dans l'outbox. Refusé si la session n'est plus ouverte sur cette caisse.
 */
export async function recordCustomerPayment(
  payment: CustomerPayment,
  names: { customer: string; cashier: string },
  balanceBefore: number | null,
): Promise<LocalCustomerPayment> {
  const local: LocalCustomerPayment = { ...payment, customer_name: names.customer, cashier_name: names.cashier, balance_before: balanceBefore };
  await db.transaction('rw', [db.cash_sessions, db.customer_payments, db.outbox], async () => {
    const session = await db.cash_sessions.get(payment.session_id);
    if (session?.status !== 'open' || session.register_id !== payment.register_id) throw new SessionNotOpenError();
    await db.customer_payments.add(local);
    await enqueue({ kind: 'customer_payment', id: payment.id, payment });
  });
  return local;
}
