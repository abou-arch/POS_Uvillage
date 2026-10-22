// Catalogue en cache : affiché tout de suite au démarrage, puis mis à jour avec les seuls changements.
import { api } from '../api/client';
import { catalogChanges, nextCursor, pendingQuantities } from '../sync/sync';
import { catalogSyncKey, db } from './db';
import { dexieOutbox } from './outbox';

/** Synchronise catégories, marques et articles du magasin. Lève une erreur si l'API ne répond pas. */
export async function syncCatalog(storeId: string): Promise<void> {
  const key = catalogSyncKey(storeId);
  const saved = (await db.meta.get(key))?.value;
  const since = typeof saved === 'string' ? saved : null;
  const [categories, brands, changes] = await Promise.all([
    api.categories(), api.brands(), api.products(storeId, since ?? undefined),
  ]);
  const { put, remove } = catalogChanges(changes, pendingQuantities(await dexieOutbox.list(), storeId));
  await db.transaction('rw', [db.categories, db.brands, db.products, db.meta], async () => {
    // Listes courtes, renvoyées en entier : on remplace le cache.
    await db.categories.clear();
    await db.categories.bulkPut(categories);
    await db.brands.clear();
    await db.brands.bulkPut(brands);
    await db.products.bulkPut(put.map((p) => ({ ...p, store_id: storeId })));
    await db.products.bulkDelete(remove.map((id): [string, string] => [storeId, id]));
    const cursor = nextCursor(changes, since);
    if (cursor) await db.meta.put({ key, value: cursor });
  });
}

/** Articles du magasin, dans l'ordre des codes (IT0001, IT0002…) comme dans le catalogue. */
export async function cachedProducts(storeId: string) {
  const list = await db.products.where('store_id').equals(storeId).toArray();
  return list.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
}
