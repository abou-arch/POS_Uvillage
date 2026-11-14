// Retrouver une vente pour un retour (§5, §10) : d'abord l'API, qui connaît les ventes et les retours de toutes les
// caisses ; sinon le journal de ce poste (hors ligne, ou vente encore dans la file d'envoi).
import { api, ApiError } from '../api/client';
import { isRefund, mergeRefunds } from '../lib/buildRefund';
import { isSale } from '../state/sales';
import type { Refund, Sale } from '../types';
import { db } from './db';

export interface FoundSale {
  sale: Sale;
  customer: string | null; // nom du client de la vente
  refunds: Refund[]; // retours déjà faits sur cette vente : ceux de l'API et ceux de ce poste (même pas encore envoyés)
  local: boolean; // trouvée sur ce poste seulement : les retours faits sur d'autres caisses ne sont pas comptés
}

/** Retours de cette vente faits sur ce poste, envoyés ou non. */
async function localRefunds(saleId: string): Promise<Refund[]> {
  return (await db.refunds.where('original_sale_id').equals(saleId).toArray()).map((r) => r.refund).filter(isRefund);
}

/** Numéro tapé ou scanné : espaces retirés, en majuscules comme ceux imprimés. */
export const normalizeTicketNumber = (text: string) => text.replace(/\s/g, '').toUpperCase();

/**
 * La vente portant ce numéro de ticket, ou null. L'API est interrogée d'abord ; si elle ne répond pas, ou ne connaît
 * pas encore la vente (encore dans la file d'envoi), la caisse cherche dans son journal. Token refusé : l'erreur remonte.
 */
export async function findSale(text: string): Promise<FoundSale | null> {
  const number = normalizeTicketNumber(text);
  if (number === '') return null;
  try {
    const found = await api.saleByNumber(number);
    if (isSale(found?.sale) && found.sale.number === number) {
      const remote = Array.isArray(found.refunds) ? found.refunds.filter(isRefund) : [];
      const customer = typeof found.customer?.name === 'string' ? found.customer.name : null;
      return {
        sale: found.sale, customer, refunds: mergeRefunds(found.sale.id, remote, await localRefunds(found.sale.id)), local: false,
      };
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    // 404 (pas encore reçue), autre refus, ou pas de réseau : on cherche sur ce poste.
  }
  const row = await db.journal.where('sale.number').equals(number).first();
  if (!row || !isSale(row.sale)) return null;
  return { sale: row.sale, customer: row.customer, refunds: mergeRefunds(row.sale.id, await localRefunds(row.sale.id)), local: true };
}
