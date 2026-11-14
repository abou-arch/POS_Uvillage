// Retours et remboursements (§10 du contrat) : ce qui reste à retourner, les contrôles, les remboursements proposés
// et le document envoyé à l'API. Fonctions pures : tout est testé. Montants : règle du §7, dans totals.js.
import { isRecord } from './storage';
import { isCents, isDate, isPayment, isQuantity, isRate, isUuid } from '../state/sales';
import { METHOD_LABELS } from '../state/payment';
import type { Payment, PaymentMethod, Refund, RefundLine, RefundReason, Sale, SaleLine } from '../types';
import { ticketNumber } from './buildSale';
import { formatMad, paidByLine, refundLine } from './totals.js';

export const MAX_REASON_LENGTH = 200;

export const REFUND_REASONS: Record<RefundReason, string> = {
  defective: 'Défectueux',
  cashier_error: 'Erreur de caisse',
  changed_mind: 'Changement d’avis',
  other: 'Autre',
};
export const REASONS = Object.keys(REFUND_REASONS) as RefundReason[];

const round3 = (n: number) => Math.round(n * 1000) / 1000; // quantités au poids : 3 décimales
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Numéro du retour : celui d'un ticket de vente précédé de « R- », avec le compteur des retours de la caisse. */
export const refundNumber = (storeId: string, registerId: string, counter: number) => `R-${ticketNumber(storeId, registerId, counter)}`;

/** Les retours d'une vente, sans doublon : ceux connus de l'API et ceux de la caisse encore dans la file. */
export function mergeRefunds(saleId: string, ...lists: Refund[][]): Refund[] {
  const byId = new Map<string, Refund>();
  for (const r of lists.flat()) if (r.original_sale_id === saleId && !byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Une ligne de la vente d'origine, vue pour un retour. */
export interface ReturnableLine {
  index: number; // position dans la vente (line_index)
  line: SaleLine;
  sold: number;
  returned: number; // déjà retourné, tous retours confondus
  remaining: number; // encore retournable
  paid: number; // TTC réellement payé pour toute la ligne (§7)
}

/** Vendu, déjà retourné et encore retournable sur chaque ligne de la vente. */
export function returnableLines(sale: Sale, refunds: Refund[]): ReturnableLine[] {
  const paid = paidByLine(sale.lines, sale.other_charges, sale.global_discount);
  const returned = new Map<number, number>();
  for (const r of mergeRefunds(sale.id, refunds)) {
    for (const l of r.lines) returned.set(l.line_index, round3((returned.get(l.line_index) ?? 0) + l.quantity));
  }
  return sale.lines.map((line, index) => {
    const done = returned.get(index) ?? 0;
    return { index, line, sold: line.quantity, returned: done, remaining: Math.max(0, round3(line.quantity - done)), paid: paid[index] };
  });
}

/** Une vente annulée, ou d'un autre magasin, ne se retourne pas ici (§10). */
export function saleRefundError(sale: Sale, storeId: string): string | null {
  if (sale.status === 'cancelled') return `Vente ${sale.number} annulée : pas de retour possible.`;
  if (sale.store_id !== storeId) return `Vente ${sale.number} d’un autre magasin : le retour se fait dans le magasin d’achat.`;
  return null;
}

/** « 2 », « 1,5 », « 0.250 » → quantité ; null si ce n'est pas un nombre positif à 3 décimales au plus. */
export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,3})?$/.test(t)) return null;
  const q = Number(t);
  return q > 0 ? round3(q) : null;
}

/** Quantité retournée sur une ligne : positive, et pas plus que ce qui reste. */
export function quantityError(row: ReturnableLine, quantity: number | null): string | null {
  if (quantity === null) return `${row.line.name} : quantité invalide.`;
  if (row.remaining === 0) return `${row.line.name} : déjà entièrement retourné.`;
  if (quantity > row.remaining) return `${row.line.name} : ${row.remaining.toLocaleString('fr-FR')} au plus à retourner.`;
  return null;
}

