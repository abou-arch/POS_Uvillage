// Règles de paiement (§5 du contrat), partagées par les fenêtres de paiement et buildSale.
import { formatMad } from '../lib/totals.js';
import type { Payment, PaymentMethod } from '../types';

export const QUICK_CASH = [1000, 2000, 5000, 10000, 20000]; // billets de 10 à 200 DH
export const MAX_CHANGE = 100_000; // 1 000 DH à rendre : au-delà, c'est une faute de frappe

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Espèces', card: 'Carte', mobile: 'Mobile', credit: 'Crédit' };

/** Espèces : le client donne au moins ce qu'il doit, et le rendu reste plausible. */
export function cashError(due: number, received: number | null): string | null {
  if (received === null) return 'Montant reçu invalide.';
  if (received < due) return `Il manque ${formatMad(due - received)}.`;
  if (received - due > MAX_CHANGE) return `Plus de ${formatMad(MAX_CHANGE)} à rendre : vérifiez le montant reçu.`;
  return null;
}

/** Paiements d'une vente : montants positifs, somme égale au total, crédit seulement pour un client. */
export function paymentsError(total: number, payments: Payment[], hasCustomer: boolean): string | null {
  if (total <= 0) return 'Rien à payer.';
  if (payments.length === 0) return 'Ajoutez un paiement.';
  if (payments.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) return 'Chaque paiement doit avoir un montant.';
  if (!hasCustomer && payments.some((p) => p.method === 'credit')) return 'Le crédit demande un client : choisissez-le d’abord.';
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (paid < total) return `Reste à payer : ${formatMad(total - paid)}.`;
  if (paid > total) return `Trop perçu : ${formatMad(paid - total)}.`;
  return null;
}
