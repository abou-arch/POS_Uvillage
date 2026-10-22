// Base locale de la caisse (IndexedDB via Dexie) : ce qui permet de vendre sans connexion.
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { HeldSale } from '../state/held';
import type { Brand, Category, Customer, Product, Sale } from '../types';

/** Article en cache : le stock est celui d'un magasin, d'où la clé [store_id + id]. */
export interface CachedProduct extends Product { store_id: string }

/** Vente à envoyer. `error` = refus du serveur, à faire vérifier (elle n'est plus renvoyée d'office). */
export interface OutboxEntry { id: string; sale: Sale; error: string | null; queued_at: string }

/** Vente en attente (bouton « Mise en attente »), propre à une caisse. */
export interface HeldRow extends HeldSale { register_id: string }

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

export const counterKey = (registerId: string) => `ticketCounter.${registerId}`;
export const catalogSyncKey = (storeId: string) => `catalogSync.${storeId}`;
