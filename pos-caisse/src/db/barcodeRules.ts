// Règles des codes-barres de la balance (§3, contrat 0.7), gardées sur la caisse pour lire les étiquettes hors ligne.
import { api } from '../api/client';
import { usableRules } from '../lib/scaleBarcode';
import type { BarcodeRule } from '../types';
import { barcodeRulesKey, db } from './db';
import { useLiveQuery } from './useLiveQuery';

/**
 * Remplace les règles du magasin par celles de l'API ; une règle incohérente est écartée. Lève une erreur si l'API
 * ne répond pas : les règles gardées restent alors en place.
 */
export async function syncBarcodeRules(storeId: string): Promise<void> {
  const { rules } = await api.barcodeRules(storeId);
  if (!Array.isArray(rules)) throw new Error('Règles des codes-barres illisibles.');
  await db.meta.put({ key: barcodeRulesKey(storeId), value: usableRules(rules) });
}

/** Règles du magasin connues de la caisse (aucune tant que la première synchro n'a pas eu lieu). */
export function useBarcodeRules(storeId: string): BarcodeRule[] {
  return useLiveQuery(
    async () => usableRules((await db.meta.get(barcodeRulesKey(storeId)))?.value),
    [storeId],
    [] as BarcodeRule[],
  ).value;
}
