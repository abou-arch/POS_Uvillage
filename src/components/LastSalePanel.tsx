import { formatMad } from '../lib/totals.js';
import type { LastSale } from '../state/sales';
import { Icon } from './ui';

const SYNC: Record<LastSale['status'], string> = {
  sending: 'Envoi au serveur…',
  sent: 'Reçue par le serveur.',
  offline: 'Pas de connexion : la vente est gardée sur la caisse et sera envoyée plus tard.',
  rejected: 'Refusée par le serveur',
};

// Vente qui vient d'être encaissée, affichée à la place du panier vide : le rendu à donner saute aux yeux,
// et la douchette reste prête pour le client suivant.
export function LastSalePanel({ last }: { last: LastSale }) {
  const { sale } = last;
  return (
    <div className={`last-sale ${last.status}`} role="status">
      <Icon name="check" size={40} />
      <strong className="title">Vente encaissée</strong>
      <span className="ticket">Ticket {sale.number}</span>
      {sale.change_given > 0 && (
        <div className="change-due"><span>Rendu à donner</span><strong>{formatMad(sale.change_given)}</strong></div>
      )}
      <span className="muted">
        Total {formatMad(sale.totals.ttc)}{sale.amount_received > 0 ? ` · Reçu ${formatMad(sale.amount_received)}` : ''}
      </span>
      <p className="sync">
        {SYNC[last.status]}
        {last.status === 'rejected' && ` : ${last.message}. Elle reste dans les ventes à envoyer, à faire vérifier.`}
      </p>
      <span className="muted">Scannez l’article suivant pour commencer une nouvelle vente.</span>
    </div>
  );
}
