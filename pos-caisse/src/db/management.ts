// Données de l'espace « Gestion » : tout ce que le poste a enregistré pour sa caisse, relu à chaque changement.
// Rien n'est demandé à l'API (pas de route de rapport dans le contrat) : les pages marchent hors ligne, et couvrent
// ce que le poste garde (les sessions clôturées et envoyées quittent le poste après 31 jours, voir cashSessions.ts).
import { isRefund } from '../lib/buildRefund';
import { isLocalMovement, isLocalSession, type LocalCashMovement, type LocalCashSession } from '../lib/cashSession';
import type { ReceiptData } from '../lib/receipt';
import { isSale } from '../state/sales';
import { isOutboxItem, type OutboxItem } from '../sync/sync';
import type { Category, Product, Refund } from '../types';
import { cachedProducts } from './catalog';
import { db } from './db';
import { useLiveQuery } from './useLiveQuery';

export interface ManagementData {
  receipts: ReceiptData[]; // ventes de la caisse, la plus récente d'abord
  refunds: Refund[];
  sessions: LocalCashSession[];
  movements: LocalCashMovement[];
  products: Product[];
  categories: Category[];
  outbox: OutboxItem[];
}

const EMPTY: ManagementData = { receipts: [], refunds: [], sessions: [], movements: [], products: [], categories: [], outbox: [] };

export async function managementData(storeId: string, registerId: string): Promise<ManagementData> {
  const [journal, refundRows, sessionRows, products, categories, outbox] = await Promise.all([
    db.journal.where('register_id').equals(registerId).toArray(),
    db.refunds.toArray(),
    db.cash_sessions.where('register_id').equals(registerId).toArray(),
    cachedProducts(storeId),
    db.categories.toArray(),
    db.outbox.toArray(),
  ]);
  const sessions = sessionRows.filter(isLocalSession);
  const ids = sessions.map((s) => s.id);
  const movements = ids.length ? (await db.cash_movements.where('session_id').anyOf(ids).toArray()).filter(isLocalMovement) : [];
  return {
    receipts: journal.filter((row) => isSale(row.sale))
      .map(({ sale, cashier, customer }) => ({ sale, cashier, customer }))
      .sort((a, b) => b.sale.created_at.localeCompare(a.sale.created_at)),
    refunds: refundRows.filter((row) => row.register_id === registerId).map((row) => row.refund).filter(isRefund)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    sessions,
    movements,
    products,
    categories,
    outbox: outbox.filter(isOutboxItem),
  };
}

export function useManagementData(storeId: string, registerId: string) {
  const query = useLiveQuery(() => managementData(storeId, registerId), [storeId, registerId], EMPTY);
  return { data: query.value, loaded: query.loaded, error: query.error !== null };
}
