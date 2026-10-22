// Contenu du ticket 80 mm, mis en forme à partir de la vente ENREGISTRÉE : les montants imprimés sont
// ceux de l'objet Sale (lignes, totaux, paiements, rendu), jamais un recalcul depuis le panier.
import type { StoreInfo } from '../config/store';
import { METHOD_LABELS } from '../state/payment';
import type { Sale } from '../types';
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
