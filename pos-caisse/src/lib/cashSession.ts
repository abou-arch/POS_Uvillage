// Session de caisse (§9 du contrat) : fond de caisse, entrées / sorties d'espèces, clôture et rapport.
// Fonctions pures : la base locale et les écrans ne font qu'appeler ce qui est décidé et testé ici.
import { METHOD_LABELS } from '../state/payment';
import { closingNeedsApproval } from '../state/permissions';
import { isApproval, isCents, isDate, isUuid } from '../state/sales';
import type {
  CashCountLine, CashMovement, CashMovementType, CashSession, CashSessionClosing, CashSessionOpening, CountedMethod, MethodCount,
  Payment, PaymentMethod, Refund, Role, Sale,
} from '../types';
import { isId, isRecord } from './storage';
import { formatMad, vatBreakdownOfLines, type Totals, type VatGroup } from './totals.js';

// Garde-fous contre les saisies aberrantes : au-delà, c'est une faute de frappe.
export const MAX_OPENING_CASH = 1_000_000; // 10 000 DH de fond de caisse
export const MAX_MOVEMENT = 2_000_000; // 20 000 DH par entrée ou sortie
export const MAX_COUNTED = 20_000_000; // 200 000 DH comptés à la clôture, pour chaque moyen de paiement
export const MAX_PIECES = 10_000; // billets ou pièces d'une même valeur dans un comptage
export const MAX_TEXT_LENGTH = 200; // motif et notes (§9)

export const MOVEMENT_LABELS: Record<CashMovementType, string> = { in: 'Entrée', out: 'Sortie' };

/**
 * Session gardée sur la caisse : l'objet du §9, plus les noms imprimés sur le rapport. approved_by_name : le responsable
 * qui a autorisé la clôture (§11), absent des sessions d'avant le contrat 0.6.
 */
export interface LocalCashSession extends CashSession {
  opened_by_name: string;
  closed_by_name: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
}

/** Mouvement gardé sur la caisse, avec le nom de celui qui l'a fait (created_by) et de celui qui l'a autorisé (§11). */
export interface LocalCashMovement extends CashMovement { cashier_name: string; approver_name?: string | null }

/** Date au format du contrat, à la seconde : « 2026-11-12T08:02:00Z ». */
const contractDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Texte saisi nettoyé : espaces superflus retirés, 200 caractères au plus. */
export const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
const noteOrNull = (text: string) => cleanText(text) || null;

// --- Espèces attendues --------------------------------------------------------------------------------

/** Espèces laissées dans le tiroir par une vente : ses paiements « cash », déjà nets du rendu de monnaie (§5). */
export const cashOfSale = (sale: Pick<Sale, 'payments'>) =>
  sale.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);

export function movementTotals(movements: Pick<CashMovement, 'type' | 'amount'>[]): { in: number; out: number } {
  const totals = { in: 0, out: 0 };
  for (const m of movements) totals[m.type] += m.amount;
  return totals;
}

/**
 * Espèces attendues (§9) = fond de caisse + espèces des ventes − espèces rendues par les retours + entrées − sorties.
 * Un retour compte dans la session où il est fait (§9).
 */
export function expectedCash(
  openingCash: number, sales: Pick<Sale, 'payments'>[], movements: Pick<CashMovement, 'type' | 'amount'>[],
  refunds: Pick<Refund, 'payments'>[] = [],
): number {
  const moves = movementTotals(movements);
  return openingCash + sales.reduce((s, sale) => s + cashOfSale(sale), 0) - refunds.reduce((s, r) => s + cashOfSale(r), 0)
    + moves.in - moves.out;
}

/** Moyens de paiement comptés à la clôture, dans l'ordre du tableau et du rapport. Le crédit n'en fait pas partie. */
export const COUNTED_METHODS: CountedMethod[] = ['cash', 'card', 'mobile'];

export type Expected = Record<CountedMethod, number>;

/**
 * Montants attendus à la clôture (§9) : espèces comme ci-dessus ; carte et mobile = paiements des ventes moins
 * remboursements des retours de la session. Carte et mobile peuvent être négatifs (plus de remboursements que de ventes).
 */
