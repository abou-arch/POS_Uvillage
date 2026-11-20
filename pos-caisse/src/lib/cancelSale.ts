// Annulation d'une vente à la caisse (§5, contrat 0.8) : quand elle est permise, ce qu'on rend au client, et ce qui part
// dans la file d'envoi. Fonctions pures : la base locale et les écrans ne font qu'appeler ce qui est décidé et testé ici.
import { METHOD_LABELS } from '../state/payment';
import { isApproval, isUuid } from '../state/sales';
import type { Payment, Refund, Sale } from '../types';
import { cashOfSale } from './cashSession';
import { isId, isRecord } from './storage';
import { formatMad } from './totals.js';

/**
 * Annulation gardée dans la file d'envoi : la route ne reçoit que approved_by (§5) ; le reste sert à la caisse (session
 * de l'opération, articles remis en stock tant que le serveur ne l'a pas reçue).
 */
export interface SaleCancel {
  sale_id: string;
  session_id: string;
  store_id: string;
  approved_by: string | null;
  lines: { product_id: string; quantity: number }[];
}

/** Clé de l'annulation dans la file : une seule par vente. */
export const cancelKey = (saleId: string) => `cancel:${saleId}`;

/** Erreur d'une règle de l'annulation : le message est lu par le caissier, rien n'est enregistré. */
export class CancelError extends Error {}

/**
 * Ce qui empêche d'annuler une vente à la caisse, ou null. Seules les ventes de la session ouverte s'annulent : après la
 * clôture, l'argent a été compté, c'est un retour (§10). Une vente qui a un retour ne s'annule plus (§5, SALE_REFUNDED).
 * Les espèces à rendre doivent être dans le tiroir.
 */
export function cancelBlocker(sale: Sale, openSessionId: string, refunds: Pick<Refund, 'original_sale_id'>[], cashAvailable: number): string | null {
  if (sale.status === 'cancelled') return 'Cette vente est déjà annulée.';
  if (sale.session_id !== openSessionId) return 'Seules les ventes de la session en cours s’annulent : pour une vente plus ancienne, faites un retour.';
  if (refunds.some((r) => r.original_sale_id === sale.id)) return 'Cette vente a déjà un retour : elle ne peut plus être annulée.';
  const cash = cashOfSale(sale);
  if (cash > cashAvailable) {
    return `Il faut rendre ${formatMad(cash)} en espèces, et il n’y a que ${formatMad(Math.max(cashAvailable, 0))} attendus dans la caisse.`;
  }
  return null;
}

/** Ce que le caissier rend au client, moyen par moyen : « Espèces 12,00 DH ». Le crédit n'est pas rendu : il est effacé. */
export function cancelGiveBack(payments: Payment[]): { method: Payment['method']; label: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const p of payments) by.set(p.method, (by.get(p.method) ?? 0) + p.amount);
  return [...by].map(([method, amount]) => ({
    method: method as Payment['method'],
    label: method === 'credit' ? 'Crédit effacé du compte client' : `Rendre en ${METHOD_LABELS[method as Payment['method']].toLowerCase()}`,
    amount,
  }));
}

/** L'opération mise en file. Lève CancelError si la vente ne peut pas être annulée. */
export function buildCancel(input: {
  sale: Sale; openSessionId: string; refunds: Pick<Refund, 'original_sale_id'>[]; cashAvailable: number; approvedBy: string | null;
}): SaleCancel {
  const blocker = cancelBlocker(input.sale, input.openSessionId, input.refunds, input.cashAvailable);
  if (blocker) throw new CancelError(blocker);
  const { sale } = input;
  return {
    sale_id: sale.id, session_id: sale.session_id, store_id: sale.store_id, approved_by: input.approvedBy,
    lines: sale.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
  };
}

/** Relecture de la file (autre version de la caisse, données abîmées). */
export const isSaleCancel = (v: unknown): v is SaleCancel =>
  isRecord(v) && isUuid(v.sale_id) && isUuid(v.session_id) && isId(v.store_id) && isApproval(v.approved_by)
  && Array.isArray(v.lines) && v.lines.every((l) => isRecord(l) && isId(l.product_id) && typeof l.quantity === 'number' && l.quantity > 0);
