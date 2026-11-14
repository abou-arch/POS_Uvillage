// Contenu du ticket 80 mm, mis en forme à partir de la vente ENREGISTRÉE : les montants imprimés sont
// ceux de l'objet Sale (lignes, totaux, paiements, rendu), jamais un recalcul depuis le panier.
import type { StoreInfo } from '../config/store';
import { METHOD_LABELS } from '../state/payment';
import type { CashMovement, Refund, Sale } from '../types';
import { REFUND_REASONS } from './buildRefund';
import { COUNTED_METHODS, denominationLabel, MOVEMENT_LABELS, sessionReport, type LocalCashMovement, type LocalCashSession } from './cashSession';
import { formatMad, vatBreakdownOfLines } from './totals.js';

/** Ce qu'il faut garder pour (ré)imprimer un ticket : la vente, et les noms qu'elle ne contient pas. */
export interface ReceiptData { sale: Sale; cashier: string; customer: string | null }

export interface ReceiptRow { label: string; value: string }

export interface Receipt {
  store: StoreInfo;
  number: string;
  date: string;
  cashier: string;
  customer: string;
  lines: { name: string; detail: string; discount: string | null; total: string }[];
  adjustments: ReceiptRow[];
  vat: { rate: string; ht: string; tva: string }[];
  totals: { ht: string; tva: string; ttc: string };
  payments: ReceiptRow[];
  cancelled: boolean;
}

const quantity = (q: number) => q.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Date et heure de la vente, dans le fuseau du magasin : « 22/10/2026 20:05 ». */
export function receiptDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)).replace(',', '');
}

export function buildReceipt({ sale, cashier, customer }: ReceiptData, store: StoreInfo, timeZone: string): Receipt {
  const adjustments: ReceiptRow[] = [];
  if (sale.other_charges > 0) adjustments.push({ label: 'Autres charges', value: formatMad(sale.other_charges) });
  if (sale.global_discount > 0) adjustments.push({ label: 'Remise globale', value: `-${formatMad(sale.global_discount)}` });

  const payments: ReceiptRow[] = sale.payments.map((p) => ({ label: METHOD_LABELS[p.method], value: formatMad(p.amount) }));
  if (sale.amount_received > 0) {
    payments.push({ label: 'Espèces reçues', value: formatMad(sale.amount_received) });
    payments.push({ label: 'Rendu', value: formatMad(sale.change_given) });
  }

  return {
    store,
    number: sale.number,
    date: receiptDate(sale.created_at, timeZone),
    cashier,
    customer: customer ?? 'Client de passage',
    lines: sale.lines.map((l) => ({
      name: l.name,
      detail: `${quantity(l.quantity)} × ${formatMad(l.unit_price_ttc)}`,
      discount: l.discount > 0 ? `-${formatMad(l.discount)}` : null,
      total: formatMad(l.total_ttc),
    })),
    adjustments,
    // Le récapitulatif n'est pas stocké dans la vente : il est réparti à partir des total_ttc enregistrés (§7).
    vat: vatBreakdownOfLines(sale.lines, sale.other_charges, sale.global_discount)
      .map((g) => ({ rate: `${g.rate} %`, ht: formatMad(g.ht), tva: formatMad(g.tva) })),
    totals: { ht: formatMad(sale.totals.ht), tva: formatMad(sale.totals.tva), ttc: formatMad(sale.totals.ttc) },
    payments,
    cancelled: sale.status === 'cancelled',
  };
}

// --- Rapport de session 80 mm (rapport X pendant la session, rapport de clôture) --------------------------

export interface SessionReceipt {
  store: StoreInfo;
  title: string;
  subtitle: string | null;
  info: ReceiptRow[];
  sales: ReceiptRow[];
  methods: ReceiptRow[];
  refunds: ReceiptRow[]; // retours de la session (vide s'il n'y en a pas)
  vat: { rate: string; ht: string; tva: string }[];
  totals: ReceiptRow[];
  movements: ReceiptRow[];
  cash: ReceiptRow[];
  /** Rapport X : un bloc des montants attendus. Clôture : un bloc par moyen (attendu, compté, écart). */
  result: { title: string; rows: (ReceiptRow & { strong?: boolean })[] }[];
  cashCount: ReceiptRow[]; // détail du comptage des espèces, s'il a été fait billet par billet
  notes: string[];
  pending: string | null; // opérations de la session pas encore reçues par le serveur
}