export function expectedByMethod(
  openingCash: number, sales: Pick<Sale, 'payments'>[], movements: Pick<CashMovement, 'type' | 'amount'>[],
  refunds: Pick<Refund, 'payments'>[] = [],
): Expected {
  const total = (docs: { payments: Payment[] }[], method: PaymentMethod) =>
    docs.reduce((s, d) => s + d.payments.filter((p) => p.method === method).reduce((n, p) => n + p.amount, 0), 0);
  const net = (method: PaymentMethod) => total(sales, method) - total(refunds, method);
  return { cash: expectedCash(openingCash, sales, movements, refunds), card: net('card'), mobile: net('mobile') };
}

// --- Comptage des espèces par billets et pièces ---------------------------------------------------------

/** « 200 DH », « 0,50 DH » : libellé court d'un billet ou d'une pièce. */
export const denominationLabel = (value: number) =>
  `${value % 100 === 0 ? value / 100 : (value / 100).toFixed(2).replace('.', ',')} DH`;

/** Total d'un comptage, en centimes. */
export const countTotal = (lines: CashCountLine[]) => lines.reduce((s, l) => s + l.value * l.quantity, 0);

/**
 * Comptage saisi (nombre de billets ou pièces par valeur, en texte) → lignes du contrat. Une case vide vaut 0 ;
 * seules les valeurs comptées au moins une fois sont gardées, de la plus grande à la plus petite.
 */
export function parseCashCount(texts: Record<number, string>): { lines: CashCountLine[]; error: string | null } {
  const lines: CashCountLine[] = [];
  for (const [key, text] of Object.entries(texts)) {
    const value = Number(key);
    const t = text.trim();
    if (t === '') continue;
    if (!/^\d+$/.test(t)) return { lines: [], error: `${denominationLabel(value)} : nombre invalide (entier sans virgule).` };
    const quantity = Number(t);
    if (quantity > MAX_PIECES) return { lines: [], error: `${denominationLabel(value)} : plus de ${MAX_PIECES}, vérifiez.` };
    if (quantity > 0) lines.push({ value, quantity });
  }
  lines.sort((a, b) => b.value - a.value);
  if (countTotal(lines) > MAX_COUNTED) return { lines: [], error: `Plus de ${formatMad(MAX_COUNTED)} : vérifiez le comptage.` };
  return { lines, error: null };
}

// --- Saisies du caissier ------------------------------------------------------------------------------

/** Fond de caisse : un montant (0 accepté), plausible. */
export function openingError(cents: number | null): string | null {
  if (cents === null) return 'Montant du fond de caisse invalide.';
  if (cents > MAX_OPENING_CASH) return `Fond de caisse supérieur à ${formatMad(MAX_OPENING_CASH)} : vérifiez le montant.`;
  return null;
}

/** Entrée ou sortie : montant positif et plausible, motif obligatoire ; on ne sort pas plus que ce que la caisse contient. */
export function movementError(type: CashMovementType, amount: number | null, reason: string, available: number): string | null {
  return movementAmountError(type, amount, available) ?? (cleanText(reason) === '' ? 'Le motif est obligatoire.' : null);
}

/** Le montant seul (affiché pendant la saisie, avant que le motif soit écrit). */
export function movementAmountError(type: CashMovementType, amount: number | null, available: number): string | null {
  if (amount === null) return 'Montant invalide.';
  if (amount <= 0) return 'Le montant doit être supérieur à 0.';
  if (amount > MAX_MOVEMENT) return `Plus de ${formatMad(MAX_MOVEMENT)} : vérifiez le montant.`;
  if (type === 'out' && amount > available) {
    return `Sortie impossible : il n’y a que ${formatMad(Math.max(available, 0))} d’espèces attendues dans la caisse.`;
  }
  return null;
}

/** Un montant compté seul (affiché pendant la saisie). */
export function countedError(counted: number | null, method: CountedMethod = 'cash'): string | null {
  // Les espèces du tiroir ne sont jamais négatives ; le total du terminal de carte ou du mobile peut l'être (retours, §9).
  if (counted === null || (counted < 0 && method === 'cash')) return `${METHOD_LABELS[method]} : montant compté invalide.`;
  if (Math.abs(counted) > MAX_COUNTED) return `${METHOD_LABELS[method]} : plus de ${formatMad(MAX_COUNTED)}, vérifiez le montant compté.`;
  return null;
}

export type Counted = Record<CountedMethod, number | null>;