/** Lignes du retour (quantités > 0 seulement), avec le montant rendu de chacune (§7). */
export function refundLines(rows: ReturnableLine[], quantities: Map<number, number>): RefundLine[] {
  return rows.flatMap((row) => {
    const quantity = quantities.get(row.index) ?? 0;
    if (quantity <= 0) return [];
    const t = refundLine(row.paid, row.line.tva_rate, row.sold, row.returned, quantity);
    return [{
      original_line_id: row.line.id ?? null, line_index: row.index, product_id: row.line.product_id, name: row.line.name,
      quantity, unit_price_ttc: row.line.unit_price_ttc, tva_rate: row.line.tva_rate,
      total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc,
    }];
  });
}

export const refundTotals = (lines: RefundLine[]) =>
  ({ ht: sum(lines.map((l) => l.total_ht)), tva: sum(lines.map((l) => l.total_tva)), ttc: sum(lines.map((l) => l.total_ttc)) });

/** Quantités choisies : au moins une, chacune valide. */
export function quantitiesError(rows: ReturnableLine[], quantities: Map<number, number | null>): string | null {
  let any = false;
  for (const row of rows) {
    if (!quantities.has(row.index)) continue;
    const q = quantities.get(row.index) ?? null;
    if (q === 0) continue;
    const error = quantityError(row, q);
    if (error) return error;
    any = true;
  }
  return any ? null : 'Choisissez au moins un article à retourner.';
}

/** Motif obligatoire ; « Autre » demande une précision. */
export function reasonError(reason: RefundReason | null, text: string): string | null {
  if (reason === null) return 'Choisissez le motif du retour.';
  if (text.length > MAX_REASON_LENGTH) return `Précision du motif : ${MAX_REASON_LENGTH} caractères au plus.`;
  if (reason === 'other' && text.trim() === '') return 'Motif « Autre » : précisez la raison.';
  return null;
}

/** Crédit de la vente pas encore remboursé : un retour en « credit » réduit la dette, jusqu'à ce montant (§10). */
export function creditRemaining(sale: Sale, refunds: Refund[]): number {
  const paid = (payments: Payment[]) => sum(payments.filter((p) => p.method === 'credit').map((p) => p.amount));
  return Math.max(0, paid(sale.payments) - sum(mergeRefunds(sale.id, refunds).map((r) => paid(r.payments))));
}

/**
 * Remboursement proposé (§10) : d'abord la part à crédit pas encore remboursée, puis le reste avec le moyen de
 * paiement de la vente, ou en espèces si elle a été payée de plusieurs façons. Le caissier peut changer.
 */
export function defaultRefundPayments(sale: Sale, refunds: Refund[], total: number): Payment[] {
  if (total <= 0) return [];
  const credit = Math.min(total, creditRemaining(sale, refunds));
  const others = [...new Set(sale.payments.map((p) => p.method).filter((m) => m !== 'credit'))];
  const method: PaymentMethod = others.length === 1 ? others[0] : 'cash';
  return [
    ...(credit > 0 ? [{ method: 'credit' as const, amount: credit }] : []),
    ...(total > credit ? [{ method, amount: total - credit }] : []),
  ];
}

/**
 * Remboursements : montants positifs, somme égale au total, crédit dans la limite de la vente, et pas plus
 * d'espèces que le tiroir n'en contient (§9).
 */
export function refundPaymentsError(
  total: number, payments: Payment[], limits: { credit: number; cash: number },
): string | null {
  if (total <= 0) return 'Rien à rembourser.';
  if (payments.length === 0) return 'Ajoutez un moyen de remboursement.';
  if (payments.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) return 'Chaque remboursement doit avoir un montant.';
  const by = (method: PaymentMethod) => sum(payments.filter((p) => p.method === method).map((p) => p.amount));
  if (by('credit') > limits.credit) {
    return limits.credit === 0
      ? 'Crédit impossible : la vente n’a pas de crédit à réduire.'
      : `${METHOD_LABELS.credit} : ${formatMad(limits.credit)} au plus (crédit de la vente pas encore remboursé).`;
  }
  if (by('cash') > limits.cash) return `Espèces : ${formatMad(Math.max(0, limits.cash))} seulement dans le tiroir.`;
  const paid = sum(payments.map((p) => p.amount));
  if (paid < total) return `Reste à rembourser : ${formatMad(total - paid)}.`;
  if (paid > total) return `Trop remboursé : ${formatMad(paid - total)}.`;
  return null;
}