/** Montant signé : « +20,00 DH », « -10,00 DH », « 0,00 DH ». */
export const signedMad = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '-' : ''}${formatMad(Math.abs(cents))}`;

export const receiptTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Rapport d'une session, tiré des ventes et mouvements enregistrés sur la caisse. Session ouverte : rapport X
 * (rien n'est clôturé, ni compté) ; session clôturée : rapport de clôture avec compté et écart.
 */
export function buildSessionReceipt(input: {
  session: LocalCashSession;
  sales: Sale[];
  movements: CashMovement[];
  refunds?: Refund[]; // retours faits dans la session
  registerName: string;
  printedAt: Date;
  store: StoreInfo;
  timeZone: string;
  pending: number; // opérations de cette session encore dans la file d'envoi
}): SessionReceipt {
  const { session, timeZone } = input;
  const closed = session.status === 'closed';
  const report = sessionReport(session, input.sales, input.movements, input.refunds ?? []);
  const hasRefunds = report.refundsCount > 0;
  const date = (iso: string) => receiptDate(iso, timeZone);

  const info: ReceiptRow[] = [
    { label: 'Caisse', value: input.registerName },
    { label: 'Ouverture', value: date(session.opened_at) },
    { label: 'Ouverte par', value: session.opened_by_name },
  ];
  if (closed && session.closed_at) {
    info.push({ label: 'Clôture', value: date(session.closed_at) }, { label: 'Clôturée par', value: session.closed_by_name ?? '' });
    if (session.approved_by_name) info.push({ label: 'Autorisée par', value: session.approved_by_name });
  } else {
    info.push({ label: 'Imprimé le', value: date(input.printedAt.toISOString()) });
  }

  const movements = [...input.movements]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({
      label: `${receiptTime(m.created_at, timeZone)} ${MOVEMENT_LABELS[m.type]} : ${m.reason}`,
      value: signedMad(m.type === 'in' ? m.amount : -m.amount),
    }));

  const result: SessionReceipt['result'] = closed && report.counts
    ? report.counts.map((c) => ({
      title: METHOD_LABELS[c.method].toUpperCase(),
      rows: [
        { label: 'Attendu', value: formatMad(c.expected) },
        { label: 'Compté', value: formatMad(c.counted) },
        { label: 'Écart', value: signedMad(c.difference), strong: true },
      ],
    }))
    : [{
      title: 'MONTANTS ATTENDUS',
      rows: COUNTED_METHODS.map((m) => ({ label: METHOD_LABELS[m], value: formatMad(report.expected[m]), strong: m === 'cash' })),
    }];
  const cashCount = (closed ? session.cash_count ?? [] : []).map((l) => ({
    label: `${l.quantity} × ${denominationLabel(l.value)}`, value: formatMad(l.value * l.quantity),
  }));

  return {
    store: input.store,
    title: closed ? 'RAPPORT DE CLÔTURE' : 'RAPPORT X',
    subtitle: closed ? null : 'Session en cours, non clôturée',
    info,
    sales: [
      { label: 'Nombre de ventes', value: String(report.salesCount) },
      { label: 'Total TTC', value: formatMad(report.totals.ttc) },
    ],
    methods: report.byMethod.map((m) => ({ label: METHOD_LABELS[m.method], value: formatMad(m.amount) })),
    refunds: hasRefunds
      ? [
        { label: 'Nombre de retours', value: String(report.refundsCount) },
        { label: 'Total TTC remboursé', value: signedMad(-report.refundTotals.ttc) },
        ...report.refundsByMethod.filter((m) => m.amount > 0)
          .map((m) => ({ label: `  ${METHOD_LABELS[m.method]}`, value: signedMad(-m.amount) })),
      ]
      : [],
    vat: report.vat.map((g) => ({ rate: `${g.rate} %`, ht: formatMad(g.ht), tva: formatMad(g.tva) })),
    totals: [{ label: 'Total HT', value: formatMad(report.totals.ht) }, { label: 'Total TVA', value: formatMad(report.totals.tva) }],
    movements,
    cash: [
      { label: 'Fond de caisse', value: formatMad(report.openingCash) },
      { label: 'Espèces des ventes', value: signedMad(report.cashSales) },
      ...(hasRefunds ? [{ label: 'Remboursements', value: signedMad(-report.cashRefunds) }] : []),
      { label: 'Entrées', value: signedMad(report.cashIn) },
      { label: 'Sorties', value: signedMad(-report.cashOut) },
    ],
    result,
    cashCount,
    notes: [
      ...(session.opening_note ? [`Note d’ouverture : ${session.opening_note}`] : []),
      ...(closed && session.closing_note ? [`Note de clôture : ${session.closing_note}`] : []),
    ],
    pending: input.pending > 0
      ? `${input.pending} opération${input.pending > 1 ? 's' : ''} pas encore envoyée${input.pending > 1 ? 's' : ''} au serveur`
      : null,
  };
}

// --- Ticket 80 mm d'une entrée ou d'une sortie d'espèces ------------------------------------------------

export interface MovementReceipt {
  store: StoreInfo;
  title: string;
  copy: boolean;
  info: ReceiptRow[];
  reason: string;
  amount: ReceiptRow;
}

/** Ticket d'un mouvement, imprimé quand il est enregistré (et réimprimable depuis la liste de la session). */
export function buildMovementReceipt(input: {
  movement: LocalCashMovement; registerName: string; store: StoreInfo; timeZone: string; copy: boolean;
}): MovementReceipt {
  const { movement } = input;
  return {
    store: input.store,
    title: movement.type === 'in' ? 'ENTRÉE D’ESPÈCES' : 'SORTIE D’ESPÈCES',
    copy: input.copy,
    info: [
      { label: 'Caisse', value: input.registerName },
      { label: 'Date', value: receiptDate(movement.created_at, input.timeZone) },
      { label: 'Par', value: movement.cashier_name },
      ...(movement.approver_name ? [{ label: 'Autorisé par', value: movement.approver_name }] : []),
    ],
    reason: movement.reason,
    amount: { label: 'MONTANT', value: signedMad(movement.type === 'in' ? movement.amount : -movement.amount) },
  };
}

// --- Ticket 80 mm d'un retour ---------------------------------------------------------------------------

/** Ce qu'il faut garder pour (ré)imprimer un ticket de retour : le retour, et ce qu'il ne contient pas. */
export interface RefundReceiptData {
  refund: Refund;
  saleNumber: string;
  cashier: string;
  customer: string | null;
  approver?: string | null; // responsable qui a autorisé le retour (§11)
}

export interface RefundReceipt {
  store: StoreInfo;
  copy: boolean;
  info: ReceiptRow[];
  reason: string;
  lines: { name: string; detail: string; total: string }[];
  vat: { rate: string; ht: string; tva: string }[];
  totals: { ht: string; tva: string; ttc: string };
  payments: ReceiptRow[];
}

/** Ticket du retour, tiré du retour ENREGISTRÉ : lignes, HT / TVA par taux, total remboursé et comment. */
export function buildRefundReceipt(data: RefundReceiptData, store: StoreInfo, timeZone: string, copy: boolean): RefundReceipt {
  const { refund } = data;
  const byRate = new Map<number, { ht: number; tva: number }>();
  for (const l of refund.lines) {
    const g = byRate.get(l.tva_rate) ?? { ht: 0, tva: 0 };
    byRate.set(l.tva_rate, { ht: g.ht + l.total_ht, tva: g.tva + l.total_tva });
  }
  return {
    store,
    copy,
    info: [
      { label: 'Retour', value: refund.number },
      { label: 'Ticket d’origine', value: data.saleNumber },
      { label: 'Date', value: receiptDate(refund.created_at, timeZone) },
      { label: 'Caissier', value: data.cashier },
      ...(data.approver ? [{ label: 'Autorisé par', value: data.approver }] : []),
      { label: 'Client', value: data.customer ?? 'Client de passage' },
    ],
    reason: refund.reason_text ? `${REFUND_REASONS[refund.reason]} : ${refund.reason_text}` : REFUND_REASONS[refund.reason],
    lines: refund.lines.map((l) => ({
      name: l.name, detail: `${quantity(l.quantity)} × ${formatMad(l.unit_price_ttc)}`, total: `-${formatMad(l.total_ttc)}`,
    })),
    vat: [...byRate].sort((a, b) => b[0] - a[0])
      .map(([rate, g]) => ({ rate: `${rate} %`, ht: formatMad(g.ht), tva: formatMad(g.tva) })),
    totals: { ht: formatMad(refund.totals.ht), tva: formatMad(refund.totals.tva), ttc: formatMad(refund.totals.ttc) },
    payments: refund.payments.map((p) => ({
      label: p.method === 'credit' ? 'Déduit du crédit' : `Rendu en ${METHOD_LABELS[p.method].toLowerCase()}`, value: formatMad(p.amount),
    })),
  };
}