/** Attendu, compté et écart de chaque moyen ; null tant qu'un montant compté n'est pas valable. */
export function methodCounts(expected: Expected, counted: Counted): MethodCount[] | null {
  const counts: MethodCount[] = [];
  for (const method of COUNTED_METHODS) {
    const c = counted[method];
    if (c === null || countedError(c, method)) return null;
    counts.push({ method, expected: expected[method], counted: c, difference: c - expected[method] });
  }
  return counts;
}

/** Moyens dont l'écart dépasse le seuil du magasin, en valeur absolue (§9). */
export const overThreshold = (counts: MethodCount[], threshold: number) =>
  counts.filter((c) => Math.abs(c.difference) > threshold);

/**
 * Au-delà du seuil, un caissier fait autoriser la clôture par un responsable (§11) ; manager et admin clôturent seuls.
 * Renvoie le message tant que l'autorisation manque.
 */
export function thresholdError(counts: MethodCount[], threshold: number, role: Role, approvedBy: string | null = null): string | null {
  if (!closingNeedsApproval(role, counts, threshold) || approvedBy) return null;
  const labels = overThreshold(counts, threshold).map((c) => METHOD_LABELS[c.method].toLowerCase()).join(', ');
  return `Écart de plus de ${formatMad(threshold)} (${labels}) : un responsable doit autoriser la clôture.`;
}

/**
 * Clôture : chaque montant compté plausible ; le détail des billets et pièces, s'il y en a un, donne bien les
 * espèces comptées ; dès qu'il y a un écart, la note est obligatoire. Le seuil est vérifié à part (thresholdError) :
 * au-delà, la clôture reste possible, avec l'autorisation d'un responsable.
 */
export function closingError(input: {
  counted: Counted; expected: Expected; cashCount: CashCountLine[] | null; note: string;
}): string | null {
  for (const method of COUNTED_METHODS) {
    const error = countedError(input.counted[method], method);
    if (error) return error;
  }
  const counts = methodCounts(input.expected, input.counted);
  if (!counts) return 'Montant compté invalide.';
  if (input.cashCount !== null && countTotal(input.cashCount) !== input.counted.cash) {
    return 'Le comptage des billets et pièces ne donne pas les espèces comptées.';
  }
  return counts.some((c) => c.difference !== 0) && cleanText(input.note) === '' ? 'Il y a un écart : expliquez-le dans la note (obligatoire).' : null;
}

/** Ce qui empêche de clôturer : des ventes en attente (à reprendre ou supprimer), ou un panier en cours. */
export function closeBlocker(heldCount: number, cartLines: number): string | null {
  if (heldCount === 1) return 'Une vente est en attente : reprenez-la ou supprimez-la avant de clôturer.';
  if (heldCount > 1) return `${heldCount} ventes sont en attente : reprenez-les ou supprimez-les avant de clôturer.`;
  if (cartLines > 0) return 'Un panier est en cours : encaissez-le ou videz-le avant de clôturer.';
  return null;
}

// --- Ce qui est envoyé à l'API (§9) -------------------------------------------------------------------

export function buildOpening(input: {
  id: string; storeId: string; registerId: string; openedBy: string; openingCash: number | null; note: string; now: Date;
}): CashSessionOpening {
  const error = openingError(input.openingCash);
  if (error || input.openingCash === null) throw new Error(error ?? 'Montant invalide.');
  return {
    id: input.id, store_id: input.storeId, register_id: input.registerId, opened_by: input.openedBy,
    opened_at: contractDate(input.now), opening_cash: input.openingCash, opening_note: noteOrNull(input.note),
  };
}

export function buildMovement(input: {
  id: string; sessionId: string; type: CashMovementType; amount: number | null; reason: string; createdBy: string;
  approvedBy?: string | null; available: number; now: Date;
}): CashMovement {
  const error = movementError(input.type, input.amount, input.reason, input.available);
  if (error || input.amount === null) throw new Error(error ?? 'Montant invalide.');
  return {
    id: input.id, session_id: input.sessionId, type: input.type, amount: input.amount, reason: cleanText(input.reason),
    created_by: input.createdBy, approved_by: input.approvedBy ?? null, created_at: contractDate(input.now),
  };
}

