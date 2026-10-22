// File des ventes à envoyer (outbox) dans IndexedDB.
import { decrementStock } from '../lib/buildSale';
import { isSale } from '../state/sales';
import type { Sale } from '../types';
import type { OutboxItem, OutboxStore } from '../sync/sync';
import { counterKey, db, type OutboxEntry } from './db';
import { ensureMigrated } from './migrate';

/** Une ligne écrite par une autre version de la caisse (ou abîmée) n'est ni envoyée ni effacée. */
export const isOutboxEntry = (e: OutboxEntry) => isSale(e.sale) && (e.error === null || typeof e.error === 'string');

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
 * Enregistre une vente sur la caisse, en une seule transaction : numéro de ticket suivant, vente dans l'outbox,
 * stock du cache diminué. Tout est écrit, ou rien. L'envoi à l'API vient ensuite.
 */
export async function recordSale(build: (counter: number) => Sale, registerId: string): Promise<Sale> {
  await ensureMigrated(); // le compteur repris de localStorage doit être en place avant le premier ticket
  return db.transaction('rw', [db.meta, db.outbox, db.products], async () => {
    const saved = (await db.meta.get(counterKey(registerId)))?.value;
    const counter = (typeof saved === 'number' && Number.isInteger(saved) && saved > 0 ? saved : 0) + 1;
    const sale = build(counter);
    await db.outbox.add({ id: sale.id, sale, error: null, queued_at: new Date().toISOString() });
    await db.meta.put({ key: counterKey(registerId), value: counter });
    const cached = await db.products.bulkGet(sale.lines.map((l): [string, string] => [sale.store_id, l.product_id]));
    await db.products.bulkPut(decrementStock(cached.filter((p) => p !== undefined), sale.lines));
    return sale;
  });
}
