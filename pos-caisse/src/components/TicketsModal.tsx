import { useState } from 'react';
import { TIME_ZONE } from '../config/store';
import { sessionReceipts } from '../db/cashSessions';
import { useLiveQuery } from '../db/useLiveQuery';
import type { ReceiptData } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { searchTickets, SEND_LABELS, ticketRows, ticketTime } from '../state/tickets';
import type { OutboxItem } from '../sync/sync';
import type { Refund } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

// Tickets de la session en cours (étape 6e) : retrouver une vente par son numéro ou son client, la réimprimer
// (duplicata), ou ouvrir son retour. Les ventes viennent du journal de ce poste : elles s'affichent hors ligne.
export function TicketsModal({ sessionId, outbox, refunds, onReprint, onRefund, onClose }: {
  sessionId: string;
  outbox: OutboxItem[]; // état d'envoi de chaque vente
  refunds: Refund[]; // retours de la session : montant déjà rendu
  onReprint: (data: ReceiptData) => void;
  onRefund: (saleNumber: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const receipts = useLiveQuery(() => sessionReceipts(sessionId), [sessionId], [] as ReceiptData[]);
  const rows = ticketRows(receipts.value, outbox, refunds);
  const shown = searchTickets(rows, query);

  return (
    <Modal title="Tickets de la session" className="wide" onClose={onClose}>
      <div className="tickets">
        <label className="field">
          <Icon name="search" />
          <input data-autofocus type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="N° du ticket (ex. 3) ou nom du client" aria-label="Rechercher un ticket par numéro ou par client" />
        </label>
        {receipts.error !== null ? (
          <p className="alert" role="alert"><Icon name="alert" size={18} />Base locale illisible : tickets indisponibles.</p>
        ) : receipts.loaded && rows.length === 0 ? (
          <p className="muted center">Aucune vente dans cette session.</p>
        ) : receipts.loaded && shown.length === 0 ? (
          <p className="muted center">Aucun ticket ne correspond à « {query.trim()} ».</p>
        ) : (
          <ul aria-label="Tickets">
            {shown.map(({ data, status, refunded }) => (
              <li key={data.sale.id}>
                <div className="ticket-info">
                  <strong>{data.sale.number}</strong>
                  <span className="muted">{ticketTime(data.sale.created_at, TIME_ZONE)} · {data.customer ?? 'Client de passage'}</span>
                  <span className={`send-status ${status.kind}`}>
                    {SEND_LABELS[status.kind]}{status.kind === 'rejected' ? ` : ${status.error}` : ''}
                    {data.sale.status === 'cancelled' ? ' · Annulée' : ''}
                    {refunded > 0 ? ` · Retour ${formatMad(refunded)}` : ''}
                  </span>
                </div>
                <strong className="ticket-total">{formatMad(data.sale.totals.ttc)}</strong>
                <div className="ticket-actions">
                  <button type="button" className="btn secondary" onClick={() => onReprint(data)}
                    aria-label={`Réimprimer le ticket ${data.sale.number}`}><Icon name="printer" size={18} />Réimprimer</button>
                  <button type="button" className="btn secondary" disabled={data.sale.status === 'cancelled'}
                    onClick={() => onRefund(data.sale.number)} aria-label={`Retour sur le ticket ${data.sale.number}`}>
                    <Icon name="swap" size={18} />Retour
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