export function buildClosing(input: {
  counted: Counted; expected: Expected; cashCount: CashCountLine[] | null; note: string; role: Role; threshold: number;
  closedBy: string; approvedBy?: string | null; now: Date;
}): CashSessionClosing {
  const counts = methodCounts(input.expected, input.counted);
  const error = closingError(input) ?? (counts ? thresholdError(counts, input.threshold, input.role, input.approvedBy ?? null) : null);
  if (error || !counts) throw new Error(error ?? 'Montant invalide.');
  return {
    closed_by: input.closedBy, approved_by: input.approvedBy ?? null, closed_at: contractDate(input.now), counts,
    cash_count: input.cashCount, closing_note: noteOrNull(input.note),
  };
}

/** Session ouverte telle que la caisse la garde. */
export const openedSession = (opening: CashSessionOpening, openerName: string): LocalCashSession => ({
  ...opening, status: 'open', opened_by_name: openerName,
  closed_by: null, closed_at: null, counts: null, cash_count: null, closing_note: null,
  closed_by_name: null,
});

export const closedSession = (
  session: LocalCashSession, closing: CashSessionClosing, closerName: string, approverName: string | null = null,
): LocalCashSession => ({ ...session, ...closing, status: 'closed', closed_by_name: closerName, approved_by_name: approverName });

// --- Relecture de la base locale (autre version de la caisse, données abîmées) ---------------------------

const isNote = (v: unknown) => v === null || (typeof v === 'string' && v !== '' && v.length <= MAX_TEXT_LENGTH);

export const isOpening = (v: unknown): v is CashSessionOpening =>
  isRecord(v) && isUuid(v.id) && isId(v.store_id) && isId(v.register_id) && isId(v.opened_by) && isDate(v.opened_at)
  && isCents(v.opening_cash) && isNote(v.opening_note);

const isSignedCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
// Espèces : jamais négatives ; carte et mobile : négatives possibles quand les retours dépassent les ventes (§9).
const isMethodCount = (v: unknown): v is MethodCount =>
  isRecord(v) && COUNTED_METHODS.includes(v.method as CountedMethod)
  && (v.method === 'cash' ? isCents(v.expected) && isCents(v.counted) : isSignedCents(v.expected) && isSignedCents(v.counted))
  && v.difference === (v.counted as number) - (v.expected as number);

const isCashCount = (v: unknown): v is CashCountLine[] =>
  Array.isArray(v) && v.every((l) => isRecord(l) && isCents(l.value) && (l.value as number) > 0 && isCents(l.quantity))
  && new Set(v.map((l: CashCountLine) => l.value)).size === v.length;

export function isClosing(v: unknown): v is CashSessionClosing {
  if (!isRecord(v) || !isId(v.closed_by) || !isApproval(v.approved_by) || !isDate(v.closed_at) || !isNote(v.closing_note)) return false;
  const counts: unknown = v.counts;
  if (!Array.isArray(counts) || counts.length !== COUNTED_METHODS.length || !counts.every(isMethodCount)) return false;
  const byMethod = (m: CountedMethod) => (counts as MethodCount[]).find((c) => c.method === m);
  if (!COUNTED_METHODS.every(byMethod)) return false;
  if (v.cash_count !== null && !(isCashCount(v.cash_count) && countTotal(v.cash_count) === byMethod('cash')?.counted)) return false;
  return (counts as MethodCount[]).every((c) => c.difference === 0) || v.closing_note !== null;
}

export const isMovement = (v: unknown): v is CashMovement =>
  isRecord(v) && isUuid(v.id) && isUuid(v.session_id) && (v.type === 'in' || v.type === 'out')
  && isCents(v.amount) && v.amount > 0 && typeof v.reason === 'string' && isNote(v.reason) && isId(v.created_by)
  && isApproval(v.approved_by) && isDate(v.created_at);

const CLOSING_FIELDS = ['closed_by', 'closed_at', 'counts', 'cash_count', 'closing_note', 'closed_by_name'];

export function isLocalSession(v: unknown): v is LocalCashSession {
  if (!isOpening(v) || !isRecord(v) || typeof v.opened_by_name !== 'string') return false;
  const approverName = v.approved_by_name === undefined || v.approved_by_name === null || typeof v.approved_by_name === 'string';
  if (!approverName) return false;
  if (v.status === 'open') return CLOSING_FIELDS.every((k) => v[k] === null) && (v.approved_by ?? null) === null;
  return v.status === 'closed' && isClosing(v) && typeof v.closed_by_name === 'string';
}

export const isLocalMovement = (v: unknown): v is LocalCashMovement =>
  isMovement(v) && isRecord(v) && typeof v.cashier_name === 'string'
  && (v.approver_name === undefined || v.approver_name === null || typeof v.approver_name === 'string');

