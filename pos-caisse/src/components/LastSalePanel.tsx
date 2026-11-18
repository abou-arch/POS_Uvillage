import { useState, type CSSProperties } from 'react';
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
  const [pieces] = useState(makeConfetti);
  return (
    <div className={`last-sale ${last.status}`} role="status">
      <span className="burst">
        <Icon name="check" size={40} />
        {/* Petite pluie de confettis autour de la coche, une seule fois par vente. */}
        <span className="confetti" aria-hidden="true">
          {pieces.map((p, i) => <i key={i} style={p} />)}
        </span>
      </span>
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

const CONFETTI_COLORS = ['#1f6fb5', '#15803d', '#f59e0b', '#60a5fa', '#4ade80', '#ef4444'];

// Chaque confetti part dans sa direction (--x, --y), tourne (--r) et retombe : valeurs tirées une fois au montage.
function makeConfetti(): CSSProperties[] {
  return Array.from({ length: 30 }, (_, i) => {
    const angle = (i / 30) * 2 * Math.PI + Math.random() * 0.5;
    const distance = 70 + Math.random() * 90;
    return {
      '--x': `${Math.cos(angle) * distance}px`,
      '--y': `${Math.sin(angle) * distance * 0.75 - 30}px`,
      '--r': `${Math.round(Math.random() * 720 - 360)}deg`,
      background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      width: `${5 + Math.round(Math.random() * 4)}px`,
      height: `${8 + Math.round(Math.random() * 6)}px`,
      animationDelay: `${0.1 + Math.random() * 0.12}s`,
    } as CSSProperties;
  });
}
