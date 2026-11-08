// Ventes en attente de la caisse, dans IndexedDB : la liste se met à jour d'elle-même à chaque changement.
import { db } from '../db/db';
import { useLiveQuery } from '../db/useLiveQuery';
import { isHeldSale, type HeldSale } from './held';

export function useHeldSales(registerId: string) {
  const { value, error } = useLiveQuery(
    () => db.held.where('register_id').equals(registerId).sortBy('held_at'),
    [registerId],
    [],
  );
  const list: HeldSale[] = value.filter(isHeldSale).map(({ id, held_at, note, cart }) => ({ id, held_at, note, cart }));

  return {
    list,
    unreadable: value.length - list.length, // ni reprises ni effacées, à faire vérifier
    saved: error === null,
    add: (sale: HeldSale) => db.held.put({ ...sale, register_id: registerId }),
    remove: (id: string) => db.held.delete(id),
  };
}
