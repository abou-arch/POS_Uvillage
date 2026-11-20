// Règlement d'une dette à la caisse (§4, contrat 0.8) : un client paie ce qu'il doit (ventes à crédit). L'argent entre
// dans la caisse et compte dans les attendus de la session (§9). Fonctions pures : tout est testé.
import { isCents, isDate, isUuid } from '../state/sales';
import type { CountedMethod, CustomerPayment } from '../types';
import { cleanText, COUNTED_METHODS } from './cashSession';
import { isId, isRecord } from './storage';
import { formatMad } from './totals.js';

export const MAX_PAYMENT = 10_000_000; // 100 000 DH : au-delà, c'est une faute de frappe

/** Règlement gardé sur la caisse : ce qui est envoyé, plus les noms imprimés sur le reçu. */
export interface LocalCustomerPayment extends CustomerPayment {
  customer_name: string;
  cashier_name: string;
  /** Reste dû connu au moment du règlement (en ligne), null s'il n'était pas connu (hors ligne, API d'avant 0.8). */
  balance_before: number | null;
}

/**
 * Montant saisi : positif et plausible ; jamais plus que le reste dû quand on le connaît. Hors ligne (reste dû inconnu),
 * le règlement est permis : l'API l'accepte et le signale s'il dépasse (§4).
 */
export function paymentError(amount: number | null, balance: number | null): string | null {
  if (balance !== null && balance <= 0) return 'Ce client ne doit rien.';
  if (amount === null) return 'Montant invalide.';
  if (amount <= 0) return 'Le montant doit être supérieur à 0.';
  if (amount > MAX_PAYMENT) return `Plus de ${formatMad(MAX_PAYMENT)} : vérifiez le montant.`;
  if (balance !== null && amount > balance) return `Le client ne doit que ${formatMad(balance)}.`;
  return null;
}

/** Contrat : la date à la seconde. */
const contractDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Le règlement envoyé à l'API. Lève une erreur (message pour le caissier) si la saisie est refusée. */
export function buildCustomerPayment(input: {
  id: string; storeId: string; registerId: string; sessionId: string; customerId: string; method: CountedMethod;
  amount: number | null; balance: number | null; note: string; createdBy: string; now: Date;
}): CustomerPayment {
  const error = paymentError(input.amount, input.balance);
  if (error || input.amount === null) throw new Error(error ?? 'Montant invalide.');
  if (!COUNTED_METHODS.includes(input.method)) throw new Error('Moyen de paiement invalide.');
  return {
    id: input.id, store_id: input.storeId, register_id: input.registerId, session_id: input.sessionId, customer_id: input.customerId,
    method: input.method, amount: input.amount, note: cleanText(input.note) || null, created_by: input.createdBy,
    created_at: contractDate(input.now),
  };
}

/** Relecture (file d'envoi, base locale) : une ligne abîmée n'est ni envoyée ni comptée. */
export const isCustomerPayment = (v: unknown): v is CustomerPayment =>
  isRecord(v) && isUuid(v.id) && isId(v.store_id) && isId(v.register_id) && isUuid(v.session_id) && isId(v.customer_id)
  && COUNTED_METHODS.includes(v.method as CountedMethod) && isCents(v.amount) && v.amount > 0
  && (v.note === null || (typeof v.note === 'string' && v.note !== '')) && isId(v.created_by) && isDate(v.created_at);

export const isLocalCustomerPayment = (v: unknown): v is LocalCustomerPayment =>
  isCustomerPayment(v) && isRecord(v) && typeof v.customer_name === 'string' && typeof v.cashier_name === 'string'
  && (v.balance_before === null || Number.isSafeInteger(v.balance_before));