// --- Rapport (X pendant la session, Z à la clôture) ---------------------------------------------------

export const METHODS: PaymentMethod[] = ['cash', 'card', 'mobile', 'credit'];

export interface SessionReport {
  salesCount: number;
  totals: Totals; // somme des totaux des ventes enregistrées
  byMethod: { method: PaymentMethod; amount: number }[]; // les 4 moyens, toujours dans le même ordre
  vat: VatGroup[]; // HT / TVA par taux, le plus élevé d'abord
  cashSales: number; // espèces des ventes (nettes du rendu)
  refundsCount: number;
  refundTotals: Totals; // somme des totaux des retours de la session
  refundsByMethod: { method: PaymentMethod; amount: number }[]; // les 4 moyens, toujours dans le même ordre
  cashRefunds: number; // espèces rendues par les retours
  cashIn: number;
  cashOut: number;
  openingCash: number;
  expected: Expected;
  counts: MethodCount[] | null; // attendu / compté / écart de la clôture ; null pour un rapport X
}

/**
 * Rapport d'une session, à partir des ventes et mouvements ENREGISTRÉS (comme le ticket : jamais un recalcul
 * depuis un panier). La TVA par taux reprend la règle du §7, vente par vente, via totals.js.
 */
export function sessionReport(
  session: Pick<CashSession, 'opening_cash' | 'counts'>,
  sales: Sale[],
  movements: Pick<CashMovement, 'type' | 'amount'>[],
  refunds: Pick<Refund, 'payments' | 'totals'>[] = [],
): SessionReport {
  const totals = { ht: 0, tva: 0, ttc: 0 };
  const byMethod = new Map<PaymentMethod, number>(METHODS.map((m) => [m, 0]));
  const vat = new Map<number, VatGroup>();
  for (const sale of sales) {
    totals.ht += sale.totals.ht;
    totals.tva += sale.totals.tva;
    totals.ttc += sale.totals.ttc;
    for (const p of sale.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
    for (const g of vatBreakdownOfLines(sale.lines, sale.other_charges, sale.global_discount)) {
      const sum = vat.get(g.rate) ?? { rate: g.rate, ht: 0, tva: 0, ttc: 0 };
      vat.set(g.rate, { rate: g.rate, ht: sum.ht + g.ht, tva: sum.tva + g.tva, ttc: sum.ttc + g.ttc });
    }
  }
  const moves = movementTotals(movements);
  const refundsBy = new Map<PaymentMethod, number>(METHODS.map((m) => [m, 0]));
  for (const r of refunds) for (const p of r.payments) refundsBy.set(p.method, (refundsBy.get(p.method) ?? 0) + p.amount);
  return {
    salesCount: sales.length,
    totals,
    byMethod: METHODS.map((method) => ({ method, amount: byMethod.get(method) ?? 0 })),
    vat: [...vat.values()].sort((a, b) => b.rate - a.rate),
    cashSales: byMethod.get('cash') ?? 0,
    refundsCount: refunds.length,
    refundTotals: refunds.reduce((t, r) => ({ ht: t.ht + r.totals.ht, tva: t.tva + r.totals.tva, ttc: t.ttc + r.totals.ttc }), { ht: 0, tva: 0, ttc: 0 }),
    refundsByMethod: METHODS.map((method) => ({ method, amount: refundsBy.get(method) ?? 0 })),
    cashRefunds: refundsBy.get('cash') ?? 0,
    cashIn: moves.in,
    cashOut: moves.out,
    openingCash: session.opening_cash,
    expected: expectedByMethod(session.opening_cash, sales, movements, refunds),
    counts: session.counts,
  };
}

// --- Ménage de la base locale -------------------------------------------------------------------------

export const KEEP_DAYS = 31;

/**
 * Sessions dont les ventes et mouvements peuvent quitter le poste : clôturées depuis plus de 31 jours, et sans
 * rien qui attende encore d'être envoyé (le serveur a tout). Le journal ne grossit pas sans fin.
 */
export function sessionsToPrune(sessions: LocalCashSession[], now: Date, pending: Set<string>): string[] {
  const limit = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  return sessions
    .filter((s) => s.status === 'closed' && s.closed_at !== null && Date.parse(s.closed_at) < limit && !pending.has(s.id))
    .map((s) => s.id);
}
