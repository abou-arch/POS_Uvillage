// Tickets de la session (étape 6e) : les ventes enregistrées sur ce poste, leur état d'envoi, et la recherche par
// numéro ou par client. Fonctions pures : tout est testé.
import type { ReceiptData } from '../lib/receipt';
import type { OutboxItem } from '../sync/sync';
import type { Refund } from '../types';

/** À envoyer : encore dans la file. Refusée : l'API l'a refusée (elle reste dans la file). Envoyée : sortie de la file. */
export type SendStatus = { kind: 'pending' } | { kind: 'sent' } | { kind: 'rejected'; error: string };

export interface TicketRow {
  data: ReceiptData;
  status: SendStatus;
  refunded: number; // TTC déjà rendu par les retours de cette session, en centimes
}

export const SEND_LABELS = { pending: 'À envoyer', sent: 'Envoyée', rejected: 'Refusée' } as const;

/** Tickets de la session, le plus récent d'abord. */
export function ticketRows(receipts: ReceiptData[], outbox: OutboxItem[], refunds: Refund[]): TicketRow[] {
  const queued = new Map<string, string | null>();
  for (const item of outbox) if (item.kind === 'sale') queued.set(item.id, item.error);
  const refunded = new Map<string, number>();
  for (const r of refunds) refunded.set(r.original_sale_id, (refunded.get(r.original_sale_id) ?? 0) + r.totals.ttc);
  return receipts
    .map((data): TicketRow => {
      const error = queued.get(data.sale.id);
      const status: SendStatus = error === undefined ? { kind: 'sent' } : error === null ? { kind: 'pending' } : { kind: 'rejected', error };
      return { data, status, refunded: refunded.get(data.sale.id) ?? 0 };
    })
    .sort((a, b) => b.data.sale.created_at.localeCompare(a.data.sale.created_at));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Compteur d'un numéro de ticket : « ST2-REG3-000012 » → 12 ; null si le numéro n'a pas cette forme. */
export function ticketCounter(number: string): number | null {
  const m = /-(\d+)$/.exec(number);
  return m ? Number(m[1]) : null;
}

/**
 * Recherche : des chiffres seuls désignent le ticket de ce compteur (« 3 » ou « 000003 » → …-000003) ; sinon le
 * numéro complet ou une partie, ou le nom du client (sans tenir compte des accents ni des majuscules).
 */
export function searchTickets(rows: TicketRow[], query: string): TicketRow[] {
  const q = fold(query);
  if (!q) return rows;
  if (/^\d+$/.test(q)) return rows.filter((r) => ticketCounter(r.data.sale.number) === Number(q));
  return rows.filter((r) => fold(r.data.sale.number).includes(q) || fold(r.data.customer ?? '').includes(q));
}

/** Heure du ticket dans le fuseau du magasin : « 18:58 ». */
export const ticketTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
