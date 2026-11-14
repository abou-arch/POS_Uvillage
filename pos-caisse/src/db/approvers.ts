// Responsables du magasin et empreinte de leur PIN (§11), gardés sur la caisse pour autoriser une opération hors ligne.
import { api } from '../api/client';
import { isApprover } from '../lib/pin';
import type { Approver } from '../types';
import { db } from './db';
import { useLiveQuery } from './useLiveQuery';

/**
 * Remplace la liste du magasin par celle de l'API : un responsable retiré, ou qui n'a plus de PIN, disparaît.
 * Une entrée incomplète est écartée. Lève une erreur si l'API ne répond pas : la liste gardée reste alors en place.
 */
export async function syncApprovers(storeId: string): Promise<void> {
  const { approvers } = await api.approvers(storeId);
  if (!Array.isArray(approvers)) throw new Error('Liste des responsables illisible.');
  const valid = approvers.filter(isApprover);
  await db.transaction('rw', db.approvers, async () => {
    await db.approvers.where('store_id').equals(storeId).delete();
    await db.approvers.bulkPut(valid.map((a) => ({ user_id: a.user_id, name: a.name, pin: a.pin, store_id: storeId })));
  });
}

/** Responsables du magasin connus de la caisse, par ordre alphabétique ; se met à jour après chaque synchro. */
export function useApprovers(storeId: string) {
  const query = useLiveQuery(() => db.approvers.where('store_id').equals(storeId).toArray(), [storeId], []);
  const list: Approver[] = query.value.filter(isApprover)
    .map(({ user_id, name, pin }) => ({ user_id, name, pin }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { list, loaded: query.loaded, storageError: query.error !== null };
}