export interface RefundInput {
  sale: Sale;
  refunds: Refund[]; // retours déjà faits sur cette vente (API et caisse)
  quantities: Map<number, number>; // position de la ligne → quantité retournée
  reason: RefundReason | null;
  reasonText: string;
  payments: Payment[];
  cashAvailable: number; // espèces attendues dans le tiroir
  storeId: string;
  registerId: string;
  sessionId: string;
  cashierId: string;
  id: string; // UUID v4 généré par la caisse
  counter: number; // compteur des retours de cette caisse
  now: Date;
}

/** Une règle du retour n'est pas respectée : le message est pour le caissier. */
export class RefundError extends Error {}

/** Construit le retour ; lève une RefundError si une règle du §10 n'est pas respectée. */
export function buildRefund(input: RefundInput): Refund {
  const { sale } = input;
  if (!input.sessionId) throw new RefundError('Aucune session de caisse ouverte.');
  const rows = returnableLines(sale, input.refunds);
  const lines = refundLines(rows, input.quantities);
  const totals = refundTotals(lines);
  const error = saleRefundError(sale, input.storeId)
    ?? quantitiesError(rows, input.quantities)
    ?? reasonError(input.reason, input.reasonText)
    ?? refundPaymentsError(totals.ttc, input.payments, { credit: creditRemaining(sale, input.refunds), cash: input.cashAvailable });
  if (error) throw new RefundError(error);
  const text = input.reasonText.replace(/\s+/g, ' ').trim();
  return {
    id: input.id,
    number: refundNumber(input.storeId, input.registerId, input.counter),
    store_id: input.storeId,
    register_id: input.registerId,
    session_id: input.sessionId,
    original_sale_id: sale.id,
    cashier_id: input.cashierId,
    customer_id: sale.customer_id, // le client de la vente d'origine (§10)
    created_at: input.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reason: input.reason as RefundReason,
    reason_text: text === '' ? null : text,
    lines,
    totals,
    payments: input.payments,
  };
}

// --- Relecture (file d'envoi, base locale) ---------------------------------------------------------------

const isReason = (v: unknown): v is RefundReason => typeof v === 'string' && Object.hasOwn(REFUND_REASONS, v);
const isRefundLine = (v: unknown): v is RefundLine =>
  isRecord(v) && (v.original_line_id === null || isUuid(v.original_line_id))
  && Number.isInteger(v.line_index) && (v.line_index as number) >= 0 && typeof v.product_id === 'string' && v.product_id !== ''
  && typeof v.name === 'string' && isQuantity(v.quantity) && isCents(v.unit_price_ttc) && isRate(v.tva_rate)
  && isCents(v.total_ht) && isCents(v.total_tva) && isCents(v.total_ttc);

/** Un retour relu a exactement la forme que construit buildRefund. */
export const isRefund = (v: unknown): v is Refund =>
  isRecord(v) && isUuid(v.id) && typeof v.number === 'string' && v.number.startsWith('R-')
  && [v.store_id, v.register_id, v.cashier_id].every((x) => typeof x === 'string' && x !== '')
  && isUuid(v.session_id) && isUuid(v.original_sale_id)
  && (v.customer_id === null || (typeof v.customer_id === 'string' && v.customer_id !== ''))
  && isDate(v.created_at) && isReason(v.reason)
  && (v.reason_text === null || (typeof v.reason_text === 'string' && v.reason_text.length <= MAX_REASON_LENGTH))
  && Array.isArray(v.lines) && v.lines.length > 0 && v.lines.every(isRefundLine)
  && new Set(v.lines.map((l: RefundLine) => l.line_index)).size === v.lines.length
  && isRecord(v.totals) && isCents(v.totals.ht) && isCents(v.totals.tva) && isCents(v.totals.ttc)
  && Array.isArray(v.payments) && v.payments.length > 0 && v.payments.every(isPayment);
