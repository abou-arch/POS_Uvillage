// Base locale de la caisse (IndexedDB via Dexie) : ce qui permet de vendre sans connexion.
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { LocalCashMovement, LocalCashSession } from '../lib/cashSession';
import type { ReceiptData } from '../lib/receipt';
import type { HeldSale } from '../state/held';
import type { OutboxItem } from '../sync/sync';
import type { Brand, Category, Customer, Product, Refund } from '../types';

/** Article en cache : le stock est celui d'un magasin, d'où la clé [store_id + id]. */
export interface CachedProduct extends Product { store_id: string }

/** Opération à envoyer (vente, ouverture, mouvement, clôture), rangée par heure de mise en file. */
export type OutboxEntry = OutboxItem & { queued_at: string };

/** Vente en attente (bouton « Mise en attente »), propre à une caisse. */
export interface HeldRow extends HeldSale { register_id: string }

/**
 * Journal des ventes de la caisse : chaque vente encaissée, gardée après son envoi (rapport de session,
 * réimpression), avec les noms imprimés sur le ticket.
 */
export interface JournalRow extends ReceiptData { id: string; session_id: string; register_id: string }

/**
 * Retours faits sur la caisse (§10), gardés après leur envoi : rapport de session, et ce qui reste à retourner
 * quand l'API ne répond pas. Avec le numéro de la vente d'origine et les noms imprimés sur le ticket.
 */
export interface RefundRow {
  id: string;
  session_id: string;
  register_id: string;
  original_sale_id: string;
  refund: Refund;
  sale_number: string;
  cashier: string;
  customer: string | null;
}

/** Réglages de la caisse : dernière synchro du catalogue (par magasin), compteur de tickets (par caisse)… */
export interface MetaRow { key: string; value: unknown }

export type PosDb = Dexie & {
  products: Table<CachedProduct, [string, string]>;
  categories: EntityTable<Category, 'id'>;
  brands: EntityTable<Brand, 'id'>;
  customers: EntityTable<Customer, 'id'>;
  outbox: EntityTable<OutboxEntry, 'id'>;
  held: EntityTable<HeldRow, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
  cash_sessions: EntityTable<LocalCashSession, 'id'>;
  cash_movements: EntityTable<LocalCashMovement, 'id'>;
  journal: EntityTable<JournalRow, 'id'>;
  refunds: EntityTable<RefundRow, 'id'>;
};

export const db = new Dexie('pos-caisse') as PosDb;
db.version(1).stores({
  products: '[store_id+id], store_id',
  categories: 'id',
  brands: 'id',
  customers: 'id',
  outbox: 'id, queued_at',
  held: 'id, register_id, held_at',
  meta: 'key',
});
// Version 2 (contrat 0.4) : sessions de caisse, mouvements d'espèces, journal des ventes. L'outbox reçoit
// d'autres opérations que des ventes : celles déjà dedans deviennent des opérations « sale ».
db.version(2).stores({
  cash_sessions: 'id, register_id',
  cash_movements: 'id, session_id',
  journal: 'id, session_id, register_id',
}).upgrade((tx) => tx.table('outbox').toCollection().modify((entry: Record<string, unknown>) => {
  if (entry.kind === undefined) entry.kind = 'sale';
}));

// Version 3 (contrat 0.5) : retours, et ventes du journal retrouvées par leur numéro de ticket (retour hors ligne).
db.version(3).stores({
  journal: 'id, session_id, register_id, sale.number',
  refunds: 'id, session_id, original_sale_id',
});

export const counterKey = (registerId: string) => `ticketCounter.${registerId}`;
export const refundCounterKey = (registerId: string) => `refundCounter.${registerId}`;
export const catalogSyncKey = (storeId: string) => `catalogSync.${storeId}`;
