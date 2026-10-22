// Reprise des données que les versions précédentes gardaient dans localStorage : ventes à envoyer,
// ventes en attente et compteurs de tickets passent dans IndexedDB. Chaque clé n'est vidée qu'une fois
// sa copie écrite ; les entrées illisibles restent dans localStorage, à faire vérifier.
import { browserStorage, readJson } from '../lib/storage';
import { loadHeld, saveHeld } from '../state/held';
import { lastCounter, loadPending, savePending } from '../state/sales';
import { counterKey, db } from './db';

const HELD_PREFIX = 'pos.heldSales.';
const COUNTER_PREFIX = 'pos.ticketCounter.';

function legacyKeys(prefix: string, storage: Storage | null): string[] {
  try {
    return storage ? Object.keys(storage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)) : [];
  } catch {
    return [];
  }
}

export async function migrateFromLocalStorage(storage = browserStorage() as Storage | null): Promise<void> {
  if (!storage) return;

  const pending = loadPending(storage);
  if (pending.sales.length > 0) {
    // Même format que les nouvelles ventes (avec millisecondes) : l'ordre d'envoi reste celui des ventes.
    await db.outbox.bulkPut(pending.sales.map((p) => ({
      id: p.sale.id, sale: p.sale, error: p.error, queued_at: new Date(p.sale.created_at).toISOString(),
    })));
    if (pending.unreadable.length > 0) savePending({ sales: [], unreadable: pending.unreadable }, storage);
    else storage.removeItem('pos.pendingSales');
  }

  for (const registerId of legacyKeys(HELD_PREFIX, storage)) {
    const held = loadHeld(registerId, storage);
    if (held.sales.length === 0) continue;
    await db.held.bulkPut(held.sales.map((h) => ({ ...h, register_id: registerId })));
    if (held.unreadable.length > 0) saveHeld(registerId, { sales: [], unreadable: held.unreadable }, storage);
    else storage.removeItem(`${HELD_PREFIX}${registerId}`);
  }

  // Le compteur ne doit jamais redescendre : un numéro de ticket déjà imprimé ne sert pas deux fois.
  for (const registerId of legacyKeys(COUNTER_PREFIX, storage)) {
    const legacy = lastCounter(registerId, storage);
    if (legacy === 0 && readJson(`${COUNTER_PREFIX}${registerId}`, storage) !== null) continue; // illisible : gardé
    await db.transaction('rw', db.meta, async () => {
      const current = (await db.meta.get(counterKey(registerId)))?.value;
      const value = Math.max(legacy, typeof current === 'number' ? current : 0);
      await db.meta.put({ key: counterKey(registerId), value });
    });
    storage.removeItem(`${COUNTER_PREFIX}${registerId}`);
  }
}

let migration: Promise<void> | null = null;

/**
 * Une seule fois par chargement de page. Toute écriture qui dépend de l'ancien état (le compteur de tickets)
 * l'attend d'abord. Un échec ne bloque pas la caisse : les anciennes données restent dans localStorage.
 */
export const ensureMigrated = () => (migration ??= migrateFromLocalStorage().catch(() => {}));

/** Entrées illisibles laissées dans localStorage par les versions précédentes (affichées pour vérification). */
export function legacyUnreadable(registerId: string, storage = browserStorage()): number {
  return loadPending(storage).unreadable.length + loadHeld(registerId, storage).unreadable.length;
}
