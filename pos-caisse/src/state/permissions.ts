// Droits du caissier (§11 du contrat) : ce qu'un caissier ne fait pas seul, le plafond de remise, et le blocage
// après des PIN faux. Fonctions pures (le stockage est passé en paramètre) : tout est testé.
import { browserStorage, isRecord, readJson, writeJson } from '../lib/storage';
import type { MethodCount, Role } from '../types';
import { lineGross, type CartState } from './cart';

/** Opérations qu'un caissier fait autoriser par un responsable (§11). */
export type GuardedAction = 'discount' | 'refund' | 'cash_out' | 'closing' | 'delete_held';

/** Ce que la fenêtre d'autorisation dit de l'opération. */
export const ACTION_LABELS: Record<GuardedAction, string> = {
  discount: 'Remise au-delà du plafond du caissier',
  refund: 'Retour et remboursement',
  cash_out: 'Sortie d’espèces',
  closing: 'Clôture avec un écart au-delà du seuil',
  delete_held: 'Suppression d’une vente en attente',
};

/** Un caissier fait autoriser ; un manager ou un admin fait seul, sans voir la fenêtre d'autorisation. */
export const needsApproval = (role: Role) => role === 'cashier';

// --- Plafond de remise (§2, §11) ------------------------------------------------------------------------

/** Plafond du magasin : en % de la base, et en centimes. null = pas de plafond de ce type. */
export interface DiscountLimits { percent: number | null; amount: number | null }

/** Une remise dépasse le plafond si elle est supérieure à `percent` % de sa base, ou à `amount`. Égale : permise. */
export function overDiscountLimit(discount: number, base: number, limits: DiscountLimits): boolean {
  if (discount <= 0) return false;
  if (limits.percent !== null && discount * 100 > limits.percent * base) return true; // en entiers : pas d'arrondi
  return limits.amount !== null && discount > limits.amount;
}

/** Remises du panier au-delà du plafond : articles dont la remise de ligne dépasse, et remise globale. */
export interface DiscountExcess { lines: string[]; global: boolean }

export function discountsOverLimit(cart: CartState, limits: DiscountLimits): DiscountExcess {
  // Remise globale : rapportée au total des lignes après leurs remises, plus les autres charges.
  const base = cart.lines.reduce((s, l) => s + lineGross(l) - l.discount, 0) + cart.otherCharges;
  return {
    lines: cart.lines.filter((l) => overDiscountLimit(l.discount, lineGross(l), limits)).map((l) => l.product_id),
    global: overDiscountLimit(cart.globalDiscount, base, limits),
  };
}

/** Au paiement : la vente d'un caissier demande une autorisation si une remise dépasse le plafond. */
export function discountNeedsApproval(role: Role, cart: CartState, limits: DiscountLimits): boolean {
  if (!needsApproval(role)) return false;
  const excess = discountsOverLimit(cart, limits);
  return excess.lines.length > 0 || excess.global;
}

/** Libellé du plafond : « 10 % et 50,00 DH », « 10 % », « 50,00 DH », ou null s'il n'y en a pas. */
export function limitLabel(limits: DiscountLimits, formatMad: (cents: number) => string): string | null {
  const parts = [
    ...(limits.percent !== null ? [`${limits.percent} %`] : []),
    ...(limits.amount !== null ? [formatMad(limits.amount)] : []),
  ];
  return parts.length > 0 ? parts.join(' et ') : null;
}

// --- Clôture au-delà du seuil (§9) ----------------------------------------------------------------------

/** Clôture d'un caissier dont un écart dépasse le seuil du magasin, en valeur absolue : il faut une autorisation. */
export const closingNeedsApproval = (role: Role, counts: MethodCount[], threshold: number) =>
  needsApproval(role) && counts.some((c) => Math.abs(c.difference) > threshold);

// --- Blocage après des PIN faux (§11) -------------------------------------------------------------------

export const MAX_PIN_FAILURES = 3;
export const PIN_LOCK_MS = 60_000;

/** Essais ratés de suite sur la caisse, et fin du blocage en cours (0 = pas de blocage). */
export interface PinLock { failures: number; lockedUntil: number }
export const NO_LOCK: PinLock = { failures: 0, lockedUntil: 0 };

/**
 * Temps de blocage restant, en ms. Une fin de blocage à plus d'1 minute vient d'une horloge du poste reculée :
 * elle est ignorée, sinon la caisse resterait bloquée.
 */
export function lockRemaining(lock: PinLock, now: number): number {
  const remaining = lock.lockedUntil - now;
  return remaining > 0 && remaining <= PIN_LOCK_MS ? remaining : 0;
}

/** Un PIN faux de plus : au 3e de suite, plus d'essai pendant 1 minute ; le compte repart ensuite de zéro. */
export function afterFailure(lock: PinLock, now: number): PinLock {
  const failures = lock.failures + 1;
  return failures >= MAX_PIN_FAILURES ? { failures: 0, lockedUntil: now + PIN_LOCK_MS } : { failures, lockedUntil: 0 };
}

/** « 1 min », « 45 s » : ce qu'il reste à attendre. */
export const lockLabel = (ms: number) => (ms > 59_000 ? '1 min' : `${Math.max(1, Math.ceil(ms / 1000))} s`);

const PIN_LOCK_KEY = 'pos.pinLock';
const isPinLock = (v: unknown): v is PinLock =>
  isRecord(v) && Number.isInteger(v.failures) && (v.failures as number) >= 0 && (v.failures as number) < MAX_PIN_FAILURES
  && Number.isSafeInteger(v.lockedUntil) && (v.lockedUntil as number) >= 0;

/** Blocage gardé sur le poste : un F5 ne remet pas les essais à zéro. Abîmé ou absent → pas de blocage. */
export function loadPinLock(storage = browserStorage()): PinLock {
  const saved = readJson(PIN_LOCK_KEY, storage);
  return isPinLock(saved) ? saved : NO_LOCK;
}

export const savePinLock = (lock: PinLock, storage = browserStorage()) => writeJson(PIN_LOCK_KEY, lock, storage);
